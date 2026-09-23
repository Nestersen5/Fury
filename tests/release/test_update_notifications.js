'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const http = require('http');
const { performance } = require('perf_hooks');
const { stableVersion, compareVersions, validateManifest, endpoint, readManifest, createUpdateNotifications, MAX_BYTES, TIMEOUT_MS } = require('../../src/updates/updateNotifications');
const release = { manifestUrl: 'https://furyproxy.online/latest.json', downloadPageUrl: 'https://furyproxy.online/' };
const manifest = extra => ({ schemaVersion: 1, latestVersion: '1.0.8', releasePageUrl: release.downloadPageUrl, ...extra });
const service = extra => createUpdateNotifications({ installedVersion: '1.0.7', isPackaged: true, release, read: async () => manifest(), openExternal: async () => {}, ...extra });

test('stable SemVer numeric ordering, metadata and unsupported versions', () => {
    for (const [a, b] of [['1.0.8','1.0.7'], ['1.1.0','1.0.99'], ['2.0.0','1.99.99'], ['1.0.10','1.0.9']]) {
        assert.equal(compareVersions(a,b),1); assert.equal(compareVersions(b,a),-1);
    }
    assert.equal(compareVersions('1.0.8+build.1','1.0.8+other'),0);
    assert.equal(compareVersions('1.0.8','1.0.8'),0);
    for (const value of [null, 8, '', 'v1.0.8', '1.0', '01.0.8', '1.00.8', '1.0.8 ', '1.0.8\n', '1.0.8-beta.1', '1.0.8+', '1.0.8+..', '9007199254740992.0.0']) {
        assert.equal(stableVersion(value),null); assert.throws(()=>compareVersions(value,'1.0.0'));
    }
});

test('manifest allowlist, bounds, version, dates and fixed safe destination', () => {
    assert.deepEqual(validateManifest(manifest({ summary: '<b>Plain text only</b>', releasedAt: '2026-09-20T12:00:00Z', minimumSupportedVersion: '1.0.0' })),
        {version:'1.0.8',summary:'<b>Plain text only</b>'});
    for (const value of [null, [], {}, manifest({schemaVersion:2}), manifest({schemaVersion:'1'}), manifest({latestVersion:'2.0.0-beta'}),
        manifest({latestVersion:'x'.repeat(65)}), manifest({summary:[]}), manifest({summary:'x'.repeat(281)}), manifest({summary:'line\nbreak'}),
        manifest({releasedAt:'2026-02-30T12:00:00Z'}), manifest({releasedAt:5}), manifest({minimumSupportedVersion:'9.0.0'}),
        manifest({artifacts:[]}), manifest({releasePageUrl:undefined}), manifest({latestVersion:undefined})]) assert.throws(()=>validateManifest(value));
    for(const url of ['javascript:alert(1)','file:///C:/temp/app.exe','http://furyproxy.online/','https://evil.example/',
        'https://furyproxy.online.evil.example/','https://user:pass@furyproxy.online/','https://furyproxy.online/download/file.exe',
        'https://furyproxy.online/?user=secret','https://furyproxy.online/#download','https://furyproxy.online/\n']) {
        assert.throws(()=>validateManifest(manifest({releasePageUrl:url})));
    }
});

test('development requires deliberate loopback override; packaged mode ignores overrides', async () => {
    let calls=0;
    const read=async()=>{calls++;return manifest();};
    assert.equal(await service({isPackaged:false,env:{},read}).check(),null);
    assert.equal(await service({isPackaged:false,env:{FURY_UPDATE_TEST_URL:'http://127.0.0.1:1234/latest.json'},read}).check(),null);
    assert.equal(calls,0);
    const env={FURY_UPDATE_TEST_MODE:'1',FURY_UPDATE_TEST_URL:'http://127.0.0.1:1234/latest.json'};
    assert.equal((await service({isPackaged:false,env,read}).check()).version,'1.0.8');
    assert.equal(endpoint({isPackaged:true,env,release}).href,release.manifestUrl);
    assert.equal(endpoint({isPackaged:true,env,release:{...release,manifestUrl:null}}),null);
    for(const url of ['http://example.com/latest.json','https://127.0.0.1/latest.json','http://127.0.0.1/?token=abc'])
        assert.throws(()=>endpoint({isPackaged:false,env:{...env,FURY_UPDATE_TEST_URL:url},release}));
    assert.throws(()=>endpoint({isPackaged:true,env:{},release:{...release,manifestUrl:'https://evil.example/latest.json'}}));
});

test('one check and one offer per session, no automatic browser action or retry', async () => {
    let reads=0, opens=[];
    const updates=service({read:async()=>{reads++;return manifest();},openExternal:async url=>opens.push(url)});
    assert.equal(await updates.open(),false);
    const replies=await Promise.all([updates.check(),updates.check(),updates.check()]);
    assert.equal(replies.filter(Boolean).length,1); assert.equal(reads,1); assert.deepEqual(opens,[]);
    assert.equal(await updates.check(),null);
    assert.equal(await updates.open('file:///arbitrary.exe'),true); assert.deepEqual(opens,[release.downloadPageUrl]);
    updates.dispose(); assert.equal(await updates.open(),false);
    const failed=service({read:async()=>{reads++;throw Error('Offline');}});
    assert.equal(await failed.check(),null); assert.equal(await failed.check(),null); assert.equal(reads,2);
});

test('equal/newer installed versions, prereleases and malformed manifests stay silent', async () => {
    for(const installedVersion of ['1.0.8','1.1.0','2.0.0','1.0.7-beta.1','bad']) assert.equal(await service({installedVersion}).check(),null);
    assert.equal(await service({read:async()=>manifest({latestVersion:'2.0.0-beta.1'})}).check(),null);
    assert.equal(await service({read:async()=>({})}).check(),null);
});

test('shutdown cancels work and suppresses late offers', async () => {
    let finish, signal;
    const updates=service({read:(_url,options)=>{signal=options.signal;return new Promise(resolve=>{finish=resolve;});}});
    const pending=updates.check();updates.dispose();assert(signal.aborted);finish(manifest());
    assert.equal(await pending,null);assert.equal(await updates.open(),false);
});

test('all six distribution labels use the same version and release-page contract', async () => {
    for(const label of ['win-x64-nsis','win-x64-zip','mac-x64-dmg','mac-x64-zip','mac-arm64-dmg','mac-arm64-zip']) {
        let opened;
        const updates=service({openExternal:async url=>{opened=url;}});
        assert.equal((await updates.check()).version,'1.0.8',label);
        await updates.open();assert.equal(opened,release.downloadPageUrl,label);
    }
});

test('real anonymous GET: status, timeout, malformed/oversized input, redirects and cancellation', async t => {
    const requests=[], sockets=new Set();let redirectHits=0;
    const server=http.createServer((req,res)=>{
        requests.push({url:req.url,headers:req.headers});
        res.setHeader('Content-Type','application/json');
        if(req.url==='/hang')return;
        if(req.url==='/redirect'){res.writeHead(302,{Location:'/target'});res.end();return;}
        if(req.url==='/target')redirectHits++;
        if(req.url==='/large'){res.end('x'.repeat(MAX_BYTES+1));return;}
        if(req.url==='/chunked'){res.write('x'.repeat(MAX_BYTES));res.end('x');return;}
        if(req.url==='/malformed'){res.end('{bad');return;}
        if(req.url==='/html'){res.setHeader('Content-Type','text/html');res.end('{}');return;}
        if(req.url==='/404'||req.url==='/500')res.statusCode=Number(req.url.slice(1));
        res.end(JSON.stringify(manifest()));
    });
    server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});
    const url=route=>new URL(`http://127.0.0.1:${server.address().port}${route}`);
    assert.deepEqual(await readManifest(url('/latest.json')),manifest());
    assert.deepEqual(Object.keys(requests[0].headers).sort(),['accept','connection','host']);
    assert.equal(requests[0].headers.accept,'application/json');assert.equal(requests[0].url,'/latest.json');
    for(const route of ['/404','/500','/malformed','/html','/large','/chunked','/redirect']) await assert.rejects(readManifest(url(route)));
    assert.equal(redirectHits,0);
    const started=performance.now();await assert.rejects(readManifest(url('/hang'),{timeoutMs:80}),/timed out/);
    const elapsed=performance.now()-started;assert(elapsed<1500);console.log(`Update timeout fixture: ${elapsed.toFixed(1)} ms; production deadline ${TIMEOUT_MS} ms`);
    const controller=new AbortController(),cancelled=readManifest(url('/hang'),{signal:controller.signal});controller.abort();await assert.rejects(cancelled,/cancelled/);
    // A real refused connection, while the owned fixture server keeps this test alive.
    const unused=http.createServer();await new Promise(resolve=>unused.listen(0,'127.0.0.1',resolve));const port=unused.address().port;
    await new Promise(resolve=>unused.close(resolve));await assert.rejects(readManifest(new URL(`http://127.0.0.1:${port}/latest.json`)));
});
