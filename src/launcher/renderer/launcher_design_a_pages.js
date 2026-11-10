'use strict';

const minecraftChat=require('../../../features/minecraft_chat');
const {enderDustReminderMessage,DEFAULT_ENDER_DUST_THRESHOLD,MINION_ENDER_DUST_CAPACITY}=require('../../../features/ender_dust_reminder');
const {GAMBLER_GEORGE_REMINDER_MESSAGE}=require('../../../features/gambler_george_reminder');
const {segmentsHtml}=require('./launcher_denick_format');

// Design A owns composition. The existing controls retain validation, saving,
// account ownership and game previews. No fixture data enters this renderer.
function mount({document,navigate,getState,startProxy,stopProxy,checkDust,invoke,settingsIcon}) {
 const $=(s,host=document)=>host.querySelector(s),$$=(s,host=document)=>[...host.querySelectorAll(s)];
 const make=(tag,cls,text='')=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;};
 const put=(host,...nodes)=>{nodes.filter(Boolean).forEach(n=>host.append(n));return host;};
 const stack=(...nodes)=>put(make('div','da-stack'),...nodes);
 const grid=(...nodes)=>put(make('div','da-columns'),...nodes);
 const heading=text=>make('h3','da-section-title',text);
 const card=(title,...nodes)=>put(make('section','da-card'),title?heading(title):null,...nodes);
 const page=key=>$(`[data-settings-subpage="${key}"]`);
 const quiet=node=>{if(node){node.classList.add('da-legacy');node.setAttribute('data-design-hidden','');}return node;};
 const rowFor=id=>document.getElementById(id)?.closest('.feature-card,.share-option-row,.fury-nickname-row,.fury-overlay-row,.ia-setting-row');
 document.documentElement.id='fury-design-a';
 const style=make('link','');style.rel='stylesheet';style.href='src/launcher/styles/launcher_design_a_pages.css';document.head.append(style);
 // Feedback gets its own workspace row instead of covering the form being edited.
 $('.workspace-shell').append($('#notification-stack'));
 const ranges=[];
 function range(id,title,ceiling){
  const input=document.getElementById(id);if(!input)return;
  const label=input.closest('label');label.classList.add('da-limit');label.htmlFor=id;
  const caption=$(':scope >span',label);if(caption)caption.textContent=title;
  $$(':scope >small',label).forEach(quiet);
  const slider=require('./launcher_range_slider').create({document,input,ceiling,title,id:`design-a-${id}-range`,host:label});
  label.append(slider.element);ranges.push(slider.sync);
 }
 function tabs(labels,panels,host){
  const nav=make('nav','da-segments');nav.setAttribute('aria-label','Threat limits game');
  labels.forEach((label,i)=>{const b=make('button',i===0?'active':'',label);b.type='button';b.setAttribute('aria-pressed',String(i===0));b.addEventListener('click',()=>{panels.forEach((p,j)=>p.hidden=i!==j);[...nav.children].forEach((n,j)=>{n.classList.toggle('active',i===j);n.setAttribute('aria-pressed',String(i===j));});});nav.append(b);panels[i].hidden=i!==0;});host.prepend(nav);
 }

 // Scan mode is a vertical choice, followed by one game's numeric limits.
 const scan=$('.scan-mode-card');scan.classList.add('da-scan-picker');
 const modeNames=['All players','Threats only','Off'];
 const modeIcons=['<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/>','<path d="m12 2 9 4v6c0 5-3 8-9 11-6-3-9-6-9-11V6zM8 12l3 3 5-6"/>','<path d="m3 3 18 18M10 5c5-1 9 3 12 7-1 2-2 3-4 5M6 6C4 7 2 9 1 12c3 5 7 8 12 7"/>'];
 $$('.scan-mode-buttons >button').forEach((b,i)=>{b.querySelector('strong').textContent=modeNames[i];b.setAttribute('aria-label',modeNames[i]);b.querySelector('span').innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${modeIcons[i]}</svg>`;});
 const limits=$('.share-threshold-panel'),games=$$('.share-threshold-card',limits);
 tabs(['BedWars','SkyWars'],games,limits);
 [['min-fkdr','FKDR',100],['min-stars','Stars',5000],['min-sw-kdr','KDR',100],['min-sw-wlr','WLR',20],['min-sw-level','Level',200]].forEach(args=>range(...args));
 const share=$('.share-settings-module'),include=$('.share-include-panel'),method=$('.fury-share-method-selector'),common=$('.fury-share-common'),individual=$('#share-individual-options');
 $('#share-settings-title').textContent='Share to party chat';$('#share-team-summary-title').textContent='Share as';
 rowFor('share-tags-color-local').querySelector('h3').textContent='Recolor my lines';
 const shareBody=$('.fury-share-body');shareBody.replaceChildren($('.party-chat-preview'),method,include,individual,common);
 share.classList.add('da-sharing');include.classList.add('da-include-row');

 // The real Auto Dodge controls sit in a single card, with two clear work areas.
 $('.auto-dodge-module').classList.add('da-card','da-dodge');
 [['auto-dodge-min-fkdr','FKDR',100],['auto-dodge-min-stars','Stars',5000]].forEach(args=>range(...args));
 $$('.ds-tool-card').forEach(c=>c.classList.add('da-card'));

 // Tab list: every setup control belongs in the top toolbar.
 const tab=$('.tablist-designer'),toolbar=make('div','da-toolbar da-tab-toolbar');
 put(toolbar,$('.tablist-master'),$('.tablist-mode-switch'),$('.tablist-control-row'));
 tab.prepend(toolbar);
 for(const option of $$('#tab-stats-label-style option'))option.textContent={compact:'Compact',full:'Full',value:'Values'}[option.value]||option.textContent;
 const labelStyle=$('#tab-stats-label-style').closest('label');for(const text of labelStyle.childNodes)if(text.nodeType===3&&text.textContent.trim())text.textContent='Labels';
 const preview=$('#tablist-preview-shell'),editor=$('.tablist-editor-controls'),left=stack(preview),right=stack();
 const order=$('#tablist-order-list').closest('.tablist-field-section');order.classList.add('da-card');
 const available=card('Available fields',$('#tablist-field-palette'));put(right,order,available);
 quiet($('.ia-add-fields'));quiet($('.ia-tab-footer-open'));
 const footer=card('BedWars footer',...$$('#tab-footer-dialog .ia-tab-footer-settings'));footer.classList.add('da-tab-footer');left.append(footer);
 const workspace=$('.tablist-editor-layout');workspace.replaceChildren(left,right);workspace.classList.add('da-columns','da-tab-columns');
 // Keep hidden compatibility nodes connected for the existing form collector.
 tab.append(editor);editor.classList.add('da-legacy');
 preview.querySelector('.ia-section-title').textContent='Tab list';

 // Nametags: the preview and group selector sit beside the actual field editors.
 const world=$('.world-label-designer'),worldToolbar=make('div','da-toolbar da-name-toolbar');
 put(worldToolbar,$('.world-label-master'),$('.ia-audience-tabs'));world.before(worldToolbar);
 const nameControls=$('.fury-nametag-controls'),groups=$('.ia-player-groups');
 const formatting=card('Formatting',...$$(':scope >.feature-card',nameControls));
 formatting.classList.add('da-name-formatting');
 // Each setting has one row owner, including the native star-brackets switch.
 $$(':scope >.feature-card',formatting).forEach(c=>{const row=$(':scope >.ia-setting-row',c);if(row){c.replaceChildren(...row.childNodes);c.classList.add('ia-setting-row');}});
 groups.classList.add('da-card');groups.querySelector('.ia-section-title').textContent='Name layout';
 world.replaceChildren(stack($('#nametag-preview-stage')),stack(groups,formatting));world.classList.add('da-columns');
 const previewModes=$('.nametag-preview-mode');previewModes.classList.add('da-segments','da-name-preview-mode');world.firstElementChild.append(previewModes);
 $('.overlay-view-toggle').classList.add('da-segments');
 const score=page('display').querySelector('.fury-ingame-pane[data-ingame="scoreboard"]');score.classList.add('da-score-columns');
 $$(':scope >.ia-preview-setting',score).forEach(c=>c.prepend($('.ia-live-panel',c)));

 // Appearance uses a theme row and a separate accent/animation/sidebar area.
 const appearance=$('.appearance-studio-controls'),theme=$('.appearance-theme-card'),accent=$('.appearance-accent-inline');
 const themeHeading=theme.querySelector('.appearance-control-heading h3');themeHeading.textContent='Theme';
 theme.after(grid(card('Accent',accent),stack($('.appearance-motion-card'),$('.fury-sidebar-options'))));
 appearance.classList.add('da-appearance');

 // Native rows use the same concise, divided card treatment throughout settings.
 for(const selector of ['.fury-nickname-section','.fury-overlay-panel','.fury-session-appearance','.session-settings-module','.session-recap-designer','.ia-identity','.ia-preview-setting'])$$(selector).forEach(n=>n.classList.add('da-card'));
 $$('.fury-nickname-section,.fury-overlay-panel,.session-settings-module,.ds-tool-card,.auto-dodge-hero,.fury-session-appearance,.ia-identity,.ia-preview-setting').forEach(host=>{
  $$('small:not([id]),.note:not([id]),p:not([id])',host).filter(n=>!n.closest('.ia-live-panel,.session-recap-preview-shell')&&!n.querySelector('input,button,select')).forEach(quiet);
 });
 // Put the existing phrase editor directly on its settings page.
 const phrases=card('Chat triggers',$('#chat-trigger-input').closest('.feature-trigger-input'),$('#chat-trigger-list'),$('#chat-trigger-status'));
 page('overlay').querySelector('.ds-grid >.ds-column:first-child').append(phrases);quiet($('#chat-trigger-manage'));
 quiet($('.fury-message-types-title'));quiet($('.session-recap-preview-shell >.fury-session-preview-label'));
 const anti=$('[data-page="anticheat"]'),antiCards=$$('.anticheat-panel',anti);antiCards.forEach(c=>c.classList.add('da-card'));
 const antiGrid=grid(...antiCards.slice(1));anti.append(antiGrid);antiCards[0].classList.add('da-anticheat-master');
 $$('.anticheat-section-heading p,.anticheat-save-note,.anticheat-panel .feature-card small').forEach(quiet);

 // Show the actual notification text; progress and availability stay in the
 // native status rows below, including when a reminder is not ready to send.
 const reminderPage=$('[data-page="reminders"]'),reminderGrid=$('.reminder-stack');reminderGrid.classList.add('da-columns');
 const dustPreview=make('div','da-chat-preview da-dust-preview'),georgePreview=make('div','da-chat-preview da-george-preview');
 dustPreview.setAttribute('aria-label','Ender Dust reminder preview');georgePreview.setAttribute('aria-label','Gambler George reminder preview');
 for(const [selector,previewNode]of [['.reminder-dust-card',dustPreview],['.reminder-george-card',georgePreview]]){
  const previewFrame=put(make('div','da-reminder-preview'),make('div','da-reminder-preview-label','Chat preview'),previewNode);
  const c=$(selector),head=$('.reminder-card-head',c),body=$('.reminder-card-body',c);c.classList.add('da-card');
  put(head,$('.fury-reminder-options .feature-toggle',c));
  $$('header p,header .eyebrow,.reminder-repeat-limit,.fury-reminder-options',c).forEach(quiet);
  if(selector.includes('dust')){
   body.prepend($('.reminder-target-control'));quiet($('.reminder-reading',c));quiet($('.fury-dust-grid',c));
   quiet($('#ender-dust-reminder-threshold-slider').closest('.fc-slider-control'));quiet($('.reminder-target-control small'));quiet($('.reminder-target-control b'));body.insertBefore(previewFrame,$('.reminder-actions',c));
  }else{quiet($('.fury-george-progress',c));body.prepend(previewFrame);}
 }
 quiet($('#reminder-account-copy'));reminderPage.classList.add('da-reminders');

 // Recompose real connection rows and provider forms, keeping validation visible.
 $('.fury-connection-list').classList.add('da-card');
 const api=page('api'),apiList=$('.fury-api-list');api.classList.add('da-api-page');
 apiList.before(make('p','da-api-intro','Add keys for the features you use.'));
 // Hypixel is the always-visible form; the optional services keep native disclosures.
 const oldHypixel=$('[data-api-card="hypixel"]'),hypixel=make('section',oldHypixel.className);
 hypixel.dataset.apiCard='hypixel';oldHypixel.replaceWith(hypixel);hypixel.append(...oldHypixel.childNodes);
 const oldHead=$('.api-key-card-head',hypixel),head=make('div',oldHead.className);head.append(...oldHead.childNodes);oldHead.replaceWith(head);
 $('.api-key-card-copy strong',head).id='api-hypixel-title';hypixel.setAttribute('aria-labelledby','api-hypixel-title');
 $('.api-key-chevron',head).remove();
 const optional=put(make('section','da-api-optional'),heading('Optional services'));
 optional.append($('[data-api-card="urchin"]'),$('[data-api-card="aurora"]'));apiList.append(optional);
 const advanced=make('details','da-api-advanced');advanced.append(make('summary','','Advanced settings'));
 advanced.firstElementChild.append(make('span','da-api-paused','API requests paused'));
 const admin=$('[data-api-card="urchinadmin"]');$('.api-key-card-copy strong',admin).textContent='Urchin admin key';
 advanced.append(admin,$('.kill-switch-card'));apiList.after(advanced,make('p','da-api-save-note','Keys save automatically on this computer.'));
 for(const provider of $$('[data-api-card]',api)){
  provider.classList.add('da-card');if(provider.matches('details'))provider.open=false;
  const name=provider.dataset.apiCard,body=$('.api-key-card-body',provider),input=$('.api-key-input input',provider);
  const label={hypixel:'Hypixel',urchin:'Urchin',aurora:'Aurora',urchinadmin:'Urchin admin'}[name];
  input.placeholder=`Paste your ${label} API key`;input.setAttribute('aria-label',`${label} API key`);input.autocomplete='off';input.spellcheck=false;
  if(name!=='hypixel')$('.api-key-card-copy small',provider).textContent={urchin:'Player tags',aurora:'Help identify nicked players',urchinadmin:'Add or remove player tags'}[name];
  const field=make('div','da-key-field');input.before(field);field.append(input,$('[data-key-toggle]',provider));
  const toggle=$('[data-key-toggle]',provider);toggle.setAttribute('aria-label',`Show ${label} API key`);toggle.setAttribute('aria-pressed','false');
  toggle.innerHTML=settingsIcon('eye','settings-button-art');
  $('[data-api-test]',provider).textContent='Test key';
  const extra=make('details','da-key-details');extra.append(make('summary','','Key details'));
  const copy=$('[data-key-copy]',provider);copy.setAttribute('aria-label',`Copy ${label} API key`);extra.append(copy);
  const last=$('[data-api-last]',provider);extra.append(last);
  const result=$('.api-key-result',body);result.hidden=true;result.setAttribute('role','status');
  for(const row of [...body.children].filter(n=>n.matches('.note,#hypixel-key-reminder')))extra.append(row);
  if(name==='hypixel')extra.append($('#hypixel-key-snooze'));
  const tools=make('div','da-key-tools');if(name==='hypixel'){
   const dashboard=$('#hypixel-key-dashboard');dashboard.textContent='Get a Hypixel key ↗';tools.append(dashboard);
  }
  tools.append(extra);body.append(tools);
  $$('.api-key-actions',body).filter(row=>!row.children.length).forEach(row=>row.remove());
  if(provider.matches('details')){
   $('.api-key-chevron',provider).remove();
   const action=make('span','da-key-action');put(action,make('span','da-key-action-closed','Add key'),make('span','da-key-action-open','Close'));
   $('.api-key-card-head',provider).append(action);
  }
 }
 const reroll=$('#nickroll-controls');reroll.classList.add('da-columns');$$(':scope >.panel',reroll).forEach(c=>c.classList.add('da-card'));
 $$(':scope >.panel >p.note',reroll).forEach(quiet);

 const dashboard=require('./launcher_design_a_dashboard').mount({document,navigate,getState,startProxy,stopProxy,checkDust,invoke});
 // Sessions use the approved list/detail arrangement. Keeping the existing
 // details/content subtree preserves lazy card rendering and history ownership.
 const history=$('#session-history-list'),historyWorkspace=make('div','da-history-workspace');history.before(historyWorkspace);historyWorkspace.append(history,make('aside','da-session-placeholder','Select a session'));
 history.addEventListener('toggle',event=>{const opened=event.target;if(!opened.matches('.fury-session-row')||!opened.open)return;$$('.fury-session-row[open]',history).filter(row=>row!==opened).forEach(row=>row.open=false);},true);
 // Daily, weekly and monthly cards use the same list/detail arrangement.
 const calendarPanel=$('#fury-calendar-panel');calendarPanel?.addEventListener('toggle',event=>{const opened=event.target;if(!opened.matches('.fury-period-row')||!opened.open)return;$$('.fury-period-row[open]',calendarPanel).filter(row=>row!==opened).forEach(row=>row.open=false);},true);
 const historyTools=make('div','da-history-tools');$('.fury-history-modes').before(historyTools);put(historyTools,$('.fury-history-modes'),$('.fury-period-tabs'),$('.fury-session-toolbar'));
 // Saved nickname matches use the compact table's existing bounded renderer;
 // the controls keep their original search/filter owners.
 const nickTools=$('.denick-history-tools'),nickGrid=$('.denick-filter-grid'),nickFilters=make('details','da-nick-filters');
 nickFilters.append(make('summary','','Filters'));const filterBody=make('div','da-nick-filter-body');put(filterBody,...$$(':scope >label:not(.denick-filter-search)',nickGrid));nickFilters.append(filterBody);nickGrid.append(nickFilters);
 nickFilters.addEventListener('keydown',event=>{if(event.key==='Escape'&&nickFilters.open){event.preventDefault();event.stopPropagation();nickFilters.open=false;nickFilters.querySelector('summary').focus();}});
 document.addEventListener('click',event=>{if(nickFilters.open&&!nickFilters.contains(event.target))nickFilters.open=false;});
 nickTools.classList.add('da-nick-tools');
 $('.denick-advanced-switch')?.classList.add('da-segments');
 let reminderKey='';
 const view=document.defaultView;
 function updateApiAccent(color){
  const channels=String(color).trim().replace('#','').match(/.{2}/g);
  if(channels?.length!==3)return;
  const [r,g,b]=channels.map(channel=>{const value=parseInt(channel,16)/255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;});
  api.style.setProperty('--da-key-ink',.2126*r+.7152*g+.0722*b>.179?'#000000':'#ffffff');
 }
 updateApiAccent(view.getComputedStyle(document.documentElement).getPropertyValue('--accent'));
 let reminderAccent=minecraftChat.setChatPrefixAccent(view.getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
 const chatHtml=message=>segmentsHtml(minecraftChat.applyChatPrefixAccent(minecraftChat.normalizeLegacyJsonComponent(message)).extra);
 function updateReminderPreviews(next){
  const dust=next.reminders?.enderDust;
  const threshold=Math.min(MINION_ENDER_DUST_CAPACITY,Math.max(1,Math.round(Number($('#ender-dust-reminder-threshold').value)||DEFAULT_ENDER_DUST_THRESHOLD)));
  const amount=dust?.enderDust??threshold,capacity=dust?.capacity||MINION_ENDER_DUST_CAPACITY;
  const reminderSignature=JSON.stringify([next.accountKey,next.viewedAccount?.key,amount,capacity,reminderAccent?.name]);
  if(reminderSignature!==reminderKey){reminderKey=reminderSignature;
   dustPreview.innerHTML=chatHtml(enderDustReminderMessage(amount,capacity));
   georgePreview.innerHTML=chatHtml(GAMBLER_GEORGE_REMINDER_MESSAGE);
  }
 }
 const onReminderAccent=event=>{reminderAccent=minecraftChat.setChatPrefixAccent(event.detail.color);updateApiAccent(event.detail.color);updateReminderPreviews(getState()||{});};
 const onReminderThreshold=()=>updateReminderPreviews(getState()||{});
 view.addEventListener('fury:accent-change',onReminderAccent);
 $('#ender-dust-reminder-threshold').addEventListener('input',onReminderThreshold);
 function update(next){
  ranges.forEach(sync=>sync());
  updateReminderPreviews(next);
  dashboard.update(next);
 }
 update(getState()||{});
 return {update,onNavigate:dashboard.onNavigate,dispose(){view.removeEventListener('fury:accent-change',onReminderAccent);$('#ender-dust-reminder-threshold').removeEventListener('input',onReminderThreshold);dashboard.dispose?.();}};
}
module.exports={mount};
