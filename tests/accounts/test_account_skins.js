'use strict';
const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {createAccountSkinCache}=require('../../src/accounts/skinCache');
(async()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fury-skin-cache-'));
    const png=fs.readFileSync(path.join(REPOSITORY_ROOT,'assets/default-skin.png'));
    const alice='a'.repeat(32),bob='b'.repeat(32),unknown='c'.repeat(32),calls=[];
    let time=1000000,offline=false,mismatch=false,unsafe=false;
    const axios={async get(url){
        calls.push(url);if(offline)throw new Error('Offline');
        if(url.includes('sessionserver')){
            const id=url.split('/').pop();
            return{data:{id:mismatch?bob:id,properties:[{name:'textures',value:Buffer.from(JSON.stringify({textures:{SKIN:{url:unsafe?'http://localhost/private':`http://textures.minecraft.net/texture/${id}`,metadata:{model:id===bob?'slim':'default'}}}})).toString('base64')}]}};
        }
        return{data:png};
    }};
    try{
        const cache=createAccountSkinCache({directory,axios,now:()=>time});
        const [one,two]=await Promise.all([cache.get(alice),cache.get({uuid:alice})]);
        assert.deepStrictEqual(one,two);assert.strictEqual(calls.length,2,'Concurrent views share a profile/texture request');
        assert.strictEqual(one.skinUrl,`data:image/png;base64,${png.toString('base64')}`);
        assert(calls[1].startsWith('https://textures.minecraft.net/'));
        const second=await cache.get(bob);assert.strictEqual(second.uuid,bob);assert.strictEqual(second.model,'slim');
        assert.strictEqual(await cache.get('../../private'),null);
        const restarted=createAccountSkinCache({directory,axios,now:()=>time});offline=true;
        assert.deepStrictEqual(await restarted.get(alice),one,'A restart loads this UUID from disk without a network request');
        assert.strictEqual(calls.length,4);
        time+=16*60*1000;
        assert.deepStrictEqual(await restarted.get(alice),one,'Offline refresh keeps the last real skin');
        const failedCalls=calls.length;await restarted.get(alice);assert.strictEqual(calls.length,failedCalls,'Failure retries are throttled');
        assert.strictEqual(await restarted.get(unknown),null,'An unknown account never borrows another skin');
        offline=false;mismatch=true;
        const invalid=createAccountSkinCache({directory:path.join(directory,'invalid'),axios,now:()=>time});
        const before=calls.length;assert.strictEqual(await invalid.get(alice),null);assert.strictEqual(calls.length,before+1,'Mismatched UUID cannot select a texture');
        mismatch=false;unsafe=true;const beforeUnsafe=calls.length;
        assert.strictEqual(await invalid.get(bob),null);assert.strictEqual(calls.length,beforeUnsafe+1,'Only official texture URLs may be fetched');
        console.log('Account skin cache tests passed.');
    }finally{
        const resolved=path.resolve(directory),tempRoot=path.resolve(os.tmpdir())+path.sep;
        assert(resolved.startsWith(tempRoot)&&path.basename(resolved).startsWith('fury-skin-cache-'));
        fs.rmSync(resolved,{recursive:true,force:true});
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
