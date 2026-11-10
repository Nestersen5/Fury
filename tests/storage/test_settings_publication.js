'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fury-settings-publication-'));
process.env.FURY_DATA_DIR=directory;
const config=require('../../app_config'),profiles=require('../../src/profiles/profileStore');
const files=[config.paths.features,config.paths.scan,config.paths.chatTriggers];
const snapshot=()=>files.map(file=>fs.existsSync(file)?fs.readFileSync(file):null);
const assertSnapshot=before=>files.forEach((file,i)=>assert.deepEqual(fs.existsSync(file)?fs.readFileSync(file):null,before[i]));
const clean=()=>files.forEach(file=>{try{fs.unlinkSync(file);}catch(e){if(e.code!=='ENOENT')throw e;}});
const seed=()=>{
 clean();
 config.saveFeatureSettings({tabStatsEnabled:false,shareOwnNicknameEnabled:false,shareTagsAuto:false,chatPrefixAccentHex:'#a66bea'});
 config.saveScanSettings({...config.defaults.scan,scanMode:'off'});
 config.saveChatTriggerSettings({triggers:['old']});
};
const desired={features:{tabStatsEnabled:true,shareTagsAuto:true},scan:{...config.defaults.scan,scanMode:'all'},chatTriggers:{triggers:['new']}};
const noTemps=()=>assert.deepEqual(fs.readdirSync(directory).filter(name=>name.endsWith('.tmp')),[]);
test.after(()=>{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});});

test('fresh prefix accent matches launcher blue and explicit saved colors survive unrelated saves',()=>{
 clean();assert.equal(config.loadFeatureSettings().chatPrefixAccentHex,'#0022cc');
 config.saveFeatureSettings({chatPrefixAccentHex:'#a66bea',shareOwnNicknameEnabled:false});
 config.saveFeatureSettings({shareTagsAuto:true});
 assert.equal(config.loadFeatureSettings().chatPrefixAccentHex,'#a66bea');
 assert.equal(config.loadFeatureSettings().shareOwnNicknameEnabled,false);
});

test('an interrupted settings write leaves the authoritative choices intact',()=>{
 seed();const before=snapshot(),write=fs.writeFileSync;
 fs.writeFileSync=function(file,data,...args){
  if(path.basename(String(file)).startsWith('.features_config.json.')&&typeof data==='string'){
   write.call(this,file,data.slice(0,17),...args);throw Object.assign(Error('Interrupted temporary write'),{code:'EIO'});
  }
  return write.call(this,file,data,...args);
 };
 try{assert.throws(()=>config.saveFeatureSettings({tabStatsEnabled:true}),/Interrupted/);}finally{fs.writeFileSync=write;}
 assertSnapshot(before);assert.equal(config.loadFeatureSettings().shareOwnNicknameEnabled,false);noTemps();
});

test('profile revisions advance only for profile applications and survive ordinary saves',()=>{
 seed();config.saveProfileSettings(desired);
 const revision=config.loadFeatureSettings()._profileRevision;
 assert.match(revision,/^[a-f0-9-]{36}$/);
 assert.equal(profiles.filterPresetSettings(config.loadFeatureSettings())._profileRevision,undefined);
 config.saveFeatureSettings({quickMathsEnabled:true});
 assert.equal(config.loadFeatureSettings()._profileRevision,revision);
 config.saveProfileSettings(desired);
 assert.notEqual(config.loadFeatureSettings()._profileRevision,revision);noTemps();
});

for(const failedIndex of [1,2])test('profile rename failure restores earlier files: position '+(failedIndex+1),()=>{
 seed();const before=snapshot(),rename=fs.renameSync;let failed=false;
 fs.renameSync=function(from,to){if(to===files[failedIndex]&&!failed){failed=true;throw Object.assign(Error('Synthetic publication failure'),{code:'EACCES'});}return rename.call(this,from,to);};
 try{assert.throws(()=>config.saveProfileSettings(desired),/publication failure/);}finally{fs.renameSync=rename;}
 assert.equal(failed,true);assertSnapshot(before);noTemps();
});

test('all profile files stage before publication and normalization failures leave no partial settings',()=>{
 seed();const before=snapshot(),write=fs.writeFileSync;
 fs.writeFileSync=function(file,data,...args){if(path.basename(String(file)).startsWith('.chat_triggers.json.')&&typeof data==='string')throw Error('Third file cannot be staged');return write.call(this,file,data,...args);};
 try{assert.throws(()=>config.saveProfileSettings(desired),/cannot be staged/);}finally{fs.writeFileSync=write;}
 assertSnapshot(before);noTemps();
});

test('failed first-install profile publication removes newly published files',()=>{
 clean();const rename=fs.renameSync;
 fs.renameSync=function(from,to){if(to===config.paths.chatTriggers)throw Error('Third file unavailable');return rename.call(this,from,to);};
 try{assert.throws(()=>config.saveProfileSettings(desired),/unavailable/);}finally{fs.renameSync=rename;}
 assertSnapshot([null,null,null]);noTemps();
});

test('launcher profile failure preserves active profile, live notifications and previous settings',async()=>{
 seed();const before=snapshot(),source=fs.readFileSync(path.join(__dirname,'../../launcher.js'),'utf8');
 const start=source.indexOf('async function applyProfile('),end=source.indexOf('\nfunction saveCurrentProfile',start);
 let active='old',notifications=0;
 const context={...config,...profiles,profileStore:{get:()=>({name:'fixture',label:'Fixture',settings:{tabStatsEnabled:true,scanMode:'all',chatTriggers:['new']}}),setActive:name=>{active=name;}},settingChanges:()=>[],notifyProxySettingsChanged:async()=>{notifications++;},notifySettingsUpdated:()=>{notifications++;},profileState:()=>({profiles:[{name:'fixture'}]})};
 const apply=vm.runInNewContext('('+source.slice(start,end)+')',context),rename=fs.renameSync;let failed=false;
 fs.renameSync=function(from,to){if(to===config.paths.scan&&!failed){failed=true;throw Error('Cannot publish scan settings');}return rename.call(this,from,to);};
 try{await assert.rejects(apply('fixture'),/Could not save profile settings/);}finally{fs.renameSync=rename;}
 assertSnapshot(before);assert.equal(active,'old');assert.equal(notifications,0);
 await apply('fixture');assert.equal(active,'fixture');assert.equal(notifications,2);
 assert.equal(config.loadFeatureSettings().tabStatsEnabled,true);assert.equal(config.loadScanSettings().scanMode,'all');noTemps();
});

test('in-game profile failure never applies partial settings to the live connection',()=>{
 seed();const before=snapshot(),source=fs.readFileSync(path.join(__dirname,'../../proxy.js'),'utf8');
 const start=source.indexOf('function applyPresetSettings('),end=source.indexOf('\nconst loadChatTriggerConfig',start);
 let reloads=0;
 const context={...config,...profiles,console:{error(){}},captureCurrentPresetSettings:()=>({}),loadFeatureConfig:()=>{reloads++;},loadScanConfig:()=>{reloads++;},loadChatTriggerConfig:()=>{reloads++;},applyLiveFeatureSettings:()=>{reloads++;}};
 const apply=vm.runInNewContext('('+source.slice(start,end)+')',context),rename=fs.renameSync;let failed=false;
 fs.renameSync=function(from,to){if(to===config.paths.scan&&!failed){failed=true;throw Error('Cannot publish scan settings');}return rename.call(this,from,to);};
 let result;try{result=apply({tabStatsEnabled:true,scanMode:'all',chatTriggers:['new']});}finally{fs.renameSync=rename;}
 assert.equal(result.ok,false);assert.equal(reloads,0);assertSnapshot(before);noTemps();
});
