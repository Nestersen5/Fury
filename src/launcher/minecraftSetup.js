'use strict';

const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {promisify}=require('node:util');
const {writeFileAtomic}=require('../storage/atomic_file');
let nbt;const codec=()=>nbt||(nbt=require('prismarine-nbt'));
const unzip=promisify(zlib.gunzip),zip=promisify(zlib.gzip);
const MAX_FILE=8*1024*1024,MAX_PLAIN=16*1024*1024;
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>a.name===b.name&&a.address===b.address;
const identity=e=>({name:e.name?.value,address:e.ip?.value});
const endpoint=address=>{const value=String(address||'').trim(),match=/^(?:localhost\.?|127\.0\.0\.1|\[::1\])(?::(\d+))?$/i.exec(value);return match?`loopback:${Number(match[1]||25565)}`:value;};
const clean=s=>String(s||'').replace(/[\x00-\x1f\x7f§]/g,'').slice(0,160);
const fail=message=>{throw new Error(message);};

function createMinecraftSetup({directory,home,appData,platform=process.platform,getServerSettings,entryPrefix='Fury',writeAtomic=writeFileAtomic,beforeCommit=async()=>{}}){
 const targets=new Map(),stateFile=path.join(directory,'minecraft-setup.json');
 let queue=Promise.resolve();
 const key=p=>digest(Buffer.from(platform==='win32'?p.toLowerCase():p));
 async function state(){
  try{const stat=await fs.stat(stateFile);if(stat.size>256*1024)return{version:1,targets:{}};const s=JSON.parse(await fs.readFile(stateFile,'utf8'));if(s.version===1&&s.targets&&typeof s.targets==='object'&&!Array.isArray(s.targets))return s;}catch{}
  return{version:1,targets:{}};
 }
 async function save(s){const json=JSON.stringify(s);if(Buffer.byteLength(json)>256*1024)fail('There are too many saved installation details to update safely.');await writeAtomic(stateFile,json);}
 function routes(){
  const s=getServerSettings(),prefix=clean(entryPrefix),items=[['direct',s.proxyDirectPort,s.proxyDirectHost],['failover',s.proxyFailoverPort,s.proxyFailoverHost],['custom',s.proxyCustomPort,s.proxyCustomHost]];
  return items.filter(([,port])=>Number.isInteger(port)&&port>0&&port<=65535).map(([route,port,host])=>({route,name:route==='direct'?prefix:`${prefix} · Proxy (${clean(host)})`,address:`localhost:${port}`,host:clean(host)}));
 }
 async function register(folder,label='Minecraft'){
  if(typeof folder!=='string'||!path.isAbsolute(folder))fail('Choose a Minecraft game folder.');
  let real;try{real=await fs.realpath(folder);if(!(await fs.stat(real)).isDirectory())throw Error();}catch{fail('That folder is no longer available. Choose it again.');}
  // Selecting a Prism/MultiMC instance directory is equivalent to its game folder.
  if(!await exists(path.join(real,'servers.dat'))&&await exists(path.join(real,'instance.cfg'))&&await exists(path.join(real,'.minecraft')))real=await fs.realpath(path.join(real,'.minecraft'));
  if(!await exists(path.join(real,'servers.dat'))&&!await exists(path.join(real,'options.txt'))&&!await exists(path.join(real,'saves')))fail('Choose the game folder containing servers.dat or options.txt.');
  const id=key(real),existing=targets.get(id);
  if(!existing&&targets.size>=96)fail('Too many installations were found. Choose a game folder instead.');
  const target={id,directory:real,label:clean(label)||'Minecraft'};targets.set(id,target);return target;
 }
 async function exists(file){try{await fs.access(file);return true;}catch{return false;}}
 async function read(target){
  if(await fs.realpath(target.directory)!==target.directory)fail('The selected game folder changed. Choose it again.');
  const file=path.join(target.directory,'servers.dat');let raw=null;
  try{const st=await fs.lstat(file);if(st.isSymbolicLink()||!st.isFile())fail('The server list is not a regular file. Your servers were not changed.');if(st.size>MAX_FILE)fail('This server list is too large to update safely.');raw=await fs.readFile(file);if(raw.length>MAX_FILE)fail('This server list is too large to update safely.');}catch(e){if(e.code!=='ENOENT')throw e;}
  let root,compressed=false;
  if(raw===null)root={type:'compound',name:'',value:{servers:{type:'list',value:{type:'compound',value:[]}}}};
  else{
   try{compressed=raw[0]===31&&raw[1]===139;const plain=compressed?await unzip(raw,{maxOutputLength:MAX_PLAIN}):raw;if(plain.length>MAX_PLAIN)throw Error();root=codec().parseUncompressed(plain,'big');if(!codec().writeUncompressed(root,'big').equals(plain))throw Error();}catch{fail('The server list could not be read safely. Your servers were not changed.');}
  }
  const list=root?.value?.servers;
  if(root.type!=='compound'||list?.type!=='list'||!Array.isArray(list.value?.value)||!(list.value.type==='compound'||(list.value.type==='end'&&list.value.value.length===0))||list.value.value.length>10000)fail('The server list format is not supported. Your servers were not changed.');
  return{file,raw,root,entries:list.value.value,compressed,revision:raw===null?'missing':digest(raw)};
 }
 function getTarget(id){const t=targets.get(id);if(!t)fail('Choose a Minecraft installation first.');return t;}
 function plan(data,record,wanted){
  const actions=[],used=new Set(data.entries.map(e=>e.name?.value));
  for(const r of wanted){
   const owned=record?.routes?.find(e=>e.route===r.route),pairs=Array.isArray(owned?.pairs)?owned.pairs:[];
   const found=data.entries.map((e,i)=>({e,i})).filter(({e})=>pairs.some(p=>same(p,identity(e))));
   if(found.length>1)fail('More than one matching Fury entry was found. Remove the duplicate in Minecraft, then try again.');
   const present=data.entries.findIndex(e=>endpoint(e.ip?.value)===endpoint(r.address));
   if(present>=0&&(!found.length||identity(found[0].e).address!==r.address)){
    const move=r.route==='direct'&&present>0;
    actions.push({route:r.route,next:identity(data.entries[present]),index:present,previous:pairs,external:true,move,changed:move});continue;
   }
   const ownName=found[0]?.e.name.value;let name=r.name;
   for(let n=2;used.has(name)&&name!==ownName;n++)name=`${r.name} (${n})`;used.add(name);
   const next={name,address:r.address};
   const index=found[0]?.i??-1,move=r.route==='direct'&&index>0;
   actions.push({route:r.route,next,index,previous:pairs,move,changed:move||!found.length||!same(next,identity(found[0].e))});
  }
  return actions;
 }
 async function inspect(id){
  const target=getTarget(id),data=await read(target),s=await state(),wanted=routes(),actions=plan(data,s.targets[id],wanted);
  return{...target,revision:data.revision,settingsKey:JSON.stringify(wanted),count:data.entries.length,ready:actions.every(a=>!a.changed),servers:actions.map(a=>({name:a.next.name,address:a.next.address,action:!a.changed?'ready':a.index<0?'add':a.move&&same(a.next,identity(data.entries[a.index]))?'move':'update'}))};
 }
 async function discover(){
  const s=await state();
  if(s.last&&s.targets[s.last]){const t=s.targets[s.last];try{await register(t.directory,t.label);}catch{}}
  const base=platform==='darwin'?path.join(home,'Library','Application Support','minecraft'):platform==='win32'?path.join(appData,'.minecraft'):path.join(home,'.minecraft');
  try{const t=await register(base,'Minecraft');if(s.targets[t.id]?.label)targets.set(t.id,{...t,label:s.targets[t.id].label});}catch{}
  const roots=[['Prism Launcher',path.join(appData,'PrismLauncher','instances')],['MultiMC',path.join(appData,'MultiMC','instances')]];
  for(const [client,root]of roots){
   let children;try{children=await fs.readdir(root,{withFileTypes:true});}catch{continue;}
   for(const child of children.filter(e=>e.isDirectory()).slice(0,64)){
    try{const instance=path.join(root,child.name),config=path.join(instance,'instance.cfg');let label=child.name;if((await fs.stat(config)).size<16384){const text=await fs.readFile(config,'utf8');label=/^name=(.*)$/m.exec(text)?.[1]?.trim()||label;}await register(path.join(instance,'.minecraft'),`${client} · ${label}`);}catch{}
   }
  }
  return{targets:[...targets.values()],selected:s.last&&targets.has(s.last)?s.last:null};
 }
 async function summary(){
  const s=await state(),last=s.last&&s.targets[s.last];if(!last)return{ready:false};
  try{const t=await register(last.directory,last.label),current=await inspect(t.id);return{ready:current.ready,label:t.label};}catch{return{ready:false};}
 }
 async function addNow({id,revision,settingsKey}={}){
  const target=getTarget(id),data=await read(target),wanted=routes();
  if(data.revision!==revision)fail('Minecraft changed the server list. Review it again before adding.');
  if(JSON.stringify(wanted)!==settingsKey)fail('Fury connection settings changed. Review the server addresses again.');
  const s=await state(),record=s.targets[id],actions=plan(data,record,wanted),changed=actions.filter(a=>a.changed);
  if(!changed.length){s.targets[id]=record||{directory:target.directory,label:target.label,routes:[]};s.targets[id].label=target.label;s.last=id;if(Object.keys(s.targets).length>32)fail('Too many saved installations.');await save(s);return{ok:true,changed:0,label:target.label,backup:null};}
  data.root.value.servers.value.type='compound';
  // Resolve original indices before moving anything. New alternate routes stay
  // at the end; the chosen direct entry is promoted intact after all updates.
  let primary=null;
  for(const a of actions){
   let entry=data.entries[a.index];
   if(a.changed&&!a.external){
    if(a.index<0){entry={name:{type:'string',value:a.next.name},ip:{type:'string',value:a.next.address}};data.entries.push(entry);}
    else if(!same(a.next,identity(entry))){entry.name={type:'string',value:a.next.name};entry.ip={type:'string',value:a.next.address};}
   }
   if(a.route==='direct')primary=entry;
  }
  if(primary&&data.entries[0]!==primary)data.entries.unshift(...data.entries.splice(data.entries.indexOf(primary),1));
  const plain=codec().writeUncompressed(data.root,'big'),bytes=data.compressed?await zip(plain):plain;
  if(bytes.length>MAX_FILE||plain.length>MAX_PLAIN)fail('The updated server list would be too large. Your servers were not changed.');
  let backup=null;
  if(data.raw){backup=path.join(directory,'minecraft-server-backups',id,`${data.revision}.dat`);await fs.mkdir(path.dirname(backup),{recursive:true});try{await fs.writeFile(backup,data.raw,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}if(!(await fs.readFile(backup)).equals(data.raw))fail('The backup could not be verified. Your servers were not changed.');}
  // Persist both previous and intended identities before replacement. A failed
  // write or crash can then be retried without adopting unrelated entries.
  const nextRoutes=actions.filter(a=>!a.external).map(a=>({route:a.route,pairs:[a.next,...a.previous.filter(p=>!same(p,a.next))].slice(0,8)}));
  for(const old of record?.routes||[])if(!nextRoutes.some(r=>r.route===old.route))nextRoutes.push(old);
  const nextRecord={directory:target.directory,label:target.label,routes:nextRoutes};
  s.targets[id]=nextRecord;s.last=id;if(Object.keys(s.targets).length>32)fail('Too many saved installations. Your servers were not changed.');
  await save(s);
  const temporary=path.join(target.directory,`.servers.dat.fury-${crypto.randomUUID()}.tmp`);
  try{
   await fs.writeFile(temporary,bytes,{flag:'wx'});await beforeCommit(target.directory);
   const latest=await read(target);if(latest.revision!==data.revision)fail('Minecraft changed the server list. Nothing was replaced; refresh setup and try again.');
   await fs.rename(temporary,data.file);
  }finally{await fs.unlink(temporary).catch(()=>{});}
  const written=await read(target);if(written.revision!==digest(bytes))fail('Minecraft changed the list after it was added. Refresh setup to check the entries.');
  return{ok:true,changed:changed.length,label:target.label,backup};
 }
 function add(request){const work=queue.catch(()=>{}).then(()=>addNow(request));queue=work;return work;}
 return{discover,register,inspect,summary,add};
}
module.exports={createMinecraftSetup};
