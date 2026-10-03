'use strict';

// Synthetic-only comparison against a saved working-tree baseline. No live
// application data, credentials, proxy connections, or renderer are involved.
const fs=require('fs'),path=require('path'),vm=require('vm'),os=require('os'),Module=require('module');
const {performance}=require('perf_hooks');
const {createJsonWriter}=require('../../src/storage/jsonWriter');
const root=path.resolve(__dirname,'../..'),baseline=path.resolve(process.argv[2]||'output/nicks-implementation/before');
const {createDenickHistory}=require('../../src/denick/history');
const {createLauncherDenickHistory}=require('../../src/launcher/denickHistory');
function load(file,overrides={}){const m=new Module(path.join(root,file));m.filename=path.join(root,file);m.paths=Module._nodeModulePaths(path.dirname(m.filename));const original=m.require.bind(m);m.require=id=>overrides[id]||original(id);m._compile(fs.readFileSync(path.join(baseline,file),'utf8'),m.filename);return m.exports;}
const oldIndex=load('src/denick/denick_history_index.js');
const oldHistory=load('src/denick/history.js',{'./denick_history_index.js':oldIndex});
const launcher=fs.readFileSync(path.join(baseline,'launcher.js'),'utf8');
const launcherFns=launcher.slice(launcher.indexOf('function uniquePushCaseInsensitive('),launcher.indexOf('function addManualDenickMapping('));
function fixture(count,nicks){return Array.from({length:count},(_,i)=>{const realIGN=`Player${String(i).padStart(5,'0')}`;const events=Array.from({length:nicks},(_,j)=>({at:new Date(Date.UTC(2026,0,1)+i*60000+j*1000).toISOString(),nick:`Nick${i}_${j}`,realIGN,method:['skin','stats','manual'][j%3],stats:j%3===1?{finals:12345,beds:6789,matchedFinals:12345,matchedBeds:6789}:null,gameMode:'BEDWARS',account:'TestAccount'}));return {realIGN,nicks:events.map(e=>e.nick),methods:[...new Set(events.map(e=>e.method))],firstSeen:events[0].at,lastSeen:events.at(-1).at,events};});}
const median=a=>+[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)].toFixed(3);
function measure(fn){const a=[];for(let i=0;i<11;i++){const t=performance.now();fn();a.push(performance.now()-t);}return {medianMs:median(a),maxMs:+Math.max(...a).toFixed(3)};}
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fury-nicks-bench-')),results=[];
 try{for(const [count,nicks]of [[1000,1],[2000,1],[2000,10]]){
  const file=path.join(temp,'denicked.json'),raw=fixture(count,nicks);fs.writeFileSync(file,JSON.stringify(raw));
  const ctx={fs,DENICKED_HISTORY_FILE:file,readJsonFile:f=>JSON.parse(fs.readFileSync(f,'utf8'))};vm.createContext(ctx);vm.runInContext(launcherFns,ctx);
  const reader=createLauncherDenickHistory(file),revision=reader.get().revision;
  const beforeRefresh=measure(()=>ctx.getDenickHistory()),afterRefresh=measure(()=>reader.get(revision));
  const beforeReload=measure(()=>oldHistory.createDenickHistory({historyFile:file,writeJsonOffThread:()=>{}}).loadDenickHistoryStore());
  const afterReload=measure(()=>createDenickHistory({historyFile:file,writeJsonOffThread:()=>{}}).loadDenickHistoryStore());
  const variants={};
  for(const [name,factory]of [['before',oldHistory.createDenickHistory],['after',createDenickHistory]]){
   fs.writeFileSync(file,JSON.stringify(raw));
   const writer=createJsonWriter({workerPath:path.join(root,'src/storage/json_writer_worker.js')});
   // Warm worker startup outside the measurements.
   await new Promise(resolve=>writer.writeJsonOffThread(file,raw,'Bench',resolve));
   let writes=0,pending=[];
   const store=factory({historyFile:file,writeJsonOffThread:(f,p,l,done,options)=>{writes++;pending.push(new Promise((resolve,reject)=>writer.writeJsonOffThread(f,p,l,(e,receipt)=>{done?.(e,receipt);e?reject(new Error(e)):resolve();},options)));}});
   store.loadDenickHistoryStore();
   const samples=[],submit=[];
   for(let sample=0;sample<7;sample++){
    const t=performance.now();for(let i=0;i<20;i++)store.appendDenickHistory({nick:`Nick${i}_0`,realIGN:`Player${String(i).padStart(5,'0')}`,method:'skin'});samples.push(performance.now()-t);
    const start=performance.now(),flush=store.flush?.({strict:true});submit.push(performance.now()-start);
    await flush;await Promise.all(pending);pending=[];
   }
   variants[name]={twentyUpdates: {medianMs:median(samples),maxMs:+Math.max(...samples).toFixed(3)},batchSubmission:median(submit),writes};
   await writer.close();
  }
  const result={players:count,nicks,beforeRefresh,afterRefresh,beforeReload,afterReload,variants};results.push(result);console.log(JSON.stringify(result));
 }
 const out=path.join(root,'output/nicks-implementation/cpu-comparison.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify({runtime:process.versions,cpu:os.cpus()[0].model,results},null,2));
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
