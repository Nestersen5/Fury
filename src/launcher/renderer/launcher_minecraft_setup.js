'use strict';

function mount({document,invoke}){
 const win=document.defaultView,canDetect=process.platform==='win32';
 const $=s=>document.querySelector(s),node=(tag,cls,text='')=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;};
 const icon=path=>{const s=node('span','');s.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;return s.firstChild;};
 const monitor='<rect x="3" y="3" width="18" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>',check='<path d="m5 12 4 4L19 6"/>',cross='<path d="m6 6 12 12M6 18 18 6"/>',refresh='<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>';
 const button=(text,action,cls='da-setup-secondary')=>{const b=node('button',cls,text);b.type='button';b.addEventListener('click',action);return b;};
 const guide=$('.da-server-strip'),header=node('div','da-server-content');header.append(...guide.childNodes);guide.append(header);guide.classList.add('da-server-has-setup');
 const row=node('div','da-minecraft-setup'),mark=node('span','da-minecraft-mark'),copy=node('div','da-minecraft-copy'),title=node('strong','','Minecraft'),note=node('p','');mark.append(icon(monitor));note.hidden=true;copy.append(title,note);
 const setup=button('Add Fury servers',()=>completed?dismiss():open(),'da-setup-secondary');setup.id='minecraft-setup-open';row.append(mark,copy,setup);guide.append(row);note.setAttribute('role','status');
 const settings=node('section','da-card da-minecraft-settings'),settingsTitle=node('h3','da-section-title','Minecraft'),settingsRow=node('div','da-minecraft-settings-row'),settingsNote=node('p','da-minecraft-settings-status');
 const manage=button('Manage servers',()=>open());manage.id='minecraft-setup-manage';settingsRow.append(node('span','','Server list'),manage);settings.append(settingsTitle,settingsRow,settingsNote);settingsNote.hidden=true;settingsNote.setAttribute('role','status');$('[data-settings-subpage="network"]').append(settings);
 const dialog=node('dialog','fury-dialog da-minecraft-dialog');dialog.id='minecraft-setup-dialog';dialog.setAttribute('aria-labelledby','minecraft-setup-title');
 const head=node('header',''),heading=node('h2','','Add Fury servers');heading.id='minecraft-setup-title';const close=button('×',()=>dialog.close(),'da-setup-close');close.setAttribute('aria-label','Close Minecraft setup');head.append(heading,close);
 const body=node('div','da-minecraft-dialog-body'),label=node('label','da-minecraft-installation-label','Installation'),select=node('select','');select.id='minecraft-setup-installation';label.htmlFor=select.id;select.setAttribute('aria-describedby','minecraft-setup-directory');
 const directory=node('p','da-minecraft-directory');directory.id='minecraft-setup-directory';directory.hidden=true;
 const tools=node('div','da-minecraft-tools'),detect=button('Check again',()=>detectClient(),'da-setup-secondary da-minecraft-detect');detect.prepend(icon(refresh));detect.id='minecraft-setup-detect';detect.hidden=!canDetect;tools.append(detect);
 const preview=node('details','da-minecraft-server-preview'),previewTitle=node('summary',''),previewList=node('div','da-minecraft-preview-list');preview.append(previewTitle,previewList);preview.hidden=true;
 const status=node('p','da-minecraft-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.hidden=true;
 const retry=button('Refresh list',()=>selected(select.value));retry.hidden=true;
 const footer=node('footer',''),cancel=button('Cancel',()=>dialog.close()),add=button('Add servers',()=>addServers(),'da-setup-primary');add.id='minecraft-setup-add';add.disabled=true;footer.append(cancel,add);body.append(status,label,select,directory,tools,preview,retry);dialog.append(head,body,footer);document.body.append(dialog);
 let targets=new Map(),current=null,busy='',generation=0,summaryGeneration=0,completed=false,disposed=false,returnFocus=null,serverKey='',waitingForClient=false;
 const message=(text,state='')=>{status.replaceChildren();if(text){if(state)status.append(icon(state==='success'?check:cross));status.append(node('span','',text));}status.hidden=!text;status.dataset.state=state;retry.hidden=!(state==='error'&&select.value);};
 function controls(){label.hidden=select.hidden=targets.size===0;select.disabled=Boolean(busy)||targets.size===0;detect.disabled=Boolean(busy);detect.setAttribute('aria-busy',String(busy==='detect'));add.disabled=Boolean(busy)||!current;add.textContent=busy==='add'?'Adding…':current?.ready?'Use this installation':'Add servers';close.disabled=busy==='add';cancel.disabled=busy==='add';}
 function options(selected=''){
  select.replaceChildren();const empty=node('option','','Choose Minecraft installation');empty.value='';select.append(empty);
  for(const t of targets.values()){const option=node('option','',t.label);option.value=t.id;select.append(option);}select.value=targets.has(selected)?selected:'';controls();
 }
 function merge(rows){for(const t of rows||[])targets.set(t.id,t);}
 async function selected(id){
  const request=++generation;waitingForClient=false;current=null;preview.hidden=true;directory.hidden=!id;directory.textContent=targets.get(id)?.directory||'';message(id?'Checking Minecraft server list…':'');busy=id?'read':'';controls();
  if(!id){if(targets.size)message(canDetect?'Minecraft is running. Choose the client you want to set up.':'Choose a detected Minecraft installation.',canDetect?'success':'');return;}
  try{const value=await invoke('minecraft-setup:inspect',id);if(disposed||request!==generation||!dialog.open)return;current=value;previewTitle.textContent=`${value.servers.length} servers${value.ready?' · Already added':''}`;previewList.replaceChildren(...value.servers.map(s=>{const r=node('div','da-minecraft-preview-row');r.append(node('strong','',s.name),node('code','',s.address));return r;}));preview.hidden=false;message(value.ready?'Fury servers are already up to date.':canDetect?'Minecraft is running. Ready to add Fury servers.':'Minecraft found. Ready to add Fury servers.','success');}
  catch(e){if(request===generation&&dialog.open)message(errorText(e),'error');}
  finally{if(request===generation){busy='';controls();}}
 }
 function errorText(e){const text=String(e?.message||e||'Could not update Minecraft. Try again.');if(/EACCES|EPERM|permission denied/i.test(text))return 'Fury could not access Minecraft’s game folder. Check its permissions, then try again.';return text.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'').slice(0,400);}
 async function open(){
  if(disposed||dialog.open)return;returnFocus=document.activeElement;dialog.showModal();generation++;current=null;targets=new Map();directory.hidden=true;preview.hidden=true;preview.open=false;busy='list';options();message('Loading installations…');controls();const request=generation;
  if(canDetect){win.addEventListener('focus',checkWhenReturning);await detectClient();return;}
  try{const result=await invoke('minecraft-setup:list');if(disposed||request!==generation||!dialog.open)return;merge(result.targets);busy='';options(result.selected);message(targets.size?'Choose a detected Minecraft installation.':'No Minecraft installation found. Launch Minecraft, then reopen this window.',targets.size?'':'missing');if(result.selected)await selected(result.selected);else if(targets.size)select.focus();}
  catch(e){if(request===generation&&dialog.open){busy='';message(errorText(e),'error');controls();}}
 }
 async function detectClient(){
  if(!canDetect||disposed||!dialog.open||busy==='add')return;
  const request=++generation;waitingForClient=false;busy='detect';current=null;targets=new Map();options();directory.hidden=true;preview.hidden=true;controls();message('Looking for Minecraft…');
  try{const result=await invoke('minecraft-setup:detect');if(disposed||request!==generation||!dialog.open)return;merge(result.targets);busy='';options(result.targets.length===1?result.targets[0].id:'');if(result.targets.length===1)await selected(result.targets[0].id);else{waitingForClient=result.targets.length===0;message(waitingForClient?'Minecraft is not running. Launch it in your client, then return here.':'Minecraft is running. Choose the client you want to set up.',waitingForClient?'missing':'success');}}
  catch(e){if(request===generation&&dialog.open){busy='';message(errorText(e),'error');controls();}}
 }
 function checkWhenReturning(){if(waitingForClient&&dialog.open&&!busy&&!disposed)void detectClient();}
 async function addServers(){
  if(busy||!current)return;busy='add';controls();message('');const request=++generation;
  try{
   const result=await invoke('minecraft-setup:add',{id:current.id,revision:current.revision,settingsKey:current.settingsKey});if(disposed||request!==generation)return;
   completed=true;summaryGeneration++;busy='';controls();dialog.close();title.textContent=`${result.changed?'Added to':'Ready in'} ${result.label}`;note.textContent=result.changed?'Refresh Multiplayer to see your servers.':'Fury servers are already in your Multiplayer list.';note.hidden=false;mark.replaceChildren(icon(check));row.classList.add('da-minecraft-added');row.hidden=false;setup.textContent='Done';settingsNote.textContent=note.textContent;settingsNote.hidden=false;setup.focus();
  }catch(e){if(request===generation&&!disposed){busy='';message(errorText(e),'error');current=null;controls();}}
 }
 function dismiss(){row.hidden=true;}
 async function summary(){const request=++summaryGeneration;try{const result=await invoke('minecraft-setup:summary');if(disposed||request!==summaryGeneration||completed)return;row.hidden=result.ready;}catch{/* Setup remains available; no background retry. */}}
 function update(next){if(disposed)return;const s=next?.settings?.server;if(!s)return;const key=JSON.stringify([s.proxyDirectPort,s.proxyDirectHost,s.proxyFailoverPort,s.proxyFailoverHost,s.proxyCustomPort,s.proxyCustomHost]);if(key===serverKey)return;serverKey=key;completed=false;row.classList.remove('da-minecraft-added');mark.replaceChildren(icon(monitor));title.textContent='Minecraft';note.hidden=true;setup.textContent='Add Fury servers';void summary();}
 select.addEventListener('change',()=>selected(select.value));dialog.addEventListener('cancel',event=>{if(busy==='add')event.preventDefault();});dialog.addEventListener('close',()=>{generation++;waitingForClient=false;win.removeEventListener('focus',checkWhenReturning);busy='';if(returnFocus?.getClientRects().length)returnFocus.focus();});
 dialog.addEventListener('click',event=>{if(event.target!==dialog||busy==='add')return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
 for(const b of [setup,manage]){b.setAttribute('aria-haspopup','dialog');b.setAttribute('aria-controls',dialog.id);}
 function dispose(){disposed=true;generation++;summaryGeneration++;waitingForClient=false;win.removeEventListener('focus',checkWhenReturning);if(dialog.open)dialog.close();}
 return{update,dispose};
}
module.exports={mount};
