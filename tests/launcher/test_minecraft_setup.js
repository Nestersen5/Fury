'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const nbt=require('prismarine-nbt');
const {createMinecraftSetup}=require('../../src/launcher/minecraftSetup');
const {detectRunningClients}=require('../../src/launcher/minecraftClientDetection');
const {registerMinecraftSetup}=require('../../src/launcher/minecraftSetupIpc');
const entry=(name,ip)=>({name:{type:'string',value:name},ip:{type:'string',value:ip},icon:{type:'string',value:'preserve-icon'},acceptTextures:{type:'byte',value:1}});
const root=entries=>({type:'compound',name:'',value:{servers:{type:'list',value:{type:'compound',value:entries}},other:{type:'string',value:'preserve-root-tag'}}});
async function fixture(t,options={}){
 // macOS /var is an alias for /private/var; compare canonical fixture paths.
 const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'fury-minecraft-setup-')));t.after(async()=>{assert.ok(path.basename(dir).startsWith('fury-minecraft-setup-'));await fs.rm(dir,{recursive:true,force:true});});
 const game=path.join(dir,'.minecraft'),data=path.join(dir,'fury');await fs.mkdir(game);
 const original=root([entry('Hypixel','mc.hypixel.net'),entry('Fury Design Lab','my-own-server.example'),entry('Another server','example.test')]);
 const raw=nbt.writeUncompressed(original);await fs.writeFile(path.join(game,'servers.dat'),raw);
 const settings={proxyDirectPort:42565,proxyDirectHost:'mc.hypixel.net',proxyFailoverPort:42568,proxyFailoverHost:'free.stopthelag.lol',proxyCustomPort:42566,proxyCustomHost:'hypixel.fast'};
 const config={directory:data,home:dir,appData:dir,platform:'win32',getServerSettings:()=>settings,entryPrefix:'Fury Design Lab',...options};
 const service=createMinecraftSetup(config),target=await service.register(game,'Test Minecraft');
 return{dir,game,data,original,raw,settings,config,service,target,file:path.join(game,'servers.dat'),read:async()=>nbt.parseUncompressed(await fs.readFile(path.join(game,'servers.dat')))};
}
const request=p=>({id:p.id,revision:p.revision,settingsKey:p.settingsKey});
test('Discovery and preview do not write; additions preserve original data and avoid names belonging to the user',async t=>{
 const f=await fixture(t);assert.equal((await f.service.discover()).targets.length,1);const p=await f.service.inspect(f.target.id);assert.equal(p.servers.length,3);assert.equal(p.servers[0].name,'Fury Design Lab (2)');
 assert.deepEqual(await fs.readFile(f.file),f.raw);await assert.rejects(fs.stat(f.data),{code:'ENOENT'});
 const result=await f.service.add(request(p));assert.equal(result.changed,3);assert.deepEqual(await fs.readFile(result.backup),f.raw);
 const saved=await f.read();assert.equal(saved.value.servers.value.value[0].ip.value,'localhost:42565');assert.deepEqual(saved.value.servers.value.value.slice(1,4),f.original.value.servers.value.value);assert.deepEqual(saved.value.servers.value.value.slice(4).map(e=>e.ip.value),['localhost:42568','localhost:42566']);assert.equal(saved.value.other.value,'preserve-root-tag');assert.equal(saved.value.servers.value.value.length,6);
 const again=await f.service.add(request(await f.service.inspect(f.target.id)));assert.equal(again.changed,0);assert.equal((await f.read()).value.servers.value.value.length,6);
 assert.equal((await createMinecraftSetup(f.config).summary()).ready,true);
});
test('Port and destination updates touch only owned entries and preserve client-written fields',async t=>{
 const f=await fixture(t);await f.service.add(request(await f.service.inspect(f.target.id)));const saved=await f.read();saved.value.servers.value.value[0].icon={type:'string',value:'client-cached-icon'};await fs.writeFile(f.file,nbt.writeUncompressed(saved));
 f.settings.proxyDirectPort=42570;f.settings.proxyCustomHost='new.example';const p=await f.service.inspect(f.target.id);assert.equal(p.ready,false);await f.service.add(request(p));const next=await f.read();
 assert.equal(next.value.servers.value.value[0].ip.value,'localhost:42570');assert.equal(next.value.servers.value.value[0].icon.value,'client-cached-icon');assert.match(next.value.servers.value.value[5].name.value,/new\.example/);assert.equal(next.value.servers.value.value.length,6);assert.deepEqual(next.value.servers.value.value.slice(1,4),f.original.value.servers.value.value);
});
test('Independent Fury and Design Lab ownership can share a Minecraft list without changing one another',async t=>{
 const f=await fixture(t);await f.service.add(request(await f.service.inspect(f.target.id)));
 const mainSettings={...f.settings,proxyDirectPort:25565,proxyFailoverPort:25568,proxyCustomPort:25566};const main=createMinecraftSetup({...f.config,directory:path.join(f.dir,'main-fixture'),entryPrefix:'Fury',getServerSettings:()=>mainSettings}),mainTarget=await main.register(f.game);
 await main.add(request(await main.inspect(mainTarget.id)));const mainRows=rows=>rows.filter(e=>/^localhost:255(?:65|68|66)$/.test(e.ip.value)),before=mainRows((await f.read()).value.servers.value.value);f.settings.proxyFailoverPort=42569;await f.service.add(request(await f.service.inspect(f.target.id)));assert.deepEqual(mainRows((await f.read()).value.servers.value.value),before);assert.equal((await f.read()).value.servers.value.value.length,9);
});
test('Changed server files and changed Fury settings reject stale Add actions',async t=>{
 const f=await fixture(t),p=await f.service.inspect(f.target.id),changed=await f.read();changed.value.servers.value.value.push(entry('Player added this','other.example'));const bytes=nbt.writeUncompressed(changed);await fs.writeFile(f.file,bytes);
 await assert.rejects(f.service.add(request(p)),/Minecraft changed/);assert.deepEqual(await fs.readFile(f.file),bytes);
 const next=await f.service.inspect(f.target.id);f.settings.proxyDirectPort++;await assert.rejects(f.service.add(request(next)),/settings changed/);assert.deepEqual(await fs.readFile(f.file),bytes);
});
test('An external write at commit wins; retry creates one set and retains that external entry',async t=>{
 let interfere=true;const f=await fixture(t,{beforeCommit:async folder=>{if(interfere){interfere=false;const r=root([entry('Changed by Minecraft','changed.example')]);await fs.writeFile(path.join(folder,'servers.dat'),nbt.writeUncompressed(r));}}});
 await assert.rejects(f.service.add(request(await f.service.inspect(f.target.id))),/Nothing was replaced/);assert.equal((await f.read()).value.servers.value.value[0].name.value,'Changed by Minecraft');
 await f.service.add(request(await f.service.inspect(f.target.id)));assert.equal((await f.read()).value.servers.value.value.length,4);assert.deepEqual((await fs.readdir(f.game)).filter(n=>n.endsWith('.tmp')),[]);
});
test('An interrupted port update keeps previous ownership for a duplicate-free retry',async t=>{
 const f=await fixture(t);await f.service.add(request(await f.service.inspect(f.target.id)));f.settings.proxyDirectPort=42577;
 const broken=createMinecraftSetup({...f.config,beforeCommit:async()=>{throw new Error('simulated interrupted write');}}),target=await broken.register(f.game);
 await assert.rejects(broken.add(request(await broken.inspect(target.id))),/interrupted/);assert.equal((await f.read()).value.servers.value.value[0].ip.value,'localhost:42565');
 await f.service.add(request(await f.service.inspect(f.target.id)));assert.equal((await f.read()).value.servers.value.value.length,6);assert.equal((await f.read()).value.servers.value.value[0].ip.value,'localhost:42577');
});
test('No backing state or backup write means no server-file replacement',async t=>{
 const f=await fixture(t,{writeAtomic:async()=>{throw new Error('state is not writable');}});await assert.rejects(f.service.add(request(await f.service.inspect(f.target.id))),/not writable/);assert.deepEqual(await fs.readFile(f.file),f.raw);
});
test('An oversized ownership record is rejected before replacing Minecraft data',async t=>{
 const f=await fixture(t);await fs.mkdir(f.data);const data={version:1,targets:{fixture:{padding:''}}};const overhead=Buffer.byteLength(JSON.stringify(data));data.targets.fixture.padding='x'.repeat(256*1024-overhead-20);await fs.writeFile(path.join(f.data,'minecraft-setup.json'),JSON.stringify(data));
 await assert.rejects(f.service.add(request(await f.service.inspect(f.target.id))),/too many saved installation details/);assert.deepEqual(await fs.readFile(f.file),f.raw);
});
test('Compressed lists, empty vanilla lists and new server lists are supported',async t=>{
 const f=await fixture(t);await fs.writeFile(f.file,zlib.gzipSync(f.raw));await f.service.add(request(await f.service.inspect(f.target.id)));const bytes=await fs.readFile(f.file);assert.equal(bytes[0],31);assert.equal((await nbt.parse(bytes)).parsed.value.servers.value.value.length,6);
 const empty=root([]);empty.value.servers.value.type='end';await fs.writeFile(f.file,nbt.writeUncompressed(empty));await f.service.add(request(await f.service.inspect(f.target.id)));assert.equal((await f.read()).value.servers.value.value.length,3);
 await fs.unlink(f.file);await fs.writeFile(path.join(f.game,'options.txt'),'test fixture');await f.service.add(request(await f.service.inspect(f.target.id)));assert.equal((await f.read()).value.servers.value.value.length,3);
});
test('Malformed lists, linked files, unknown targets and non-game folders cannot be overwritten',async t=>{
 const f=await fixture(t);await fs.writeFile(f.file,Buffer.concat([f.raw,Buffer.from([42])]));await assert.rejects(f.service.inspect(f.target.id),/could not be read/);await assert.rejects(f.service.add({id:'unknown'}),/Choose/);await assert.rejects(f.service.register(f.dir),/game folder/);
 await fs.unlink(f.file);const source=path.join(f.dir,'source.dat');await fs.writeFile(source,f.raw);
 try{await fs.symlink(source,f.file);}catch(e){if(e.code==='EPERM'){t.diagnostic('Native Windows symlink creation unavailable; linked-file case skipped.');return;}throw e;}
 await assert.rejects(f.service.inspect(f.target.id),/not a regular file/);assert.deepEqual(await fs.readFile(source),f.raw);
});
test('Simultaneous Add requests cannot append two copies',async t=>{
 const f=await fixture(t),p=request(await f.service.inspect(f.target.id)),results=await Promise.allSettled([f.service.add(p),f.service.add(p)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.read()).value.servers.value.value.length,6);
});
test('Existing manual addresses are reused intact, with only the main connection moved first',async t=>{
 const f=await fixture(t),r=await f.read();r.value.servers.value.value.push(entry('My own direct entry','127.0.0.1:42565'),entry('My own backup','[::1]:42568'),entry('My own custom entry','localhost:42566'));const raw=nbt.writeUncompressed(r);await fs.writeFile(f.file,raw);
 const p=await f.service.inspect(f.target.id);assert.equal(p.ready,false);assert.deepEqual(p.servers.map(s=>s.action),['move','ready','ready']);const result=await f.service.add(request(p));assert.equal(result.changed,1);assert.deepEqual(await fs.readFile(result.backup),raw);
 const expected=[r.value.servers.value.value[3],...r.value.servers.value.value.slice(0,3),...r.value.servers.value.value.slice(4)];assert.deepEqual((await f.read()).value.servers.value.value,expected);assert.equal((await f.service.summary()).ready,true);
 const reordered=await fs.readFile(f.file);assert.equal((await f.service.add(request(await f.service.inspect(f.target.id)))).changed,0);assert.deepEqual(await fs.readFile(f.file),reordered);
 f.settings.proxyDirectPort=42590;await f.service.add(request(await f.service.inspect(f.target.id)));const after=await f.read();assert.deepEqual(after.value.servers.value.value.slice(1),expected);assert.equal(after.value.servers.value.value.length,7);
});
test('A manually added destination prevents an owned entry from being updated into a duplicate',async t=>{
 const f=await fixture(t);await f.service.add(request(await f.service.inspect(f.target.id)));const r=await f.read();r.value.servers.value.value.push(entry('My new port','localhost:42591'));const raw=nbt.writeUncompressed(r);await fs.writeFile(f.file,raw);f.settings.proxyDirectPort=42591;
 assert.equal((await f.service.add(request(await f.service.inspect(f.target.id)))).changed,1);assert.deepEqual((await f.read()).value.servers.value.value,[r.value.servers.value.value.at(-1),...r.value.servers.value.value.slice(0,-1)]);assert.equal((await f.service.add(request(await f.service.inspect(f.target.id)))).changed,0);
});

test('Only missing proxy connections are appended, even when matching entries have unrelated names',async t=>{
 const f=await fixture(t),r=await f.read(),existing=entry('My renamed backup',' LOCALHOST.:42568 ');r.value.servers.value.value.splice(1,0,existing);await fs.writeFile(f.file,nbt.writeUncompressed(r));
 const p=await f.service.inspect(f.target.id);assert.deepEqual(p.servers.map(s=>s.action),['add','ready','add']);assert.equal((await f.service.add(request(p))).changed,2);
 const rows=(await f.read()).value.servers.value.value;assert.equal(rows[0].ip.value,'localhost:42565');assert.deepEqual(rows.slice(1,-1),r.value.servers.value.value);assert.equal(rows.at(-1).ip.value,'localhost:42566');assert.equal(rows.filter(e=>e.name.value===existing.name.value).length,1);
});

test('An owned main entry is moved intact from the bottom without disturbing updates to other original indices',async t=>{
 const f=await fixture(t);await f.service.add(request(await f.service.inspect(f.target.id)));const r=await f.read(),rows=r.value.servers.value.value,main=rows.shift();main.icon={type:'string',value:'keep-main-icon'};main.extra={type:'int',value:42};rows.push(main);const previous=structuredClone(rows);await fs.writeFile(f.file,nbt.writeUncompressed(r));f.settings.proxyCustomHost='changed.example';
 const p=await f.service.inspect(f.target.id);assert.deepEqual(p.servers.map(s=>s.action),['move','ready','update']);await f.service.add(request(p));const saved=(await f.read()).value.servers.value.value;
 assert.deepEqual(saved[0],main);assert.deepEqual(saved.slice(1,5),previous.slice(0,4));assert.match(saved[5].name.value,/changed\.example/);assert.equal(saved[5].ip.value,'localhost:42566');assert.equal((await f.service.inspect(f.target.id)).ready,true);
});

test('Default-port and IPv4/IPv6 aliases already at the correct positions do not rewrite the list',async t=>{
 const f=await fixture(t);Object.assign(f.settings,{proxyDirectPort:25565,proxyFailoverPort:25568,proxyCustomPort:25566});const r=root([entry('My Fury connection',' LOCALHOST '),...f.original.value.servers.value.value,entry('Backup','127.0.0.1:25568'),entry('Other','[::1]:25566')]),raw=nbt.writeUncompressed(r);await fs.writeFile(f.file,raw);
 const p=await f.service.inspect(f.target.id);assert.equal(p.ready,true);assert.deepEqual(p.servers.map(s=>s.action),['ready','ready','ready']);assert.equal((await f.service.add(request(p))).changed,0);assert.deepEqual(await fs.readFile(f.file),raw);
});

test('Pre-existing duplicate addresses are not multiplied and promoting the owned main is idempotent',async t=>{
 const f=await fixture(t);await f.service.add(request(await f.service.inspect(f.target.id)));const r=await f.read(),rows=r.value.servers.value.value,main=rows.shift();rows.unshift(entry('Another matching main','localhost:42565'));rows.push(main);await fs.writeFile(f.file,nbt.writeUncompressed(r));
 await f.service.add(request(await f.service.inspect(f.target.id)));const saved=(await f.read()).value.servers.value.value;assert.deepEqual(saved[0],main);assert.equal(saved.length,7);assert.equal(saved.filter(e=>e.ip.value==='localhost:42565').length,2);assert.equal((await f.service.inspect(f.target.id)).ready,true);
 const bytes=await fs.readFile(f.file);assert.equal((await f.service.add(request(await f.service.inspect(f.target.id)))).changed,0);assert.deepEqual(await fs.readFile(f.file),bytes);
});
test('Windows and macOS default-folder discovery, instance labels and canonical folder deduplication',async t=>{
 const f=await fixture(t);await f.service.register(path.join(f.game,'.'),'Lunar Client');assert.equal((await f.service.discover()).targets.length,1);
 const instance=path.join(f.dir,'PrismLauncher','instances','my-instance');await fs.mkdir(path.join(instance,'.minecraft'),{recursive:true});await fs.writeFile(path.join(instance,'instance.cfg'),'name=Skyblock\n');await fs.writeFile(path.join(instance,'.minecraft','options.txt'),'fixture');
 const list=await f.service.discover();assert.ok(list.targets.some(x=>x.label==='Prism Launcher · Skyblock'));assert.equal((await f.service.register(instance)).directory,path.join(instance,'.minecraft'));
 const mac=path.join(f.dir,'Library','Application Support','minecraft');await fs.mkdir(mac,{recursive:true});await fs.writeFile(path.join(mac,'options.txt'),'fixture');const service=createMinecraftSetup({...f.config,platform:'darwin'});assert.ok((await service.discover()).targets.some(x=>x.directory===mac));
});
test('Detection is opt-in, bounded, and discards unrelated command data',async()=>{
 let calls=0;const detected=await detectRunningClients({platform:'win32',run:async(file,args,options)=>{calls++;assert.equal(options.windowsHide,true);assert.ok(options.timeout<=6000);assert.ok(!args.includes('-EncodedCommand'));assert.ok(!args.includes('-ExecutionPolicy'));return{stdout:JSON.stringify([{directory:'C:\\Minecraft',client:'Lunar Client',version:'1.8.9',commandLine:'do-not-return-login-data'}])};}});
 assert.equal(calls,1);assert.deepEqual(detected,[{directory:'C:\\Minecraft',client:'Lunar Client',version:'1.8.9'}]);await assert.rejects(detectRunningClients({platform:'darwin',run:()=>{throw Error('must not run');}}),/not available/);
 await assert.rejects(detectRunningClients({platform:'win32',run:async()=>{throw Error('private stdout');}}),e=>!e.message.includes('private stdout'));
});
test('IPC validates the window and selected targets; listing never invokes running-client detection',async t=>{
 const f=await fixture(t),handlers=new Map();let detects=0,picked=f.game;
 const bridge=registerMinecraftSetup({handle:(name,fn)=>handlers.set(name,fn),app:{getName:()=> 'Fury Design Lab',getPath:name=>name==='home'?f.dir:f.dir},dialog:{showOpenDialog:async()=>({canceled:!picked,filePaths:picked?[picked]:[]})},getWindow:()=>null,authorize:e=>e.trusted,directory:path.join(f.dir,'ipc-state'),getServerSettings:()=>f.settings,detect:async()=>{detects++;return[{directory:f.game,client:'Lunar Client',version:'1.8.9'}];}});
 const invoke=(name,...args)=>handlers.get('minecraft-setup:'+name)({trusted:true},...args);
 assert.throws(()=>handlers.get('minecraft-setup:list')({trusted:false}),/not available/);await invoke('summary');await invoke('list');assert.equal(detects,0);const target=await invoke('choose');const result=await invoke('inspect',target.id);assert.equal(result.ready,false);await assert.rejects(Promise.resolve().then(()=>invoke('add',{id:'../other'})),/Choose/);
 const found=await invoke('detect');assert.equal(detects,1);assert.equal(found.targets.length,1);assert.match(found.targets[0].label,/Lunar Client/);picked=null;assert.equal(await invoke('choose'),null);bridge.dispose();assert.throws(()=>invoke('list'),/not available/);assert.deepEqual(await fs.readFile(f.file),f.raw);
});
