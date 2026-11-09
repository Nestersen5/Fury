'use strict';
const path=require('node:path');
const {createMinecraftSetup}=require('./minecraftSetup');
const {detectRunningClients}=require('./minecraftClientDetection');
function registerMinecraftSetup({handle,app,dialog,getWindow,authorize,getServerSettings,directory,detect=detectRunningClients}){
 const service=createMinecraftSetup({directory,home:app.getPath('home'),appData:app.getPath('appData'),getServerSettings,entryPrefix:app.getName()});
 const controller=new AbortController();let detecting=null;
 const register=(channel,handler)=>handle(`minecraft-setup:${channel}`,(event,...args)=>{
  if(!authorize(event)||controller.signal.aborted)throw new Error('Minecraft setup is not available in this window.');
  return handler(...args);
 });
 register('summary',()=>service.summary());
 register('list',()=>service.discover());
 register('choose',async()=>{
  const result=await dialog.showOpenDialog(getWindow(),{title:'Choose Minecraft game folder',properties:['openDirectory'],defaultPath:path.join(app.getPath('appData'),process.platform==='darwin'?'minecraft':'.minecraft')});
  if(result.canceled||!result.filePaths?.[0]||controller.signal.aborted)return null;
  return service.register(result.filePaths[0],'Minecraft');
 });
 register('detect',()=>{
  if(!detecting){detecting=(async()=>{const rows=await detect({signal:controller.signal}),found=[];for(const r of rows){if(controller.signal.aborted)break;try{const t=await service.register(r.directory,`${r.client}${r.version?' · '+r.version:''}`);if(!found.some(e=>e.id===t.id))found.push(t);}catch{}}return{targets:found};})();detecting.finally(()=>{detecting=null;}).catch(()=>{});}
  return detecting;
 });
 register('inspect',id=>service.inspect(typeof id==='string'?id:''));
 register('add',request=>{
  if(!request||typeof request.id!=='string'||typeof request.revision!=='string'||typeof request.settingsKey!=='string'||request.id.length!==64||request.revision.length>64||request.settingsKey.length>4096)throw new Error('Choose the installation again before adding servers.');
  return service.add({id:request.id,revision:request.revision,settingsKey:request.settingsKey});
 });
 return{dispose:()=>controller.abort()};
}
module.exports={registerMinecraftSetup};
