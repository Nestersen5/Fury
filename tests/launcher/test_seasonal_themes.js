'use strict';

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {normalizePreferences,readPreferences,canAnimate,isClear,STORAGE_KEY}=require('../../src/launcher/renderer/launcher_seasonal');

test('saved seasonal preferences fail closed and explicitly allow only supported launcher fields',()=>{
    const defaults={theme:'none',snow:true,edges:true,lights:true,trail:true};
    for(const value of [null,undefined,[],true,'christmas',{}])assert.deepEqual(normalizePreferences(value),defaults);
    assert.deepEqual(normalizePreferences({theme:'halloween',snow:'false',edges:0,lights:null,trail:[],account:'private'}),defaults);
    assert.deepEqual(normalizePreferences({theme:'christmas',snow:false,edges:false,lights:false,trail:false,themeColor:'red'}),{theme:'christmas',snow:false,edges:false,lights:false,trail:false});
});

test('missing preferences default to Christmas while saved choices and damaged-preference handling are preserved',()=>{
    assert.deepEqual(readPreferences({getItem:key=>{assert.equal(key,STORAGE_KEY);return null;}}),{theme:'christmas',snow:true,edges:true,lights:true,trail:true});
    for(const source of ['','{broken','null','["christmas"]','{"theme":"future"}']){
        assert.equal(readPreferences({getItem:key=>{assert.equal(key,STORAGE_KEY);return source;}}).theme,'none');
    }
    assert.equal(readPreferences({getItem(){throw Error('unavailable');}}).theme,'none');
    assert.deepEqual(readPreferences({getItem:()=>'{"theme":"none","snow":false,"lights":false}'}),{theme:'none',snow:false,edges:true,lights:false,trail:true});
    assert.deepEqual(readPreferences({getItem:()=>'{"theme":"christmas","snow":false,"trail":false}'}),{theme:'christmas',snow:false,edges:true,lights:true,trail:false});
});

test('every focus, visibility, preference and reduced-motion gate can stop animation independently',()=>{
    const enabled={theme:'christmas',focused:true,visible:true,motion:'full',reduced:false,disposed:false};
    assert.equal(canAnimate(enabled),true);
    for(const patch of [{theme:'none'},{focused:false},{visible:false},{motion:'reduced'},{reduced:true},{disposed:true}])assert.equal(canAnimate({...enabled,...patch}),false);
});

test('the whole flake must clear protected content, including its edges',()=>{
    const rects=[{left:20,right:80,top:20,bottom:80}];
    assert.equal(isClear(50,50,8,rects),false);
    assert.equal(isClear(17,50,8,rects),false);
    assert.equal(isClear(15,50,8,rects),true);
    assert.equal(isClear(50,84,8,rects),false);
    assert.equal(isClear(50,85,8,rects),true);
    assert.equal(isClear(50,50,8,[]),true);
});

test('production packages include the effect renderer, stylesheet and approved artwork',()=>{
    const root=path.resolve(__dirname,'../..');
    const files=new Set(require('../../scripts/verify_packaged_sources').runtimeFiles(root,require('../../package.json')));
    for(const asset of ['src/launcher/renderer/launcher_seasonal.js','src/launcher/styles/launcher_seasonal.css','assets/launcher-themes/christmas-row.png','assets/launcher-themes/christmas-panorama.png','assets/launcher-themes/fury-icon-christmas.png']){
        assert(files.has(asset),asset+' missing from the shared payload');assert(fs.statSync(path.join(root,asset)).size>0);
    }
    const html=fs.readFileSync(path.join(root,'launcher.html'),'utf8');
    assert(html.includes('src/launcher/styles/launcher_seasonal.css'));
    assert(!fs.readFileSync(path.join(root,'src/launcher/renderer/launcher_seasonal.js'),'utf8').includes('output/'));
});
