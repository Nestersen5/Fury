'use strict';

const cards = require('./launcher_session_card');
const accountSkins = require('./launcher_account_skin');
const ICONS = {
    dashboard:'<path d="m3 10 9-8 9 8M5 9v12h14V9M9 21v-7h6v7"/>',
    overlay:'<rect x="2" y="3" width="20" height="14" rx="1"/><path d="M8 22h8M12 17v5"/>',
    sessions:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M7 2v5M17 2v5M3 10h18M7 14h3M7 18h6"/>',
    denicks:'<circle cx="12" cy="6" r="4"/><path d="M3 22v-2a9 9 0 0 1 18 0v2"/>',
    reminders:'<path d="M4 17c3-3 1-5 2-10a6 6 0 0 1 12 0c1 5-1 7 2 10H4ZM9 21c2 2 4 2 6 0M12 1v2"/>',
    profiles:'<path d="m2 7 10-5 10 5-10 5L2 7Zm0 5 10 5 10-5M2 17l10 5 10-5"/>',
    settings:'<path d="m9 2-.7 3-2.6 1.5L3 5.7 1 9l2 2v3l-2 2 2 3.3 2.7-.8L8.3 20l.7 3h4l.7-3 2.6-1.5 2.7.8 2-3.3-2-2v-3l2-2-2-3.3-2.7.8L13.7 5 13 2H9Z" transform="translate(1 -1) scale(.95)"/><circle cx="12" cy="12" r="3.5"/>',
    console:'<path d="M4 1h10l6 6v16H4V1Zm10 0v7h6M8 12h8M8 16h8M8 20h5"/>',
    chevron:'<path d="m6 9 6 6 6-6"/>', close:'<path d="m5 5 14 14M19 5 5 19"/>', copy:'<rect x="8" y="7" width="13" height="15" rx="2"/><path d="M16 7V2H3v16h5"/>', download:'<path d="M12 2v13m-5-5 5 5 5-5M3 16v6h18v-6"/>'
};
const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.settings}</svg>`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

function mount({ document, invoke, clipboard, nativeImage, navigate, settingsPage, getState, switchAccount, removeAccount, refresh, validateNetwork }) {
    const $ = value => document.querySelector(value);
    const $$ = value => [...document.querySelectorAll(value)];
    const node = (tag, className, html = '') => { const el=document.createElement(tag); el.className=className; el.innerHTML=html; return el; };
    const button = (label, action, className='') => { const el=node('button',className,label);el.type='button';el.addEventListener('click',action);return el; };
    document.documentElement.classList.add('fury-redesign');
    accountSkins.observe();
    const style=node('link','');style.rel='stylesheet';style.href='src/launcher/styles/launcher_redesign.css';document.head.append(style);
    // Retain the original controls and listeners, changing their presentation.
    const logo=node('span','fury-mark','<img src="assets/fury-icon.png" alt="" width="40" height="40" draggable="false">');
    $('.proxy-wordmark').before(logo);$('.proxy-wordmark').textContent='FURY';
    $('#proxy-start').append(node('span','','Start proxy'));$('#proxy-stop').append(node('span','','Stop proxy'),node('i','running-dot'));
    $('#proxy-stop').hidden=true;
    $('#global-search-input').placeholder='Search Fury…';
    const accountButton=button('',()=>toggleAccountMenu(),'fury-account-trigger');accountButton.id='fury-account-trigger';accountButton.setAttribute('aria-haspopup','menu');accountButton.setAttribute('aria-expanded','false');
    const chrome=node('div','fury-window-controls');
    for(const [action,html] of [['minimize','<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>'],['maximize','<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1"/></svg>'],['close',svg('close')]]) {const b=button(html,()=>invoke('window:control',action));b.setAttribute('aria-label',`${action} window`);b.title=`${action} window`;chrome.append(b);}
    $('.header-actions').append(accountButton,chrome);
    $$('.nav-tab').forEach(b=>{const label=b.dataset.pageLabel||({denicks:'Nicks',console:'Console Logs'}[b.dataset.pageTab]||b.dataset.pageTab);b.innerHTML=`<i class="fury-active-bar" aria-hidden="true"></i>${svg(b.dataset.pageTab)}<span class="fury-nav-label">${escape(label)}</span>`;b.title=label;});
    const collapse=$('#sidebar-toggle');collapse.innerHTML='<svg viewBox="0 0 24 24"><path d="m14 5-7 7 7 7"/></svg><span>Collapse</span>';$('.app-rail').append(collapse);
    $$('.tab-page > .page-title .eyebrow,.tab-page > .page-title > div > .note').forEach(el=>el.classList.add('fury-removed'));
    // Remove excluded surfaces from navigation and rendered DOM. Their old
    // diagnostic controls remain detached so legacy feature setup cannot run.
    ['#overlay-floating-window','#overlay-preview-mode','#overlay-exit-preview','#app-fullscreen'].forEach(sel=>$(sel)?.remove());
    ['.dashboard-summary-grid','.dashboard-page .page-actions','.workspace-page-chip','.rail-home','.rail-rule','.denick-saved-explainer','.fc-related-settings-footer','.api-keys-intro','.api-key-settings-footer'].forEach(sel=>$$(sel).forEach(el=>el.classList.add('fury-removed')));

    const guide=$('.dashboard-server-guide');
    $('#join-proxy-title').textContent='Minecraft connection';
    $('.join-steps').innerHTML='<li><b>1</b><div><strong>Start proxy</strong><span>Use the top button to start the proxy.</span></div></li><li><b>2</b><div><strong>Add a Minecraft server</strong><span>Copy and use the address in Minecraft when adding a new multiplayer server.</span></div></li><li><b>3</b><div><strong>Join through Fury</strong><span>Connect in Minecraft and start playing.</span></div></li>';
    $('.join-route label').textContent='Direct (recommended)';
    $$('.join-route').forEach(route=>{const copy=node('div','fury-route-copy');route.prepend(copy);copy.append(route.querySelector('label'),route.querySelector('p'));});
    guide.classList.add('fury-connection-strip');
    const connectionIdentity=node('div','fury-connection-identity',`${svg('overlay')}<div></div>`);
    const connectionStatus=node('span','fury-connection-status');connectionStatus.setAttribute('role','status');
    connectionIdentity.lastElementChild.append($('#join-proxy-title'),connectionStatus);
    const directField=$('#join-direct-address').closest('.join-address-field');
    $('#join-direct-address').setAttribute('aria-label','Minecraft server address');
    const directCopy=$('[data-copy-route="direct"]');directCopy.dataset.copyLabel='Copy address';directCopy.textContent='Copy address';
    const setup=node('details','fury-connection-help','<summary>Setup help</summary>');
    const setupBody=node('div','fury-connection-disclosure');setupBody.append($('.join-steps'));setup.append(setupBody);
    const options=node('details','fury-connection-options','<summary>Connection options</summary>');
    const optionsBody=node('div','fury-connection-disclosure fury-route-menu','<div class="fury-route-menu-heading"><h3>Connection options</h3></div>');
    const routeList=$('.join-addresses');
    const directRoute=routeList.children[0],backupRoute=routeList.children[1];
    directRoute.classList.add('fury-direct-route');backupRoute.classList.add('fury-backup-route');
    directRoute.querySelector('label').textContent='Direct';
    backupRoute.querySelector('label').textContent='Proxy';
    $('#join-direct-help').textContent='The address in the connection bar.';
    $('#join-failover-help').textContent='Connect through proxy when you cannot join Hypixel directly';
    for(const route of [directRoute,backupRoute]) {
        const destination=route.querySelector('.join-destination');
        destination.prepend(node('span','fury-route-arrow','\u2192'));
    }
    const backupCopy=$('[data-copy-route="failover"]');backupCopy.dataset.copyLabel='Copy address';backupCopy.textContent='Copy address';
    optionsBody.append(routeList);options.append(optionsBody);
    const copyStatus=$('.join-copy-status');copyStatus.classList.add('fury-connection-copy-status');
    guide.replaceChildren(connectionIdentity,directField,setup,options,copyStatus);
    setup.addEventListener('toggle',()=>{if(setup.open)options.open=false;});
    options.addEventListener('toggle',()=>{if(options.open)setup.open=false;});
    document.addEventListener('click',event=>{if(!guide.contains(event.target)){setup.open=false;options.open=false;}});
    guide.addEventListener('keydown',event=>{if(event.key==='Escape'){const opened=setup.open?setup:options.open?options:null;if(opened){opened.open=false;opened.querySelector('summary').focus();event.stopPropagation();}}});
    const dashboardRight=node('div','fury-dashboard-right');guide.after(dashboardRight);
    const accountCard=node('section','panel fury-account-card','<h2>Account</h2><div class="fury-account-card-content"></div>');dashboardRight.append(accountCard);
    const services=node('section','panel fury-services','<h2>Services</h2><div></div>');dashboardRight.append(services);
    const authPanel=$('.dashboard-access-card');authPanel.classList.add('fury-auth-content');
    authPanel.querySelector('.note').textContent='Continue in your browser to connect your Microsoft account.';
    $('#ms-login').textContent='Continue with Microsoft';
    const oldSystem=$('.dashboard-system-card');oldSystem.classList.add('fury-removed');
    const recent=node('section','panel fury-recent','<div class="fury-recent-heading"><h2>Recent session</h2></div><div class="fury-recent-content"></div>');
    recent.querySelector('.fury-recent-heading').append(button('View all sessions',()=>navigate('sessions'),'fury-view-sessions'));
    $('.dashboard-main-grid').append(recent);

    let menu=null, lastFocus=null, pendingRemoval=null, removingAccount=false;
    const manager=node('dialog','fury-dialog fury-account-manager', '<header><div><h2>Accounts</h2><p>Choose which account to view in Fury.</p></div></header><div class="fury-account-notice"></div><div class="fury-account-list"></div><footer></footer>');
    manager.querySelector('h2').id='fury-account-manager-title';manager.setAttribute('aria-labelledby','fury-account-manager-title');
    const authDialog=node('dialog','fury-dialog fury-signin','<header><div><h2>Sign in with Microsoft</h2><p>Link a Minecraft account to Fury.</p></div></header><label class="fury-signin-name">Minecraft username<input id="fury-signin-username" placeholder="Your Minecraft username" maxlength="16" autocomplete="off"></label>');
    authDialog.append(authPanel);document.body.append(manager,authDialog);
    authDialog.addEventListener('cancel',()=>{void invoke('auth:microsoft-cancel');});
    function closeDialog(dialog){if(dialog===authDialog)void invoke('auth:microsoft-cancel');dialog.close();lastFocus?.focus();}
    [manager,authDialog].forEach(dialog=>{const close=button(svg('close'),()=>closeDialog(dialog),'fury-close');close.setAttribute('aria-label','Close dialog');dialog.querySelector('header').append(close);dialog.addEventListener('click',e=>{if(e.target===dialog && (e.clientX<dialog.getBoundingClientRect().left||e.clientX>dialog.getBoundingClientRect().right||e.clientY<dialog.getBoundingClientRect().top||e.clientY>dialog.getBoundingClientRect().bottom))closeDialog(dialog);});});
    function openManager(){menu?.remove();menu=null;accountButton.setAttribute('aria-expanded','false');if(!removingAccount)pendingRemoval=null;lastFocus=document.activeElement;renderAccounts();manager.showModal();}
    function signIn(account=null){menu?.remove();menu=null;accountButton.setAttribute('aria-expanded','false');if(manager.open)manager.close();onboarding.start(account);}
    $('#fury-signin-username').addEventListener('input',e=>{$('#ms-username').value=e.target.value;});
    manager.querySelector('footer').append(button('+ Add account',()=>signIn(),'primary'),node('span','note','Sessions and reminder progress follow the selected account.'));
    function avatar(account,size=32){if(!account)return '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="11" r="6" fill="currentColor"/><path d="M5 29v-3a11 11 0 0 1 22 0v3" fill="currentColor"/></svg>';return `<img data-account-uuid="${escape(account?.uuid||'')}" alt="" width="${size}" height="${size}" hidden>`;}
    async function select(account){accountButton.disabled=true;menu?.remove();menu=null;accountButton.setAttribute('aria-expanded','false');try{await switchAccount(account);renderAccounts();}catch(error){notify(error.message);}finally{accountButton.disabled=false;}}
    async function confirmAccountRemoval(account){
        removingAccount=true;renderAccounts();
        try{await removeAccount(account);pendingRemoval=null;notify(`${account.name} removed. Saved sessions and reminder history kept.`);}
        catch(error){notify(error.message);}
        finally{removingAccount=false;renderAccounts();}
    }
    function renderAccounts(){
        manager.querySelector('h2').textContent='Manage accounts';
        manager.querySelectorAll('footer button').forEach(control=>control.disabled=removingAccount);
        const state=getState(),selected=state?.viewedAccount,catalog=state?.accountCatalog||[];
        accountButton.innerHTML=`<span class="fury-avatar">${avatar(selected)}</span><span>${escape(selected?.name||'Not signed in')}</span>${svg('chevron')}`;
        const connected=state?.proxyHealth?.connectedAccount;
        manager.querySelector('.fury-account-notice').textContent=connected?`Minecraft is connected as ${connected}. Selecting an account here changes the history and reminders you view.`:'Select an account to view its sessions and reminder progress.';
        const list=manager.querySelector('.fury-account-list');list.replaceChildren();
        if(!catalog.length)list.append(node('div','fury-empty','<strong>No accounts yet</strong><p>Add your Minecraft account to get started.</p>'));
        for(const account of catalog){
            const active=selected?.key===account.key,row=node('article',`fury-account-row${active?' selected':''}`,`<span class="fury-avatar large">${avatar(account,48)}</span><div><strong>${escape(account.name)}</strong><span class="note">${escape(account.label||'History available')}${connected===account.name?' · Connected in Minecraft':''}</span></div>`);
            if(active)row.querySelector('strong').after(node('span','fury-viewing-badge','Viewing'));
            row.dataset.accountKey=account.key;
            if(pendingRemoval===account.key){
                row.querySelector('.note').textContent='Remove this saved login? Sessions and reminder history will be kept.';
                row.append(button(removingAccount?'Removing…':'Remove account',()=>confirmAccountRemoval(account),'fury-remove-account'),button('Cancel',()=>{pendingRemoval=null;renderAccounts();}));
            }else{
                row.append(button(active?'View sessions':'Select',()=>active?(closeDialog(manager),navigate('sessions')):select(account),active?'selected':''),button(account.state==='valid'?'Refresh login':'Sign in',()=>signIn(account)));
                const remove=button('Remove',()=>{pendingRemoval=account.key;renderAccounts();},'fury-remove-account');
                remove.setAttribute('aria-label',`Remove ${account.name}`);
                remove.disabled=connected?.toLowerCase()===account.name.toLowerCase();
                if(remove.disabled)remove.title='Disconnect this account from Minecraft before removing it.';
                row.append(remove);
            }
            if(removingAccount)row.querySelectorAll('button').forEach(control=>control.disabled=true);
            list.append(row);
        }
        const content=accountCard.querySelector('.fury-account-card-content');content.innerHTML=`<span class="fury-avatar hero">${avatar(selected,80)}</span><div><strong>${escape(selected?.name||'No account selected')}</strong><span class="note"><i class="status-dot ${selected?.state==='valid'?'good':''}"></i>${escape(selected?.label||'Add an account')}</span></div>`;content.querySelector('div').append(button(`${svg('denicks')}Manage account`,openManager));
    }
    function toggleAccountMenu(){if(menu){menu.remove();menu=null;accountButton.setAttribute('aria-expanded','false');return;}menu=node('div','fury-account-menu');menu.setAttribute('role','menu');for(const account of getState()?.accountCatalog||[]) {const b=button(`<span class="fury-avatar">${avatar(account)}</span><span>${escape(account.name)}</span>${account.key===getState()?.accountKey?'<b>✓</b>':''}`,()=>select(account));b.setAttribute('role','menuitem');menu.append(b);}menu.append(button('Manage accounts',openManager),button('+ Add account',()=>signIn()));document.body.append(menu);accountButton.setAttribute('aria-expanded','true');menu.querySelector('button')?.focus();}
    document.addEventListener('click',e=>{if(menu&&!menu.contains(e.target)&&!accountButton.contains(e.target)){menu.remove();menu=null;accountButton.setAttribute('aria-expanded','false');}});
    document.addEventListener('keydown',e=>{if(!menu)return;const buttons=[...menu.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);if(e.key==='Escape'){menu.remove();menu=null;accountButton.setAttribute('aria-expanded','false');accountButton.focus();}else if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();buttons[(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}});
    function notify(message){$('#save-status').textContent=message;}

    // One stable settings directory, alongside the selected category.
    const settingsHeader=$('[data-page="settings"] > .page-title');settingsHeader.append(node('span','fury-autosaved','Saved'));
    $$('.settings-subnav-button').forEach(b=>{b.title=b.querySelector('strong').textContent;});
    const display=$('[data-settings-subpage="display"]');
    const inGameTabs=node('nav','fury-ingame-tabs');inGameTabs.setAttribute('role','tablist');inGameTabs.setAttribute('aria-label','In-game appearance');display.querySelector('.feature-section-title').after(inGameTabs);
    const tablist=$('.tablist-designer').closest('.settings-subgroup'),world=$('.world-label-designer').closest('.settings-subgroup');
    const names=node('div','fury-ingame-pane');display.append(names);
    const real=$('#real-identity-options');if(real)names.append(real);
    const colors=$('.bedwars-event-accent-card');if(colors)names.append(colors);
    const eventPreview=node('div','fury-event-preview','<h3>Chat & scoreboard preview</h3><div><span>Original</span><strong>FINAL KILL!</strong></div><div><span>Your accent</span><strong>FINAL KILL!</strong></div>');names.append(eventPreview);
    [tablist,world,names].forEach((pane,i)=>{pane.classList.add('fury-ingame-pane');pane.dataset.ingame=['tablist','nametags','colors'][i];pane.id=`fury-ingame-${pane.dataset.ingame}-panel`;pane.setAttribute('role','tabpanel');pane.setAttribute('aria-labelledby',`fury-ingame-${pane.dataset.ingame}-tab`);});
    function showIngame(key){[tablist,world,names].forEach(p=>p.classList.toggle('fury-ingame-active',p.dataset.ingame===key));inGameTabs.querySelectorAll('button').forEach(b=>{const selected=b.dataset.ingame===key;b.classList.toggle('active',selected);if(b.getAttribute('aria-selected')!==String(selected))b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;});if(display.classList.contains('active'))settingsPage('display',false);}
    for(const [key,label] of [['tablist','Tab list'],['nametags','Nametags'],['colors','Names & colors']]){const b=button(label,()=>showIngame(key));b.dataset.ingame=key;b.id=`fury-ingame-${key}-tab`;b.setAttribute('role','tab');b.setAttribute('aria-controls',`fury-ingame-${key}-panel`);inGameTabs.append(b);}showIngame('tablist');
    inGameTabs.addEventListener('keydown',event=>{
        const choices=[...inGameTabs.querySelectorAll('button')],index=choices.indexOf(event.target);
        if(index<0||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?choices.length-1:(index+(event.key==='ArrowRight'?1:choices.length-1))%choices.length;
        choices[next].focus(); // Manual activation: focus movement does not rerender a preview.
    });
    const worldDesigner=$('.world-label-designer'),preview=$('#nametag-preview-stage'),worldControls=node('div','fury-nametag-controls');
    worldDesigner.prepend(worldControls);[...worldDesigner.children].filter(el=>el!==worldControls&&!el.classList.contains('world-label-layout')).forEach(el=>worldControls.append(el));
    const audiences=$('.world-label-layout').querySelector('.nametag-audience-cards')||$('.world-label-layout').lastElementChild;if(audiences&&audiences!==preview)worldControls.append(audiences);worldDesigner.append(preview);
    const previewHeader=node('div','fury-nametag-preview-header','<strong>Preview</strong><div></div>');preview.prepend(previewHeader);
    const audienceChoices=previewHeader.querySelector('div');audienceChoices.setAttribute('role','radiogroup');audienceChoices.setAttribute('aria-label','Preview player group');
    for(const [key,label] of [['teammates','Teammates'],['threats','Threats'],['others','Others']]){const b=button(label,()=>document.querySelector(`[data-nametag-audience="${key}"]`).click());b.dataset.previewAudience=key;b.setAttribute('role','radio');b.setAttribute('aria-checked',String(key==='threats'));b.tabIndex=key==='threats'?0:-1;audienceChoices.append(b);}
    audienceChoices.addEventListener('keydown',event=>{
        const choices=[...audienceChoices.querySelectorAll('button')],index=choices.indexOf(event.target);
        if(index<0||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?choices.length-1:(index+(event.key==='ArrowRight'?1:choices.length-1))%choices.length;
        choices[next].click();choices[next].focus();
    });
    const sidebarOptions=node('section','appearance-control-section fury-sidebar-options','<h3>Sidebar style</h3><p>Choose the sidebar style outside Settings. Settings uses compact navigation.</p>');
    for(const [value,label] of [['expanded','Expanded'],['collapsed','Compact']]) {const b=button(`<span class="fury-check-box"></span>${label}`,()=>{window.NesterTheme.applySidebar(value);});b.dataset.sidebarChoice=value;sidebarOptions.append(b);}$('.appearance-studio-controls').append(sidebarOptions);
    function convertChecks(){
        $$('.session-field-chips label').forEach(label=>{if(label.classList.contains('fury-chip'))return;const title=label.textContent.trim();label.classList.add('switch');label.dataset.settingsLabel=title;[...label.childNodes].filter(child=>child.nodeType===3).forEach(child=>child.remove());});
        $$('.switch').forEach(label=>{
            const input=label.querySelector('input[type="checkbox"]');if(!input||input.hidden||label.classList.contains('fury-chip'))return;
            const title=label.querySelector('.fc-check-text')?.textContent||input.getAttribute('aria-label')||label.dataset.settingsLabel||label.closest('.feature-card,.appearance-motion-card,.denick-setting-card,.nametag-audience-card,.bedwars-event-accent-option')?.querySelector('h3,h4')?.textContent||'Enabled';
            label.classList.add('fury-chip');
            [...label.children].filter(el=>el!==input).forEach(el=>el.hidden=true);
            const caption=label.closest('.feature-toggle')&&!label.closest('.fc-choice-card,.share-option-row,.bedwars-event-accent-option')?'Enabled':title.replace(/^(Enable|Render) /,'');
            label.append(node('span','fury-check-box'),node('span','fury-chip-label',escape(caption)));input.setAttribute('aria-label',title);
        });
    }convertChecks();
    const checkObserver=new MutationObserver(convertChecks);checkObserver.observe($('.settings-content'),{childList:true,subtree:true});
    $$('.denick-setting-card .denick-visibility-badge,.denick-output-scope').forEach(el=>el.classList.add('fury-visibility'));

    // Session list contains images, and never exposes the old per-game view.
    const sessionsPage=$('[data-page="sessions"]');
    ['#session-live-dashboard','#session-history-summary','.session-history-controls'].forEach(sel=>$(sel)?.classList.add('fury-removed'));
    const toolbar=node('div','fury-session-toolbar');const modeSelect=$('#session-mode-filter'),dateSelect=$('#session-date-filter');toolbar.append(modeSelect,dateSelect);dateSelect.hidden=false;dateSelect.removeAttribute('aria-hidden');dateSelect.tabIndex=0;
    $('.session-date-browser').before(toolbar);$('.session-date-browser').classList.add('fury-removed');
    const specificDay=$('.session-specific-day');toolbar.append(specificDay);const syncDay=()=>specificDay.hidden=dateSelect.value!=='day';dateSelect.addEventListener('change',syncDay);syncDay();
    const originalModeLabels=new Map([...modeSelect.options].map(o=>[o.value,o.textContent]));modeSelect.setAttribute('aria-label','Filter session game mode');
    const calendarView=require('./launcher_calendar_stats').mount({document,node,button,svg,escape,toolbar,dateSelect,specificDay,getState,openManager,notify,clipboard,nativeImage,onChange:()=>{sessionsKey='';renderSessions(calendarView.history,calendarView.filters);}});
    let sessionsKey='',sessionsDay='',cardGeneration=0;const cardsById=new Map(),openSessionCards=new Map();
    const fieldKeys={BEDWARS:'sessionBedwarsFields',SKYWARS:'sessionSkywarsFields',DUELS:'sessionDuelsFields'};
    async function makePreview(session,host,mode,epoch,submode='overall'){
        const target=host.querySelector('.fury-card-image')||node('div','fury-card-image','<span class="note">Generating session card…</span>');host.append(target);const request=host.previewRequest=(host.previewRequest||0)+1;
        const account=getState()?.viewedAccount;
        try{const result=await cards.render(session,{mode,submode,skinAccount:session.uuid?session:account||session,fields:getState()?.settings?.features?.[fieldKeys[mode||session.modes?.[0]?.mode]]});if(request!==host.previewRequest||!target.isConnected||account?.key!==getState()?.viewedAccount?.key)return;if(!target.querySelector('canvas'))result.canvas.classList.add('fury-account-preview-enter');target.replaceChildren(result.canvas);cardsById.set(`${session.id}:${mode}:${submode}`,result);}catch(error){if(request===host.previewRequest&&target.isConnected&&!target.querySelector('canvas'))target.textContent=error.message;}
    }
    function renderSessions(history={},filters={}){
        if(typeof calendarView!=='undefined'&&calendarView.update(history,filters))return;
        const account=getState()?.viewedAccount;const source=typeof calendarView!=='undefined'?calendarView.filterSessions(history.sessions||[]):history.sessions||[];
        const visible=source.filter(filters.matches||(()=>true));
        const today=new Date().toDateString();
        const key=JSON.stringify([account?.key,source,filters.mode,filters.date,getState()?.settings?.features?.sessionBedwarsFields,getState()?.settings?.features?.sessionSkywarsFields,getState()?.settings?.features?.sessionDuelsFields]);
        const sameConnected=account?.uuid?account.uuid===String(getState()?.proxyHealth?.connectedUuid||'').replace(/-/g,'').toLowerCase():account?.name===getState()?.proxyHealth?.connectedAccount;
        $('#sessions-start-new').disabled=!sameConnected;$('#sessions-end-current').disabled=!sameConnected||!source.some(s=>s.active);
        if(key===sessionsKey){
            if(today!==sessionsDay){sessionsDay=today;for(const regenerate of openSessionCards.values())regenerate();}
            return;
        }
        sessionsKey=key;sessionsDay=today;cardGeneration++;openSessionCards.clear();
        const opened=new Map([...$('#session-history-list').querySelectorAll('details[open]')].map(row=>[row.dataset.sessionId,{mode:row.dataset.cardMode,submode:row.dataset.cardSubmode}]));
        const list=$('#session-history-list'),oldRows=new Map([...list.querySelectorAll('details')].map(row=>[row.dataset.sessionId,row])),children=[];
        if(!visible.length){list.replaceChildren(node('div','fury-empty',`<span class="fury-empty-icon">${svg('sessions')}</span><h3>${source.length?'No sessions match these filters':'No sessions yet'}</h3><p>${account?`Play through Fury as ${escape(account.name)} to save your sessions here.`:'Select an account to view its sessions.'}</p>`));return;}
        const epoch=cardGeneration;let lastDay='';
        for(let session of visible){
            const day=cards.date(session.startedAt);if(lastDay!==day){children.push(node('div','fury-session-day',`<strong>${escape(day)}</strong><span></span>`));lastDay=day;}
            const layoutKey=JSON.stringify([account?.key,filters.mode,session.active,(session.modes||[]).map(m=>[m.mode,m.label,(m.submodes||[]).map(s=>[s.id,s.label])]),getState()?.settings?.features?.sessionBedwarsFields,getState()?.settings?.features?.sessionSkywarsFields,getState()?.settings?.features?.sessionDuelsFields]);
            const previous=oldRows.get(session.id);
            if(previous?.layoutKey===layoutKey){previous.updateSession(session);children.push(previous);continue;}
            const row=node('details','fury-session-row');row.dataset.sessionId=session.id;row.layoutKey=layoutKey;
            const summaryMarkup=()=>`<span class="fury-session-icon">${svg('sessions')}</span><div><strong>${escape(session.name)}</strong><span class="note">${cards.time(session.startedAt)} – ${session.active?'Live':cards.time(session.endedAt||session.lastSeen)} <i>·</i> <b>${cards.duration(session.durationMs)}</b></span></div><span class="fury-session-result">${(session.modes||[]).map(m=>`${escape(m.label)} <b>${m.local?'Local tracking':`${m.wins}W / ${m.losses}L`}</b>`).join('　')}</span><span class="fury-view-label">View card ${svg('chevron')}</span>`;
            const summary=node('summary','',summaryMarkup());row.append(summary);
            const content=node('div','fury-session-content'),controls=node('div','fury-card-toolbar','<strong>Session card</strong>');
            let modes=session.modes||[];
            let selectedMode=modes.some(m=>m.mode===filters.mode)?filters.mode:modes.some(m=>m.mode===opened.get(session.id)?.mode)?opened.get(session.id)?.mode:modes[0]?.mode;
            row.dataset.cardMode=selectedMode||'';
            let selectedSubmode=opened.get(session.id)?.submode||'overall';
            const submodeControl=node('div','fury-card-mode fury-card-mode-options fury-card-submode-options');
            const syncSubmodes=()=>{
                const choices=[{id:'overall',label:'Overall'},...(modes.find(m=>m.mode===selectedMode)?.submodes||[])];
                if(!choices.some(m=>m.id===selectedSubmode))selectedSubmode='overall';
                row.dataset.cardSubmode=selectedSubmode;
                submodeControl.replaceChildren();submodeControl.hidden=choices.length===1;if(choices.length===1)return;
                submodeControl.setAttribute('role','radiogroup');submodeControl.setAttribute('aria-label','Session card mode details');
                submodeControl.style.setProperty('--mode-count',choices.length);
                submodeControl.style.setProperty('--mode-index',choices.findIndex(m=>m.id===selectedSubmode));
                const thumb=node('span','fury-card-mode-thumb');thumb.setAttribute('aria-hidden','true');submodeControl.append(thumb);
                choices.forEach((choice,index)=>{
                    const b=button(escape(choice.label),()=>{if(selectedSubmode===choice.id)return;selectedSubmode=choice.id;row.dataset.cardSubmode=selectedSubmode;submodeControl.style.setProperty('--mode-index',index);submodeControl.querySelectorAll('button').forEach(item=>{const active=item===b;item.setAttribute('aria-checked',String(active));item.tabIndex=active?0:-1;});generate();});
                    b.dataset.submode=choice.id;b.setAttribute('role','radio');b.setAttribute('aria-checked',String(choice.id===selectedSubmode));b.tabIndex=choice.id===selectedSubmode?0:-1;
                    b.addEventListener('keydown',event=>{let next;if(event.key==='Home')next=0;else if(event.key==='End')next=choices.length-1;else if(['ArrowRight','ArrowDown'].includes(event.key))next=(index+1)%choices.length;else if(['ArrowLeft','ArrowUp'].includes(event.key))next=(index+choices.length-1)%choices.length;else return;event.preventDefault();const target=submodeControl.querySelectorAll('button')[next];target.click();target.focus();});
                    submodeControl.append(b);
                });
            };
            syncSubmodes();
            const modeControl=node('div','fury-card-mode');
            if(!filters.mode&&modes.length>1){
                modeControl.classList.add('fury-card-mode-options');modeControl.setAttribute('role','radiogroup');modeControl.setAttribute('aria-label','Session card game mode');
                modeControl.style.setProperty('--mode-count',modes.length);
                const thumb=node('span','fury-card-mode-thumb');thumb.setAttribute('aria-hidden','true');modeControl.append(thumb);
                const syncMode=()=>{modeControl.style.setProperty('--mode-index',modes.findIndex(m=>m.mode===selectedMode));modeControl.querySelectorAll('button').forEach(b=>{const active=b.dataset.mode===selectedMode;b.setAttribute('aria-checked',String(active));b.tabIndex=active?0:-1;});};
                for(const mode of modes){
                    const choice=button(escape(mode.label),()=>{if(selectedMode===mode.mode)return;selectedMode=mode.mode;row.dataset.cardMode=selectedMode;syncMode();syncSubmodes();generate();});
                    choice.dataset.mode=mode.mode;choice.setAttribute('role','radio');
                    choice.addEventListener('keydown',event=>{const index=modes.findIndex(m=>m.mode===selectedMode);let next;if(event.key==='Home')next=0;else if(event.key==='End')next=modes.length-1;else if(['ArrowRight','ArrowDown'].includes(event.key))next=(index+1)%modes.length;else if(['ArrowLeft','ArrowUp'].includes(event.key))next=(index+modes.length-1)%modes.length;else return;event.preventDefault();const target=modeControl.querySelectorAll('button')[next];target.click();target.focus();});
                    modeControl.append(choice);
                }
                syncMode();
            }else modeControl.textContent=modes.find(m=>m.mode===selectedMode)?.label||'Session';
            const imageHost=node('div','fury-card-stage');
            const exportCard=async download=>{const key=`${session.id}:${selectedMode}:${selectedSubmode}`,result=cardsById.get(key);if(!result){notify('Wait for the card to finish generating.');return;}try{const url=result.canvas.toDataURL('image/png');if(download){const a=document.createElement('a');a.href=url;a.download=result.filename;a.click();notify('Session card saved');}else{clipboard.writeImage(nativeImage.createFromDataURL(url));notify('Session card copied');}}catch(error){notify(`Could not export card: ${error.message}`);}};
            controls.append(modeControl,submodeControl,button(`${svg('copy')}Copy image`,()=>exportCard(false)),button(`${svg('download')}Download PNG`,()=>exportCard(true),'fury-gold-outline'));
            if(!session.active)controls.append(button(svg('close'),async()=>{const b=controls.lastElementChild;if(!b.dataset.confirm){b.dataset.confirm='1';b.textContent='Delete session?';setTimeout(()=>{if(b.isConnected){delete b.dataset.confirm;b.innerHTML=svg('close');}},4000);return;}const result=await invoke('session:action',{type:'delete',sessionId:session.id,accountKey:account?.key});if(result.ok)await refresh();else notify(result.error);},'fury-delete-session'));
            controls.lastElementChild.setAttribute('aria-label',session.active?'Download session card':'Delete session');
            content.append(controls,imageHost);row.append(content);children.push(row);
            let generatedDay='';const generate=()=>{void makePreview(session,imageHost,selectedMode,epoch,selectedSubmode);generatedDay=new Date().toDateString();};
            const previewKey=value=>JSON.stringify([value.name,value.uuid,value.startedAt,value.active,value.endedAt,value.active?null:value.lastSeen,Math.floor((value.durationMs||0)/60000),value.modes]);
            let renderedKey=previewKey(session);
            row.updateSession=next=>{
                const nextKey=previewKey(next),changed=nextKey!==renderedKey;
                session=next;modes=next.modes||[];renderedKey=nextKey;
                const markup=summaryMarkup();if(summary.innerHTML!==markup)summary.innerHTML=markup;
                if(row.open){openSessionCards.set(session.id,generate);if(changed||generatedDay!==new Date().toDateString())generate();}
                else if(changed)generatedDay='';
            };
            row.addEventListener('toggle',()=>{
                if(row.open){openSessionCards.set(session.id,generate);if(generatedDay!==new Date().toDateString())generate();}
                else openSessionCards.delete(session.id);
            });
            if(opened.has(session.id)){row.open=true;generate();}
        }
        children.forEach((child,index)=>{if(list.children[index]!==child)list.insertBefore(child,list.children[index]||null);});
        while(list.children.length>children.length)list.lastElementChild.remove();
    }
    const consoleTabs=$('[data-page="console"] .tabs');consoleTabs.replaceChildren();let logSource='all';
    const logSearch=node('input','fury-log-search');logSearch.type='search';logSearch.placeholder='Filter logs…';logSearch.setAttribute('aria-label','Filter console logs');
    for(const source of ['all','proxy','launcher']){const b=button(source[0].toUpperCase()+source.slice(1),()=>{logSource=source;renderLogs();});b.dataset.logSource=source;consoleTabs.append(b);}consoleTabs.append(logSearch);logSearch.addEventListener('input',renderLogs);
    function renderLogs(){const lines=getState()?.services?.proxy?.logs||[],query=logSearch.value.toLowerCase();$('#log-output').textContent=lines.filter(line=>{const launcher=/\[Launcher\]/i.test(line);return(logSource==='all'||(logSource==='launcher'?launcher:!launcher))&&line.toLowerCase().includes(query);}).join('\n');consoleTabs.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.logSource===logSource));}
    $('#clear-logs').textContent='Clear logs';
    $('#overlay-layout-toggle [data-overlay-action-label]').textContent='Columns';$('.overlay-preview-heading h2').textContent='Player board';$('.overlay-drawer-heading h3').textContent='Columns';
    const closeColumns=button(svg('close'),()=>$('#overlay-layout-toggle').click(),'fury-close-columns');closeColumns.setAttribute('aria-label','Close columns');$('.overlay-drawer-heading').append(closeColumns);
    const overlayFilter=node('input','fury-overlay-filter');overlayFilter.type='search';overlayFilter.placeholder='Filter players…';overlayFilter.setAttribute('aria-label','Filter players');$('.overlay-preview-actions').prepend(overlayFilter);overlayFilter.addEventListener('input',fitOverlay);
    const overlayBoard=require('./launcher_overlay_board.js');
    const overlayNoResults=node('div','fury-empty-inline fury-overlay-no-results','No players match this filter.');overlayNoResults.hidden=true;overlayNoResults.setAttribute('role','status');$('#overlay-table').after(overlayNoResults);
    function fitOverlay(){const query=overlayFilter.value.toLowerCase(),rows=$$('#overlay-table .fury-board-row[data-player]');let visible=0;rows.forEach(row=>{const filtered=Boolean(query&&!row.textContent.toLowerCase().includes(query));row.classList.toggle('fury-filtered',filtered);if(!filtered)visible++;});overlayNoResults.hidden=!(query&&rows.length&&!visible);$$('#overlay-table .fury-board-card').forEach(card=>card.classList.toggle('fury-filtered',Boolean(query)&&!card.querySelector('.fury-board-row[data-player]:not(.fury-filtered)')));overlayBoard.fitBoard($('#overlay-table'));}
    new MutationObserver(fitOverlay).observe($('#overlay-table'),{childList:true});
    const recentTarget=$('.fury-recent-content');let recentKey='';
    const pages = require('./launcher_redesign_pages').mount({ document, node, button, getState, openManager, validateNetwork });
    const nicks = require('./launcher_redesign_nicks').mount({ document, node, button, escape });
    const refinedSettings = require('./launcher_settings_refinement').mount({document,node,button});
    const inGameAppearance = require('./launcher_ingame_appearance').mount({document});
    require('./launcher_segmented_controls').mount(document);
    const onboarding=require('./launcher_onboarding').mount({document,node,button,invoke,clipboard,navigate,getState,refresh,skin:avatar});
    function update(next){onboarding.update();renderAccounts();renderLogs();convertChecks();fitOverlay();pages.update(next);
        $('#proxy-start').hidden=Boolean(next.services?.proxy?.running);$('#proxy-stop').hidden=!next.services?.proxy?.running;
        const proxyRunning=Boolean(next.services?.proxy?.running);
        connectionStatus.textContent=proxyRunning?'Proxy running':'Proxy stopped';connectionStatus.classList.toggle('running',proxyRunning);
        services.querySelector('div').innerHTML=['Hypixel','Urchin','Aurora','Seraph'].map(name=>`<button data-fury-api="${name.toLowerCase()}"><strong>${name}</strong><span class="${next.settings?.keys?.[name.toLowerCase()]?'good':''}"><i class="status-dot ${next.settings?.keys?.[name.toLowerCase()]?'good':''}"></i>${next.settings?.keys?.[name.toLowerCase()]?'Configured':'Not configured'}</span>${svg('chevron')}</button>`).join('');services.querySelectorAll('button').forEach(b=>b.onclick=()=>{navigate('settings');settingsPage('api',false);$(`[data-api-card="${b.dataset.furyApi}"]`)?.scrollIntoView({block:'nearest'});});
        const latest=next.sessionHistory?.sessions?.[0],key=JSON.stringify([next.accountKey,next.viewedAccount?.key,next.viewedAccount?.name,latest?.id,latest?.durationMs]);
        if(key!==recentKey){recentKey=key;recentTarget.innerHTML=latest?`<div class="fury-recent-identity"><span class="fury-recent-avatar">${avatar(next.viewedAccount,44)}</span><div><h3>${escape(latest.name)}</h3><p>Recent session</p></div></div><div class="fury-recent-meta"><span>Day<strong>${escape(cards.date(latest.startedAt))}</strong></span><span>Started<strong>${cards.time(latest.startedAt)}</strong></span><span>Finished<strong>${latest.active?'Live':cards.time(latest.endedAt||latest.lastSeen)}</strong></span><span>Duration<strong>${cards.duration(latest.durationMs)}</strong></span></div>`:`<div class="fury-empty-inline">${svg('sessions')}<div><strong>No sessions yet</strong><p>${next.viewedAccount?'Your next session for '+escape(next.viewedAccount.name)+' will appear here.':'Your first session will appear here after you connect.'}</p></div></div>`;if(latest)recentTarget.append(button('Open session <span aria-hidden="true">&#8250;</span>',()=>{navigate('sessions');setTimeout(()=>$('#session-history-list details')?.setAttribute('open',''),100);},'fury-gold-outline'));}
        $$('.fury-sidebar-options button').forEach(b=>b.classList.toggle('active',b.dataset.sidebarChoice===(document.documentElement.dataset.sidebarPreference||document.documentElement.dataset.sidebar)));
        refinedSettings.update();
        inGameAppearance.update();
    }
    return { update, renderSessions, renderLogs, renderNicks:nicks.render, openManager, showIngame, clearAccount(){calendarView.clear();sessionsKey='';sessionsDay='';recentKey='';cardGeneration++;cardsById.clear();openSessionCards.clear();$('#session-history-list').replaceChildren();recentTarget.replaceChildren();pages.clearAccount();}, showSignIn:signIn };
}
module.exports={mount};
