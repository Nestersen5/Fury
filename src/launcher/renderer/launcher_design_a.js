'use strict';

const {version}=require('../../../package.json');

// Presentation only. Existing production controls, data, IPC and save listeners
// retain ownership; the transferable patch contains this module and its CSS.
function mount({document,navigate,settingsPage,getState,showIngame,startProxy,stopProxy,checkDust,invoke,settingsIcon}) {
 const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
 const root=document.documentElement;
 if(!root.dataset.workspacePage)root.dataset.workspacePage=document.querySelector('.tab-page.active')?.dataset.page||'dashboard';
 const nativeControls=$$('input,select,textarea');
 const make=(tag,cls,text='')=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;};
 const append=(target,...nodes)=>nodes.filter(Boolean).forEach(n=>target.append(n));
 const column=(...nodes)=>{const e=make('div','ds-column');append(e,...nodes);return e;};
 const grid=(...nodes)=>{const e=make('div','ds-grid');append(e,...nodes);return e;};
 const section=(title,...nodes)=>{const e=make('section','ds-section');if(title)e.append(make('h3','ds-section-heading',title));append(e,...nodes);return e;};
 const page=key=>$(`[data-settings-subpage="${key}"]`);
 const moveAfterHeading=(target,...nodes)=>append(target,...nodes);
 const categories=[['launcher','Appearance'],['display','In-game appearance'],['scan','Scanning'],['gameplay','Automation'],['anticheat','AntiCheat','anticheat'],['denick','Nicknames'],['overlay','Chat'],['sessions','Sessions'],['reminders','Reminders','reminders'],['profiles','Profiles','profiles'],['api','API keys'],['network','Connection']];
 let lastMain='dashboard',lastCategory='launcher';
 const rail=$('.app-rail'),nav=$('.nav-tabs');
 const style=make('link','');style.rel='stylesheet';style.href='src/launcher/styles/launcher_design_a.css';document.head.append(style);
 root.classList.add('fury-design-a');

 // Rail: original brand, search, navigation, runtime actions and account menu.
 const brand=make('div','ds-brand');append(brand,$('.fury-mark'),$('.proxy-wordmark'));
 rail.prepend(brand);brand.after($('.global-search'));
 $('#global-search-input').placeholder='Search';
 const footer=make('div','ds-rail-footer');append(footer,$('.brand-runtime-controls'),$('.fury-account-trigger'));rail.append(footer);
 const runtimeStatus=$('#proxy-state');
 brand.append(runtimeStatus,make('span','ds-brand-version',`v.${version}`));
 brand.title=`Fury v.${version}`;
 const header=make('header','ds-header'),title=make('h1','ds-page-title','Dashboard');header.append(title);append(header,$('.fury-window-controls'));$('.workspace-shell').prepend(header);
 const back=make('button','ds-back');back.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m5 5-5-5 5-5"/></svg><span>Back to Fury</span>';back.type='button';back.addEventListener('click',()=>navigate(lastMain));
 const settingsNav=make('nav','ds-settings-nav');settingsNav.setAttribute('aria-label','Settings');
 const settingsItems=make('div','ds-settings-items');
 settingsNav.append(back,settingsItems);nav.after(settingsNav);
 // Use the approved outline icons on navigation only; feature artwork is unchanged.
 const categoryIcons={
  display:$('[data-page-tab="overlay"] >svg').innerHTML,
  scan:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12 18.4 5.6"/>',
  gameplay:'<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
  denick:$('[data-page-tab="denicks"] >svg').innerHTML,
  overlay:'<path d="M4 5h16v11H9l-5 4V5Z"/>',
  sessions:$('[data-page-tab="sessions"] >svg').innerHTML,
  api:'<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14.5 8.5l2 2"/>'
 };
 const navMap=new Map();
 for(const [key,label,nativePage]of categories){
  let button;
  if(nativePage)button=$(`[data-page-tab="${nativePage}"]`);
  else button=$(`[data-settings-subpage-button="${key}"]`);
  if(!button)throw Error(`Missing existing navigation: ${key}`);
  button.classList.add('ds-category');button.dataset.dsCategory=key;
  const labelNode=button.querySelector('strong,.fury-nav-label');if(labelNode)labelNode.textContent=label;
  const art=button.querySelector('svg');if(art&&categoryIcons[key]){art.setAttribute('viewBox','0 0 24 24');art.innerHTML=categoryIcons[key];}
  button.setAttribute('aria-label',label);button.title=label;
  // Native category buttons only switch the settings pane. Re-enter its page
  // first when leaving the separately owned AntiCheat/Reminders/Profiles pages.
  if(!nativePage)button.addEventListener('click',()=>{if(root.dataset.workspacePage!=='settings')navigate('settings');},{capture:true});
  settingsItems.append(button);navMap.set(key,button);
 }
 const reserved=make('div','ds-preserved-nav');append(reserved,$('[data-page-tab="nickroll"]'),$('[data-page-tab="console"]'));rail.append(reserved);
 const oldDirectory=$('.settings-directory');oldDirectory.classList.add('ds-retired-directory');
 $('[data-page-tab="settings"]').classList.add('ds-main-settings');
 // Preserve the native page owners for reminders/profiles/AntiCheat/reroller.
 function openCategory(key){
  const category=categories.find(c=>c[0]===key);if(!category)return;
  lastCategory=key;
  if(category[2])navigate(category[2]);else{navigate('settings');settingsPage(key,false);}
 }
 function nicknameTabs(host,selected){
  const tabs=make('nav','ds-local-tabs');tabs.setAttribute('aria-label','Nickname tools');
  for(const [key,label]of [['denick','Detection'],['nickroll','Nick Reroller']]){
   const b=make('button',key===selected?'active':'',label);b.type='button';b.setAttribute('aria-pressed',String(key===selected));b.addEventListener('click',()=>key==='nickroll'?navigate('nickroll'):openCategory('denick'));tabs.append(b);
  }
  host.prepend(tabs);
 }
 nicknameTabs(page('denick'),'denick');nicknameTabs($('[data-page="nickroll"]'),'nickroll');

 // Scan settings: source and thresholds left, outgoing party message right.
 const scan=page('scan'),scanFlow=$('.fury-scan-flow'),killSwitch=$('.kill-switch-card');
 const scanControls=section('Scan',$('.scan-mode-card'));
 const threshold=section('Threat limits',$('.share-threshold-panel'));
 const share=$('.share-settings-module');
 const scanGrid=grid(column(scanControls,threshold),column(section('Party chat',share)));
 scanFlow.replaceChildren(scanGrid);scanFlow.classList.add('ds-scan-workspace');
 const sharePrefs=$('.fury-share-preferences');sharePrefs.prepend($('.party-chat-preview'));
 $('.fury-share-body').classList.add('ds-share-body');
 append(page('api'),killSwitch);
 const method=$('#share-tags-team-summary').closest('label');method.classList.add('ds-method');
 method.querySelector('.fury-binary-off').textContent='Players';method.querySelector('.fury-binary-on').textContent='Teams';

 // Auto Dodge keeps both visibility gates and every existing number control.
 const body=$('.auto-dodge-body'),trigger=$('.fury-dodge-options'),thresholdRow=$('.fury-dodge-thresholds');
 const ruleFields=[...thresholdRow.children].filter(e=>e.matches('[data-stat-threat-threshold]')||e.querySelector('#auto-dodge-min-fkdr,#auto-dodge-min-stars'));
 const timingFields=[...thresholdRow.children].filter(e=>!ruleFields.includes(e));
 const ruleBlock=make('div','ds-dodge-limits');append(ruleBlock,...ruleFields);
 const dodgeGrid=grid(column(section('Players',trigger,ruleBlock)),column(section('Timing',...timingFields)));
 body.replaceChildren(dodgeGrid);
 const gameplay=page('gameplay'),extra=['quick-maths-enabled','party-split-warnings-enabled'].map(id=>{const input=document.getElementById(id);return input.closest('.fc-module')||input.closest('.feature-card');});
 const tools=grid(...extra);append(gameplay,tools);
 for(const n of extra)n.classList.add('ds-tool-card');

 // Session defaults/card fields and post-game chat are separate working areas.
 const sessionFlow=$('.fury-session-settings-flow'),tracking=$('.session-settings-module'),recap=$('.session-recap-designer'),card=$('.fury-session-appearance'),replay=$('#replay-details-module');
 sessionFlow.replaceChildren(grid(column(section('Saved sessions',tracking,card,replay)),column(section('Minecraft chat',recap))));

 // Detection methods versus use of their results, without changing shared flags.
 const nick=$('.fury-nickname-settings'),nickSections=[...nick.querySelectorAll(':scope > .fury-nickname-section')];
 nick.replaceChildren(grid(column(...nickSections.slice(0,2)),column(...nickSections.slice(2))));
 const chat=$('.fury-overlay-settings'),chatSections=[...chat.children];
 chat.replaceChildren(grid(column(chatSections[0]),column(...chatSections.slice(1))));

 // In-game output: the production live previews and editors switch sides.
 const tabDesigner=$('.tablist-designer');tabDesigner.classList.add('ds-tab-workspace');
 const preview=$('#tablist-preview-shell'),editor=$('.tablist-editor-controls');
 if(preview&&editor){const parent=preview.parentElement;parent.classList.add('ds-tab-layout');parent.prepend(preview);editor.classList.add('ds-tab-controls');}
 const nameDesigner=$('.world-label-designer');if(nameDesigner){nameDesigner.classList.add('ds-name-workspace');nameDesigner.prepend($('#nametag-preview-stage'));}
 const score=page('display').querySelector('[data-ingame="scoreboard"]');if(score)score.classList.add('ds-score-workspace');
 const identityPane=page('display').querySelector('[data-ingame="colors"]');
 if(identityPane){const identity=$('.ia-identity');if(identity)page('denick').append(section('In-game identity',identity));$('.fury-ingame-tabs button[data-ingame="colors"]').textContent='Chat colors';}

 // Appearance keeps the real theme/accent selectors and sidebar preference.
 $('.appearance-studio-controls')?.classList.add('ds-appearance-workspace');
 // Real API-provider cards keep their inputs and validation; no mock statuses.
 $('.fury-api-list')?.classList.add('ds-api-workspace');
 $('.fury-reminder-layout')?.parentElement.classList.add('ds-reminder-workspace');
 $('[data-page="profiles"]')?.classList.add('ds-profiles-page');
 $('[data-page="anticheat"]')?.classList.add('ds-anticheat-page');
 $('#nickroll-controls')?.classList.add('ds-reroller-workspace');
 // Console remains a real page, opened from the connection actions.
 const logButton=make('button','ds-open-logs','Open logs');logButton.type='button';logButton.addEventListener('click',()=>navigate('console'));$('.fury-connection-actions').prepend(logButton);
 // Remove repeated category headers only; status, errors and validation remain.
 const labels={scan:'Scanning',sessions:'Sessions',overlay:'Chat',network:'Connection'};
 for(const [key,label]of Object.entries(labels)){const heading=page(key).querySelector('.fury-category-heading h2');if(heading)heading.textContent=label;}
 const pages=require('./launcher_design_a_pages').mount({document,navigate,getState,startProxy,stopProxy,checkDust,invoke,settingsIcon});
 const categoryFromPage={anticheat:'anticheat',reminders:'reminders',profiles:'profiles',nickroll:'denick',console:'network'};
 function selectCategory(key){
  lastCategory=key;
  for(const [k,b]of navMap){const selected=k===key;b.classList.toggle('active',selected);b.classList.toggle('ds-selected',selected);if(selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
  navMap.get(key)?.scrollIntoView({block:'nearest'});
  title.textContent=categories.find(c=>c[0]===key)?.[1]||'Settings';
 }
 function onNavigate(name){
  const inSettings=name==='settings'||Boolean(categoryFromPage[name]);
  root.dataset.dsSettings=String(inSettings);
  pages.onNavigate(name);
  if(inSettings){const key=name==='settings'?($('[data-settings-subpage].active')?.dataset.settingsSubpage||lastCategory):categoryFromPage[name];selectCategory(key);}
  else{lastMain=name;title.textContent=$(`[data-page-tab="${name}"]`)?.dataset.pageLabel||name;if(name==='dashboard')update(getState());}
  $('[data-page-tab="settings"]').classList.toggle('ds-selected',inSettings);
  document.dispatchEvent(new document.defaultView.CustomEvent('fury-settings-view-changed'));
 }
 function onSettings(name){if(root.dataset.workspacePage==='settings')selectCategory(name);document.dispatchEvent(new document.defaultView.CustomEvent('fury-settings-view-changed'));}
 onNavigate(root.dataset.workspacePage||'dashboard');
 const missingControls=nativeControls.filter(e=>!e.isConnected).map(e=>e.id);
 if(missingControls.length)throw Error('Design A detached existing controls: '+missingControls.join(', '));
 function update(next){
  if(next){const running=Boolean(next.services?.proxy?.running),status=running?'Running':'Stopped';if(runtimeStatus.textContent!==status)runtimeStatus.textContent=status;if(runtimeStatus.dataset.running!==String(running)){runtimeStatus.dataset.running=String(running);runtimeStatus.title=`Proxy ${status.toLowerCase()}`;}}
  pages.update(next||{});

 }
 // Updates mounts after DOMContentLoaded. Move its existing button once, keeping
 // its own updater eligibility, menu positioning and keyboard handlers intact.
 function mountRailActions(){const updates=$('.fury-release-reopen');if(updates)footer.prepend(updates);}
 return {onNavigate,onSettings,mountRailActions,nativeControlCount:nativeControls.length,update,dispose:pages.dispose};
}
module.exports={mount};
