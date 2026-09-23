'use strict';
const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');
const assert = require('assert/strict');
const http = require('http'), net = require('net'), os = require('os'), fs = require('fs');
const { once } = require('events');
const { ownListener } = require('../../src/bootstrap/shutdownResources');
const { ownIpv6Loopback } = require('../../src/net/loopback');
const { getJson, eventually } = require('../../scripts/smoke_packaged_app');
const path = require('path'), vm = require('vm');
async function proxyService(lan) {
    const { spawn } = require('child_process');
    const { unusedPorts, cleanEnvironment } = require('../../scripts/smoke_packaged_app');
    const { superviseChild } = require('../../src/bootstrap/childShutdown');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-proxy-loopback-')), children = [];
    try {
        const [direct, failover, health, cosmetic, blocked] = await unusedPorts(5);
        fs.writeFileSync(path.join(root,'server_config.json'),JSON.stringify({proxyDirectPort:direct,proxyFailoverPort:failover,healthPort:health}));
        fs.writeFileSync(path.join(root,'features_config.json'),JSON.stringify({apiKillSwitchEnabled:true,autoSkinDenickEnabled:false,autoStatsDenickEnabled:false}));
        const preload=path.join(root,'no-auth.cjs');
        fs.writeFileSync(preload,`require(${JSON.stringify(require.resolve('prismarine-auth'))}).Authflow.prototype.getMinecraftJavaToken=()=>{throw Error('Real authentication disabled in listener test');};`);
        for(let pass=0;pass<2;pass++) {
            const env=cleanEnvironment(root,REPOSITORY_ROOT,cosmetic,blocked); env.FURY_SERVICE_INSTANCE=require('crypto').randomUUID();
            const child=spawn(process.execPath,['--require',preload,require.resolve('../../proxy')],{env,cwd:root,windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
            children.push(child); let errors=''; child.stderr.on('data',x=>errors+=x);
            await eventually(async()=>{assert.equal(child.exitCode,null,errors);assert((await getJson(`http://127.0.0.1:${health}/health`)).ok);},'actual proxy ready');
            for(const port of [direct,failover]) {
                for(const host of ['127.0.0.1','localhost','::1']) {
                    const status=await require('minecraft-protocol').ping({host,port,version:'1.8.9',closeTimeout:1000,noPongTimeout:1000});
                    assert(status.version,'Minecraft status response');
                }
                for(const item of lan) await refused(item.address,port);
            }
            for(const item of lan) await refused(item.address,health);
            const activeIpv6 = net.connect({host:'::1',port:direct});
            activeIpv6.on('error',()=>{}); await once(activeIpv6,'connect');
            const result=await superviseChild(child,env.FURY_SERVICE_INSTANCE).stop(); assert(result.clean&&result.exited,JSON.stringify(result));
            await eventually(()=>assert(activeIpv6.destroyed),'active IPv6 socket closed by F7');
            for(const port of [direct,failover,health]) await refused('127.0.0.1',port);
        }
        console.log('PASS actual Minecraft direct/failover IPv4/localhost/IPv6, LAN rejection, health loopback and clean F7 Stop -> Start');
    } finally {
        for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
        for(const child of children)await eventually(()=>assert.notEqual(child.exitCode??child.signalCode,null),'proxy cleanup');
        fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
    }
}
async function cosmeticService(lan) {
    const { spawn } = require('child_process');
    const { cleanEnvironment, unusedPorts } = require('../../scripts/smoke_packaged_app');
    const { superviseChild } = require('../../src/bootstrap/childShutdown');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-local-services-'));
    const children = [];
    try {
        const preload = path.join(root, 'cloud-fixture.cjs');
        fs.writeFileSync(preload, `require(${JSON.stringify(require.resolve('axios'))}).get=async(url,options)=>{
require('assert/strict').equal(url,'https://bordic.xyz/api/v2/resources/superstar');
require('assert/strict').equal(options.params.key,'synthetic-key');
process.send({type:'fixture:outbound'});return {data:{success:true,data:[]}};};`);
        for (const desktop of [true, false]) {
            const [port, blocked] = await unusedPorts(2);
            const env = cleanEnvironment(root, REPOSITORY_ROOT, port, blocked);
            env.COSMETIC_SEARCH_PORT = String(port); env.AURORA_API_KEY = 'synthetic-key';
            env.COSMETIC_SEARCH_BIND_HOST = '0.0.0.0';
            if (desktop) env.FURY_SERVICE_INSTANCE = require('crypto').randomUUID();
            else delete env.FURY_SERVICE_INSTANCE;
            const child = spawn(process.execPath, ['--require',preload,require.resolve('../../cosmetic_search_api')], { env, cwd:root, windowsHide:true, stdio:['ignore','ignore','pipe','ipc'] });
            children.push(child); let outbound = false, errors = '';
            child.stderr.on('data',x=>errors+=x); child.on('message',m=>{if(m.type==='fixture:outbound')outbound=true;});
            await eventually(async()=>{assert.equal(child.exitCode,null,errors);assert((await getJson(`http://127.0.0.1:${port}/health`)).success);},'actual cosmetic service');
            if (desktop) {
                for(const host of ['localhost','[::1]']) await eventually(async()=>assert((await getJson(`http://${host}:${port}/health`)).success),host);
                for(const item of lan) await refused(item.address,port);
            } else {
                for(const item of lan) assert((await getJson(`http://${item.address}:${port}/health`)).success);
            }
            assert((await getJson(`http://127.0.0.1:${port}/api/cosmetics/search?killMessage=synthetic`)).success);
            assert(outbound,'outbound vendor client contract exercised with fixture');
            if(desktop) assert((await superviseChild(child,env.FURY_SERVICE_INSTANCE).stop()).clean);
            else { child.kill('SIGTERM'); await eventually(()=>assert.notEqual(child.exitCode??child.signalCode,null),'standalone exit'); }
        }
    } finally {
        for(const child of children) if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
        for(const child of children) await eventually(()=>assert.notEqual(child.exitCode??child.signalCode,null),'service cleanup');
        fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
    }
    // Exercise Main's existing outbound function without loading mutable owners.
    const source=fs.readFileSync(require.resolve('../../launcher'),'utf8');
    const body=source.slice(source.indexOf('async function searchDenickCosmetics('),source.indexOf('async function auroraStatLookup('));
    const calls=[];
    const search=vm.runInNewContext(body+';searchDenickCosmetics',{COSMETIC_SEARCH_API_URL:'https://cloud-fixture.invalid',COSMETIC_SEARCH_TOKEN:'synthetic-token',LAUNCHER_DENICK_MAX_RESULTS:100,axios:{get:async(url,options)=>{calls.push({url,options});return {data:{success:true,totalMatches:1,data:[{name:'Fixture'}]}};}}});
    assert.equal((await search([],10)).candidates[0].name,'Fixture');
    assert.equal(calls[0].url,'https://cloud-fixture.invalid/api/cosmetics/search');
    assert.equal(calls[0].options.params.token,'synthetic-token');
    assert.equal(calls[0].options.params.limit,10);
    const noop=()=>{};
    const commands=require('../../src/denick/commands').createDenickCommands({axios:{get:async(url,options)=>{calls.push({url,options});return {data:{success:true,data:[]}};}},sendChat:noop,getKeys:()=>({}),hasHypixelApiKeyConfigured:()=>false,cosmeticSearchApiUrl:'https://cloud-fixture.invalid',getCosmeticSearchToken:()=> 'synthetic-token',denickRange:1,formatInt:String,getPlayerData:noop,getRealNameFromSkin:noop,isMinecraftUsername:()=>true,appendDenickHistory:noop,parseDenickFilters:noop});
    await commands.findDenickCandidatesByCosmetics({killMessage:'synthetic'});
    assert.equal(calls[1].url,'https://cloud-fixture.invalid/api/cosmetics/search');
    assert.equal(calls[1].options.params.token,'synthetic-token');
    const local=source.slice(source.indexOf('function cosmeticSearchIsLocal()'),source.indexOf('function cosmeticSearchEnvironment()'));
    for(const [url,expected] of [['http://[::1]:3210',true],['http://localhost:3210',true],['https://cloud-fixture.invalid',false]]) {
        assert.equal(vm.runInNewContext(local+';cosmeticSearchIsLocal()',{URL,COSMETIC_SEARCH_API_URL:url}),expected);
    }
    console.log('PASS actual Cosmetic Search: forced desktop loopback, standalone remote opt-in, mocked outbound vendor/Main API and F7 stop');
}
function refused(host, port) {
    return new Promise((resolve, reject) => {
        const socket = net.connect({ host, port });
        socket.setTimeout(800);
        socket.once('connect', () => { socket.destroy(); reject(Error(`Non-loopback listener accepted ${host}`)); });
        socket.once('error', error => { socket.destroy(); resolve(error.code); });
        socket.once('timeout', () => { socket.destroy(); resolve('TIMEOUT'); });
    });
}
async function main() {
    const lan = Object.values(os.networkInterfaces()).flat().filter(item => !item.internal && item.family === 'IPv4');
    let port = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
        const server = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true })); });
        const owner = ownListener(server), warnings = [];
        const ipv6 = ownIpv6Loopback(server, { warn: message => warnings.push(message) });
        try {
            server.listen(port, '127.0.0.1'); await once(server, 'listening'); port = server.address().port;
            for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
                if (host === '[::1]' && warnings.length) { console.log('NOT TESTED native IPv6: unavailable'); continue; }
                await eventually(async () => assert.equal((await getJson(`http://${host}:${port}/`)).ok, true), host);
            }
            for (const item of lan) await refused(item.address, port);
        } finally {
            owner.quiesce(); ipv6.quiesce(); await Promise.all([owner.close(), ipv6.close()]);
        }
        await refused('127.0.0.1', port); await refused('::1', port);
    }
    // Quiescence before initial listen must not start an unowned IPv6 listener.
    const neverStarted = net.createServer(), ipv6 = ownIpv6Loopback(neverStarted);
    ipv6.quiesce(); await ipv6.close(); assert.equal(neverStarted.listenerCount('listening'), 0);
    const pending = net.createServer(); pending.listen(0, '127.0.0.1'); await once(pending, 'listening');
    const pendingPort = pending.address().port, pendingIpv6 = ownIpv6Loopback(pending);
    await pendingIpv6.close(); await new Promise(resolve => setImmediate(resolve));
    await refused('::1', pendingPort); await new Promise(resolve => pending.close(resolve));
    const proxy = fs.readFileSync(require.resolve('../../proxy'), 'utf8');
    assert(proxy.includes("host: '127.0.0.1'")); assert(proxy.includes('ownIpv6Loopback(proxy.socketServer)'));
    const cosmetic = fs.readFileSync(require.resolve('../../cosmetic_search_api'), 'utf8');
    assert(cosmetic.includes('app.listen(PORT, BIND_HOST')); assert(cosmetic.includes('ownIpv6Loopback(listener)'));
    const { cosmeticBindHost } = require('../../src/net/cosmeticBind');
    assert.equal(cosmeticBindHost({}), '127.0.0.1');
    assert.equal(cosmeticBindHost({ COSMETIC_SEARCH_BIND_HOST: '0.0.0.0' }), '0.0.0.0');
    assert.equal(cosmeticBindHost({ COSMETIC_SEARCH_BIND_HOST: '::' }), '::');
    assert.equal(cosmeticBindHost({ COSMETIC_SEARCH_BIND_HOST: '0.0.0.0', FURY_SERVICE_INSTANCE: 'desktop-test' }), '127.0.0.1');
    assert.throws(() => cosmeticBindHost({ COSMETIC_SEARCH_BIND_HOST: 'untrusted.invalid' }), /explicit/);
    const health = fs.readFileSync(require.resolve('../../src/health/httpServer'), 'utf8');
    assert(health.includes("'127.0.0.1'"));
    console.log(`PASS HTTP IPv4/localhost/IPv6, listener drain/rebind, LAN rejection (${lan.length} interface(s))`);
    await cosmeticService(lan);
    await proxyService(lan);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
