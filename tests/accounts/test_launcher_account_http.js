'use strict';
const assert=require('assert');
const {once}=require('events');
const {createHealthServer}=require('../../src/health/httpServer');
const {buildLauncherSessionHistory}=require('../../src/session/launcherSessionHistory');
const {sessionBelongsToAccount}=require('../../src/accounts/launcherAccounts');

(async()=>{
    const alice={name:'Alice',uuid:'a'.repeat(32)},bob={name:'Bob',uuid:'b'.repeat(32)};
    let starts=0,ends=0,owner=alice;
    const sessions=[alice,bob].map((a,i)=>({session:{...a,id:`s-${i}`,startedAt:1000,lastSeen:2000,endedAt:2000,games:[]},delta:{stats:{Bedwars:{wins_bedwars:i+1}}}}));
    const server=createHealthServer({
        state:{},proxyStartTime:Date.now(),chatTriggerManager:{getTriggers:()=>[]},globalCache:new Map(),auroraPingCache:new Map(),
        getActiveUser:()=>({...owner,client:{uuid:owner.uuid},startNewSession:async()=>{starts++;return{id:'new'};},endCurrentSession:async()=>{ends++;return 'ended';}}),
        getKeys:()=>({}),getServerConfigs:()=>[],getLastScanSummary:()=>null,getFeatures:()=>({}),proxyHealthSnapshot:()=>({}),getHypixelApiUsageSnapshot:()=>({}),getUrchinRateLimitSnapshot:()=>({}),hasHypixelApiKeyConfigured:()=>false,
        getSessionHistory:(account,accountScoped)=>buildLauncherSessionHistory(sessions,{account,accountScoped}),
        removeSession:(id,account)=>{const i=sessions.findIndex(row=>row.session.id===id&&(!account||sessionBelongsToAccount(row.session,account)));return i<0?{removed:false,reason:'not_found'}:{removed:true,session:sessions.splice(i,1)[0].session};},logger:{log(){},error(){}}
    }).start(0);
    try{
        await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
        const request=(route,method,account)=>fetch(base+route,{method,headers:{'content-type':'application/json'},body:JSON.stringify({account})});
        const health=await (await fetch(`${base}/health?includeSessions=1&sessionAccount=${encodeURIComponent(JSON.stringify(bob))}`)).json();
        assert.strictEqual(health.connectedUuid,alice.uuid);
        assert.deepStrictEqual(health.sessionHistory.sessions.map(s=>s.name),['Bob']);
        assert.strictEqual((await request('/session/start','POST',bob)).status,409);
        assert.strictEqual((await request('/session/end','POST',bob)).status,409);
        assert.strictEqual(starts+ends,0,'viewing Bob never changes the connected Alice session');
        assert.strictEqual((await request('/session/s-0','DELETE',bob)).status,404);
        assert.strictEqual(sessions.length,2,'a stale delete cannot remove another account history');
        assert.strictEqual((await request('/session/s-1','DELETE',bob)).status,200);
        owner=bob;
        assert.strictEqual((await request('/session/start','POST',alice)).status,409,'identity rechecked after Minecraft switches');
        assert.strictEqual((await request('/session/start','POST',bob)).status,200);
        assert.strictEqual((await request('/session/end','POST',bob)).status,200);
        assert.strictEqual(starts,1);assert.strictEqual(ends,1);
        const missing=await (await fetch(`${base}/health?includeSessions=1&sessionAccount=%7B%7D`)).json();
        assert.strictEqual(missing.sessionHistory.sessions.length,0,'empty scope never returns every account');
        console.log('Launcher HTTP account scope and stale-action checks passed.');
    }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
