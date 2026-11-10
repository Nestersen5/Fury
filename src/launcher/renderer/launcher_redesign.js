'use strict';

const cards = require('./launcher_session_card');
const accountSkins = require('./launcher_account_skin');
const ICONS = {
    nickroll:'<path d="M4 7h11a5 5 0 0 1 5 5M16 3l4 4-4 4M20 17H9a5 5 0 0 1-5-5M8 13l-4 4 4 4"/>',
    dashboard:'<path d="m3 10 9-8 9 8M5 9v12h14V9M9 21v-7h6v7"/>',
    overlay:'<rect x="2" y="3" width="20" height="14" rx="1"/><path d="M8 22h8M12 17v5"/>',
    sessions:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M7 2v5M17 2v5M3 10h18M7 14h3M7 18h6"/>',
    denicks:'<circle cx="12" cy="6" r="4"/><path d="M3 22v-2a9 9 0 0 1 18 0v2"/>',
    reminders:'<path d="M4 17c3-3 1-5 2-10a6 6 0 0 1 12 0c1 5-1 7 2 10H4ZM9 21c2 2 4 2 6 0M12 1v2"/>',
    profiles:'<path d="m2 7 10-5 10 5-10 5L2 7Zm0 5 10 5 10-5M2 17l10 5 10-5"/>',
    anticheat:'<path d="m12 2 9 4v6c0 5.5-3.5 9-9 11-5.5-2-9-5.5-9-11V6l9-4Z"/><path d="m8 12 3 3 5-6"/>',
    settings:'<path d="m9 2-.7 3-2.6 1.5L3 5.7 1 9l2 2v3l-2 2 2 3.3 2.7-.8L8.3 20l.7 3h4l.7-3 2.6-1.5 2.7.8 2-3.3-2-2v-3l2-2-2-3.3-2.7.8L13.7 5 13 2H9Z" transform="translate(1 -1) scale(.95)"/><circle cx="12" cy="12" r="3.5"/>',
    console:'<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M2 8h20m-15 4 4 3-4 3m7 0h4"/>',
    chevron:'<path d="m6 9 6 6 6-6"/>', close:'<path d="m5 5 14 14M19 5 5 19"/>', copy:'<rect x="8" y="7" width="13" height="15" rx="2"/><path d="M16 7V2H3v16h5"/>', download:'<path d="M12 2v13m-5-5 5 5 5-5M3 16v6h18v-6"/>',
    refresh:'<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>', sidebar:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>', up:'<path d="m6 15 6-6 6 6"/>', down:'<path d="m6 9 6 6 6-6"/>',
    trash:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', expand:'<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>', more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>', info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'
};
const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.settings}</svg>`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

function mount({ document, invoke, clipboard, nativeImage, navigate, settingsPage, getState, switchAccount, removeAccount, refresh }) {
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
    const directRoute=routeList.children[0],backupRoute=routeList.children[1],customRoute=routeList.children[2];
    directRoute.classList.add('fury-direct-route');backupRoute.classList.add('fury-backup-route');
    directRoute.querySelector('label').textContent='Direct';
    backupRoute.querySelector('label').textContent='Proxy';
    $('#join-direct-help').textContent='The address in the connection bar.';
    $('#join-failover-help').textContent='Connect through proxy when you cannot join Hypixel directly';
    for(const route of [directRoute,backupRoute,customRoute]) {
        const destination=route.querySelector('.join-destination');
        destination.prepend(node('span','fury-route-arrow','\u2192'));
    }
    const backupCopy=$('[data-copy-route="failover"]');backupCopy.dataset.copyLabel='Copy address';backupCopy.textContent='Copy address';
    const customCopy=$('[data-copy-route="custom"]');customCopy.dataset.copyLabel='Copy address';customCopy.textContent='Copy address';
    optionsBody.append(routeList);options.append(optionsBody);
    const copyStatus=$('.join-copy-status');copyStatus.classList.add('fury-connection-copy-status');
    guide.replaceChildren(connectionIdentity,directField,setup,options,copyStatus);
    const connectionWindow=document.defaultView,connectionScroller=$('main');
    function fitConnectionDisclosure(){
        const body=setup.open?setupBody:options.open?optionsBody:null;
        if(!body)return;
        const height=`${Math.max(0,connectionWindow.innerHeight-body.getBoundingClientRect().top-12)}px`;
        if(body.style.maxHeight!==height)body.style.maxHeight=height;
    }
    function syncConnectionDisclosure(){
        const method=setup.open||options.open?'addEventListener':'removeEventListener';
        connectionWindow[method]('resize',fitConnectionDisclosure);
        connectionScroller[method]('scroll',fitConnectionDisclosure);
        fitConnectionDisclosure();
    }
    setup.addEventListener('toggle',()=>{if(setup.open)options.open=false;syncConnectionDisclosure();});
    options.addEventListener('toggle',()=>{if(options.open)setup.open=false;syncConnectionDisclosure();});
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
    const scoreboard=node('div','fury-ingame-pane');display.append(scoreboard);
    const real=$('#real-identity-options');if(real)names.append(real);
    const colors=$('.bedwars-event-accent-card');if(colors)names.append(colors);
    const eventPreview=node('div','fury-event-preview','<h3>Chat & scoreboard preview</h3><div><span>Original</span><strong>FINAL KILL!</strong></div><div><span>Your accent</span><strong>FINAL KILL!</strong></div>');names.append(eventPreview);
    [tablist,world,names,scoreboard].forEach((pane,i)=>{pane.classList.add('fury-ingame-pane');pane.dataset.ingame=['tablist','nametags','colors','scoreboard'][i];pane.id=`fury-ingame-${pane.dataset.ingame}-panel`;pane.setAttribute('role','tabpanel');pane.setAttribute('aria-labelledby',`fury-ingame-${pane.dataset.ingame}-tab`);});
    function showIngame(key){[tablist,world,names,scoreboard].forEach(p=>p.classList.toggle('fury-ingame-active',p.dataset.ingame===key));inGameTabs.querySelectorAll('button').forEach(b=>{const selected=b.dataset.ingame===key;b.classList.toggle('active',selected);if(b.getAttribute('aria-selected')!==String(selected))b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;});if(display.classList.contains('active'))settingsPage('display',false);}
    for(const [key,label] of [['tablist','Tab list'],['nametags','Nametags'],['colors','Names & colors'],['scoreboard','Scoreboard']]){const b=button(label,()=>showIngame(key));b.dataset.ingame=key;b.id=`fury-ingame-${key}-tab`;b.setAttribute('role','tab');b.setAttribute('aria-controls',`fury-ingame-${key}-panel`);inGameTabs.append(b);}showIngame('tablist');
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
    const calendarView=require('./launcher_calendar_stats').mount({document,node,button,svg,escape,toolbar,dateSelect,specificDay,getState,openManager,notify,clipboard,nativeImage,toggleList:toggleSessionList,viewCard:openCardViewer,cardMenu:openCardMenu,onChange:()=>{sessionsKey='';renderSessions(calendarView.history,calendarView.filters);}});
    let sessionsKey='',sessionsDay='',cardGeneration=0;const cardsById=new Map(),openSessionCards=new Map();
    const fieldKeys={BEDWARS:'sessionBedwarsFields',SKYWARS:'sessionSkywarsFields',DUELS:'sessionDuelsFields'};
    // Recording status sits beside the existing session actions; their handlers are unchanged.
    const sessionStatus=node('span','fury-session-status','<i aria-hidden="true"></i><span>No active session</span>');sessionStatus.setAttribute('role','status');
    const refreshSessions=$('#sessions-refresh');refreshSessions.innerHTML=svg('refresh');refreshSessions.setAttribute('aria-label','Refresh sessions');refreshSessions.title='Refresh sessions';refreshSessions.classList.add('fury-icon-button');
    $('#sessions-start-new').textContent='Start session';
    refreshSessions.parentElement.prepend(sessionStatus);refreshSessions.parentElement.append(refreshSessions,$('#sessions-end-current'),$('#sessions-start-new'));
    sessionsPage.addEventListener('keydown',handleSessionKeys);
    async function makePreview(session,host,mode,epoch,submode='overall'){
        const target=host.querySelector('.fury-card-image')||node('div','fury-card-image','<span class="note">Generating session card…</span>');host.append(target);const request=host.previewRequest=(host.previewRequest||0)+1;
        const account=getState()?.viewedAccount;
        try{const result=await cards.render(session,{mode,submode,skinAccount:session.uuid?session:account||session,fields:getState()?.settings?.features?.[fieldKeys[mode||session.modes?.[0]?.mode]]});if(request!==host.previewRequest||!target.isConnected||account?.key!==getState()?.viewedAccount?.key)return;if(!target.querySelector('canvas'))result.canvas.classList.add('fury-account-preview-enter');target.replaceChildren(result.canvas);cardsById.set(`${session.id}:${mode}:${submode}`,result);}catch(error){if(request===host.previewRequest&&target.isConnected&&!target.querySelector('canvas'))target.textContent=error.message;}
    }
    function renderSessions(history={},filters={}){
        if(typeof calendarView!=='undefined'&&calendarView.update(history,filters))return;
        const account=getState()?.viewedAccount;const source=typeof calendarView!=='undefined'?calendarView.filterSessions(history.sessions||[]):history.sessions||[];
        const visible=source.filter(filters.matches||(()=>true));
        // Today and Yesterday labels change at midnight, so the day is part of the key.
        const today=new Date().toDateString();
        const key=JSON.stringify([today,account?.key,source,filters.mode,filters.date,getState()?.settings?.features?.sessionBedwarsFields,getState()?.settings?.features?.sessionSkywarsFields,getState()?.settings?.features?.sessionDuelsFields]);
        const sameConnected=account?.uuid?account.uuid===String(getState()?.proxyHealth?.connectedUuid||'').replace(/-/g,'').toLowerCase():account?.name===getState()?.proxyHealth?.connectedAccount;
        const live=source.find(s=>s.active),endButton=$('#sessions-end-current');
        $('#sessions-start-new').disabled=!sameConnected;endButton.disabled=!sameConnected||!live;endButton.hidden=!live;
        renderSessionStatus(live);
        if(key===sessionsKey)return;
        sessionsKey=key;sessionsDay=today;cardGeneration++;openSessionCards.clear();
        const select=pendingSessionSelection;pendingSessionSelection='';
        const opened=new Map([...$('#session-history-list').querySelectorAll('details[open]')].map(row=>[row.dataset.sessionId,{mode:row.dataset.cardMode,submode:row.dataset.cardSubmode}]));
        if(select&&!opened.size)opened.set(select,{});
        const list=$('#session-history-list'),oldRows=new Map([...list.querySelectorAll('details')].map(row=>[row.dataset.sessionId,row])),children=[];
        if(!visible.length){list.replaceChildren(node('div','fury-empty',`<span class="fury-empty-icon">${svg('sessions')}</span><h3>${source.length?'No sessions match these filters':'No sessions yet'}</h3><p>${account?`Play through Fury as ${escape(account.name)} to save your sessions here.`:'Select an account to view its sessions.'}</p>`));return;}
        const epoch=cardGeneration;let lastDay='';
        for(let session of visible){
            const day=new Date(session.startedAt).toDateString();if(lastDay!==day){children.push(node('div','fury-session-day',`<strong>${escape(sessionDayLabel(session.startedAt))}</strong><span></span>`));lastDay=day;}
            const layoutKey=JSON.stringify([account?.key,filters.mode,session.active,(session.modes||[]).map(m=>[m.mode,m.label,(m.submodes||[]).map(s=>[s.id,s.label])]),getState()?.settings?.features?.sessionBedwarsFields,getState()?.settings?.features?.sessionSkywarsFields,getState()?.settings?.features?.sessionDuelsFields]);
            const previous=oldRows.get(session.id);
            if(previous?.layoutKey===layoutKey){previous.updateSession(session);if(opened.has(session.id)&&!previous.open)previous.open=true;children.push(previous);continue;}
            const row=node('details','fury-session-row');row.dataset.sessionId=session.id;row.layoutKey=layoutKey;
            const summary=node('summary','',sessionSummaryMarkup(session));row.append(summary);
            const content=node('div','fury-session-content'),controls=node('div','fury-card-toolbar','<strong>Session card</strong>');
            // Detail header: when it was, then Copy, Save and a menu for everything else.
            const head=node('div','fury-session-detail-head'),heading=node('div','fury-session-detail-title',sessionHeadingMarkup(session)),actions=node('div','fury-session-detail-actions');
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
            }else{modeControl.textContent=modes.find(m=>m.mode===selectedMode)?.label||'Session';modeControl.hidden=true;}
            const imageHost=node('div','fury-card-stage');
            const currentCard=()=>cardsById.get(`${session.id}:${selectedMode}:${selectedSubmode}`);
            const exportCard=async download=>{const result=currentCard();if(!result){notify('Wait for the card to finish generating.');return;}try{const url=result.canvas.toDataURL('image/png');if(download){const a=document.createElement('a');a.href=url;a.download=result.filename;a.click();notify('Session card saved');}else{clipboard.writeImage(nativeImage.createFromDataURL(url));notify('Session card copied');}}catch(error){notify(`Could not export card: ${error.message}`);}};
            const copy=button(svg('copy'),()=>exportCard(false),'fury-card-copy'),save=button(`${svg('download')}<span>Save</span>`,()=>exportCard(true),'primary fury-card-save');
            copy.setAttribute('aria-label','Copy image');copy.title='Copy image (Ctrl+C)';save.setAttribute('aria-label','Save as PNG');save.title='Save as PNG (Ctrl+S)';
            row.cardActions={zoom:()=>openCardViewer(currentCard(),sessionTitle(session)),remove:session.active?null:()=>confirmSessionDelete(session,row,account)};
            const more=button(svg('more'),()=>openCardMenu(more,row),'fury-card-more');
            actions.append(copy,save,more);head.append(heading,actions);
            imageHost.addEventListener('click',event=>{if(event.target.closest('canvas'))row.cardActions.zoom();});
            controls.append(modeControl,submodeControl);
            content.append(head,controls,imageHost);row.append(content);children.push(row);
            let generatedDay='';const generate=()=>{void makePreview(session,imageHost,selectedMode,epoch,selectedSubmode);generatedDay=new Date().toDateString();};
            const previewKey=value=>JSON.stringify([value.name,value.uuid,value.startedAt,value.active,value.endedAt,value.active?null:value.lastSeen,Math.floor((value.durationMs||0)/60000),value.modes]);
            let renderedKey=previewKey(session);
            row.updateSession=next=>{
                const nextKey=previewKey(next),changed=nextKey!==renderedKey;
                session=next;modes=next.modes||[];renderedKey=nextKey;
                const markup=sessionSummaryMarkup(session);if(summary.innerHTML!==markup)summary.innerHTML=markup;
                const headMarkup=sessionHeadingMarkup(session);if(heading.innerHTML!==headMarkup)heading.innerHTML=headMarkup;
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
    // Rows are titled by what was played, and each game's Minecraft item marks the row.
    function sessionModeLook(mode){return {BEDWARS:{item:'bed',tone:'#f2625d'},SKYWARS:{item:'ender_eye',tone:'#4cc3e6'},DUELS:{item:'fishing_rod',tone:'#a98bf5'}}[mode];}
    function sessionTitle(session){const modes=session.modes||[];return modes.length?modes.map(m=>m.label).join(' + '):'New session';}
    function sessionDayLabel(value){
        const day=new Date(value),now=new Date(),midnight=date=>new Date(date.getFullYear(),date.getMonth(),date.getDate()).getTime();
        const days=Math.round((midnight(now)-midnight(day))/86400000);
        if(days===0)return 'Today';if(days===1)return 'Yesterday';
        return day.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric',...(day.getFullYear()===now.getFullYear()?{}:{year:'numeric'})});
    }
    function sessionTimeRange(session){
        const start=cards.time(session.startedAt);if(session.active)return `${start} – now`;
        const finished=session.endedAt||session.lastSeen,end=cards.time(finished),[from,startPeriod]=start.split(' '),[,endPeriod]=end.split(' ');
        return startPeriod&&startPeriod===endPeriod&&new Date(finished).toDateString()===new Date(session.startedAt).toDateString()?`${from} – ${end}`:`${start} – ${end}`;
    }
    function sessionSummaryMarkup(session){
        const modes=session.modes||[],look=sessionModeLook(modes[0]?.mode);
        const nextDay=!session.active&&new Date(session.endedAt||session.lastSeen).toDateString()!==new Date(session.startedAt).toDateString();
        const icon=look?`<img class="fury-session-item" src="assets/session-modes/${look.item}.png" alt="" draggable="false">`:svg('sessions');
        return `<span class="fury-session-icon"${look?` style="--session-tone:${look.tone}"`:''}>${icon}${modes.length>1?`<b class="fury-session-more">+${modes.length-1}</b>`:''}</span><div><strong><span>${escape(sessionTitle(session))}</span>${session.active?'<i class="fury-live-dot" title="Recording"></i>':''}</strong><span class="note">${sessionTimeRange(session)}${nextDay?'<span class="fury-next-day" title="Finished the next day">+1</span>':''} <i>·</i> <b>${cards.duration(session.durationMs)}</b></span></div><span class="fury-view-label">View card ${svg('chevron')}</span>`;
    }
    function sessionHeadingMarkup(session){
        const day=new Date(session.startedAt),label=sessionDayLabel(session.startedAt),relative=['Today','Yesterday'].includes(label),thisYear=day.getFullYear()===new Date().getFullYear()?{}:{year:'numeric'};
        const title=relative?label:day.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',...thisYear});
        const short=relative?label:day.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',...thisYear});
        const tag=session.active?'<span class="fury-session-tag live"><i></i>Live</span>':'';
        const modes=session.modes||[],games=modes.length&&modes.every(m=>Number.isFinite(m.games))?modes.reduce((n,m)=>n+m.games,0):null;
        const meta=[...(relative?[escape(day.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'}))]:[]),sessionTimeRange(session),`${cards.duration(session.durationMs)}${session.active?' so far':''}`,...(games===null?[]:[`${games.toLocaleString('en-US')} ${games===1?'game':'games'}`])];
        return `<h3><span><span class="fury-title-long">${escape(title)}</span><span class="fury-title-short">${escape(short)}</span></span>${tag}</h3><p class="note">${meta.join(' <i>·</i> ')}</p>`;
    }
    function renderSessionStatus(live){
        const status=$('.fury-session-status');if(!status)return;
        const text=live?`Recording · ${cards.duration(live.durationMs)}`:'No active session';
        status.classList.toggle('live',Boolean(live));if(status.lastElementChild.textContent!==text)status.lastElementChild.textContent=text;
    }
    // One open row is the selection; these helpers move it like a native list.
    let pendingSessionSelection='',cardViewer=null,deleteDialog=null;
    function adjacentRow(row,step){let next=step<0?row.previousElementSibling:row.nextElementSibling;while(next&&(!next.matches('.fury-session-row')||next.hidden))next=step<0?next.previousElementSibling:next.nextElementSibling;return next;}
    function stepSession(row,step,focusSummary=false){
        let next;
        if(step==='first'||step==='last'){const rows=[...row.parentElement.children].filter(item=>item.matches('.fury-session-row')&&!item.hidden);next=step==='first'?rows[0]:rows[rows.length-1];}
        else next=adjacentRow(row,step);
        if(!next||next===row)return;
        next.open=true;row.open=false;
        next.querySelector('summary').scrollIntoView({block:'nearest',behavior:document.documentElement.dataset.motion==='full'?'smooth':'auto'});
        next.querySelector('summary').focus({preventScroll:true});
    }
    function toggleSessionList(row){
        // One page-level state so Sessions and the day/week/month views agree.
        sessionsPage.classList.toggle('fury-list-hidden');
        if(!sessionsPage.classList.contains('fury-list-hidden'))row.querySelector('summary').scrollIntoView({block:'nearest'});
    }
    // Less frequent card actions, in a menu that behaves like the account menu.
    let cardMenu=null,cardMenuButton=null;
    function closeCardMenu(focusButton=false){
        if(!cardMenu)return;cardMenu.remove();cardMenu=null;cardMenuButton.setAttribute('aria-expanded','false');
        if(focusButton&&cardMenuButton.isConnected)cardMenuButton.focus({preventScroll:true});cardMenuButton=null;
    }
    function openCardMenu(anchor,row){
        const reopening=cardMenuButton===anchor;closeCardMenu();if(reopening)return;
        const hidden=sessionsPage.classList.contains('fury-list-hidden'),items=[
            [svg('expand'),'Full size','Space',()=>row.cardActions?.zoom()],
            [svg('sidebar'),hidden?'Show list':'Hide list','',()=>toggleSessionList(row)],
            ...(row.cardActions?.remove?[[svg('trash'),'Delete session…','Del',()=>row.cardActions.remove(),'fury-danger']]:[])
        ];
        cardMenu=node('div','fury-card-menu');cardMenu.setAttribute('role','menu');cardMenu.setAttribute('aria-label','More card actions');
        items.forEach(([icon,label,key,run,className],index)=>{
            if(className&&index)cardMenu.append(node('hr',''));
            const item=button(`${icon}<span>${label}</span>${key?`<kbd>${key}</kbd>`:''}`,()=>{closeCardMenu(!className);run();},className||'');item.setAttribute('role','menuitem');item.tabIndex=-1;cardMenu.append(item);
        });
        cardMenuButton=anchor;anchor.setAttribute('aria-expanded','true');document.body.append(cardMenu);
        const box=anchor.getBoundingClientRect();cardMenu.style.top=`${box.bottom+6}px`;cardMenu.style.right=`${document.documentElement.clientWidth-box.right}px`;
        cardMenu.querySelector('button').focus({preventScroll:true});
    }
    document.addEventListener('click',event=>{if(cardMenu&&!cardMenu.contains(event.target)&&!cardMenuButton.contains(event.target))closeCardMenu();});
    document.addEventListener('keydown',event=>{
        if(!cardMenu)return;const items=[...cardMenu.querySelectorAll('button')],index=items.indexOf(document.activeElement);
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeCardMenu(true);}
        else if(event.key==='Tab')closeCardMenu();
        else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next={ArrowDown:(index+1)%items.length,ArrowUp:(index-1+items.length)%items.length,Home:0,End:items.length-1}[event.key];items[next].focus();}
    },true);
    function openCardViewer(result,label){
        if(!result)return;
        if(!cardViewer){cardViewer=node('dialog','fury-card-viewer');cardViewer.addEventListener('click',()=>cardViewer.close());document.body.append(cardViewer);}
        const copy=document.createElement('canvas');copy.width=result.canvas.width;copy.height=result.canvas.height;copy.getContext('2d').drawImage(result.canvas,0,0);
        copy.setAttribute('role','img');copy.setAttribute('aria-label',result.canvas.getAttribute('aria-label')||label);
        cardViewer.replaceChildren(node('p','fury-card-viewer-title',`<strong>${escape(label)}</strong><span>Click or press Esc to close</span>`),copy);
        cardViewer.setAttribute('aria-label',`Full-size card: ${label}`);
        const opener=document.activeElement;cardViewer.onclose=()=>{if(opener?.isConnected)opener.focus({preventScroll:true});};
        cardViewer.showModal();
    }
    function confirmSessionDelete(session,row,account){
        if(!deleteDialog){
            deleteDialog=node('dialog','fury-confirm-dialog',`<form method="dialog"><span class="fury-confirm-icon">${svg('trash')}</span><h3 id="fury-delete-session-title">Delete this session?</h3><p id="fury-delete-session-detail"></p><div class="fury-confirm-actions"><button value="cancel">Cancel</button><button value="delete" class="fury-danger">Delete</button></div></form>`);
            deleteDialog.setAttribute('role','alertdialog');deleteDialog.setAttribute('aria-labelledby','fury-delete-session-title');deleteDialog.setAttribute('aria-describedby','fury-delete-session-detail');
            document.body.append(deleteDialog);
        }
        const day=new Date(session.startedAt).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
        deleteDialog.querySelector('p').innerHTML=`<b>${escape(sessionTitle(session))}</b> on ${escape(day)}, ${sessionTimeRange(session)}.<br>Its stats will be removed from Fury. This can't be undone.`;
        const opener=document.activeElement;deleteDialog.returnValue='';
        deleteDialog.onclose=async()=>{
            if(deleteDialog.returnValue!=='delete'){if(opener?.isConnected)opener.focus({preventScroll:true});return;}
            pendingSessionSelection=(adjacentRow(row,1)||adjacentRow(row,-1))?.dataset.sessionId||'';
            const result=await invoke('session:action',{type:'delete',sessionId:session.id,accountKey:account?.key});
            if(result?.ok){notify('Session deleted');await refresh();}else{pendingSessionSelection='';notify(result?.error||'Could not delete the session.');}
        };
        deleteDialog.showModal();deleteDialog.querySelector('[value="cancel"]').focus();
    }
    // Arrow keys move through the list; shortcuts act on the selected card.
    function handleSessionKeys(event){
        if(event.defaultPrevented||event.altKey||event.target.closest('input,select,textarea,dialog'))return;
        const shortcut=event.ctrlKey||event.metaKey,onSummary=event.target.matches('.fury-session-row > summary');
        const row=event.target.closest('.fury-session-row')||[...sessionsPage.querySelectorAll('.fury-session-row[open]')].find(item=>item.offsetParent);
        if(!row)return;
        if(onSummary&&!shortcut&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();stepSession(row,{ArrowDown:1,ArrowUp:-1,Home:'first',End:'last'}[event.key],true);return;}
        if(!row.open)return;
        const key=event.key.toLowerCase(),action=selector=>{const control=row.querySelector(selector);if(!control||control.disabled)return;event.preventDefault();control.click();};
        if(shortcut&&!event.shiftKey&&key==='c'&&!String(document.getSelection?.()||'').trim())action('.fury-card-copy,.fury-calendar-copy');
        else if(shortcut&&!event.shiftKey&&key==='s')action('.fury-card-save,.fury-calendar-save');
        else if(!shortcut&&!event.shiftKey&&event.key==='Delete'&&row.cardActions?.remove){event.preventDefault();row.cardActions.remove();}
        else if(!shortcut&&event.key===' '&&onSummary&&row.cardActions?.zoom){event.preventDefault();row.cardActions.zoom();}
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
    const pages = require('./launcher_redesign_pages').mount({ document, node, button, getState, openManager });
    const nicks = require('./launcher_redesign_nicks').mount({ document, node, button, escape });
    const nickroll = require('./launcher_nickroll').mount({ document, invoke, refresh });
    const refinedSettings = require('./launcher_settings_refinement').mount({document,node,button});
    const lobbySpam = require('./launcher_lobby_spam').mount({document,node,button,invoke,getState});
    const inGameAppearance = require('./launcher_ingame_appearance').mount({document});
    if(!document.documentElement.classList.contains('fury-design-a'))require('./launcher_segmented_controls').mount(document);
    const onboarding=require('./launcher_onboarding').mount({document,node,button,invoke,clipboard,navigate,getState,refresh,skin:avatar});
    function update(next){onboarding.update();renderAccounts();renderLogs();convertChecks();fitOverlay();pages.update(next);
        nicks.update(next);
        nickroll.update(next);
        lobbySpam.update(next);
        $('#proxy-start').hidden=Boolean(next.services?.proxy?.running);$('#proxy-stop').hidden=!next.services?.proxy?.running;
        const proxyRunning=Boolean(next.services?.proxy?.running);
        connectionStatus.textContent=proxyRunning?'Proxy running':'Proxy stopped';connectionStatus.classList.toggle('running',proxyRunning);
        services.querySelector('div').innerHTML=['Hypixel','Urchin','Aurora'].map(name=>`<button data-fury-api="${name.toLowerCase()}"><strong>${name}</strong><span class="${next.settings?.keys?.[name.toLowerCase()]?'good':''}"><i class="status-dot ${next.settings?.keys?.[name.toLowerCase()]?'good':''}"></i>${next.settings?.keys?.[name.toLowerCase()]?'Configured':'Not configured'}</span>${svg('chevron')}</button>`).join('');services.querySelectorAll('button').forEach(b=>b.onclick=()=>{navigate('settings');settingsPage('api',false);const card=$(`[data-api-card="${b.dataset.furyApi}"]`);if(card?.matches('details'))card.open=true;card?.scrollIntoView({block:'nearest'});});
        const latest=next.sessionHistory?.sessions?.[0],key=JSON.stringify([next.accountKey,next.viewedAccount?.key,next.viewedAccount?.name,latest?.id,latest?.durationMs]);
        if(!document.documentElement.classList.contains('fury-design-a')&&key!==recentKey){recentKey=key;recentTarget.innerHTML=latest?`<div class="fury-recent-identity"><span class="fury-recent-avatar">${avatar(next.viewedAccount,44)}</span><div><h3>${escape(latest.name)}</h3><p>Recent session</p></div></div><div class="fury-recent-meta"><span>Day<strong>${escape(cards.date(latest.startedAt))}</strong></span><span>Started<strong>${cards.time(latest.startedAt)}</strong></span><span>Finished<strong>${latest.active?'Live':cards.time(latest.endedAt||latest.lastSeen)}</strong></span><span>Duration<strong>${cards.duration(latest.durationMs)}</strong></span></div>`:`<div class="fury-empty-inline">${svg('sessions')}<div><strong>No sessions yet</strong><p>${next.viewedAccount?'Your next session for '+escape(next.viewedAccount.name)+' will appear here.':'Your first session will appear here after you connect.'}</p></div></div>`;if(latest)recentTarget.append(button('Open session <span aria-hidden="true">&#8250;</span>',()=>{navigate('sessions');setTimeout(()=>$('#session-history-list details')?.setAttribute('open',''),100);},'fury-gold-outline'));}
        $$('.fury-sidebar-options button').forEach(b=>b.classList.toggle('active',b.dataset.sidebarChoice===(document.documentElement.dataset.sidebarPreference||document.documentElement.dataset.sidebar)));
        refinedSettings.update();
        inGameAppearance.update();
    }
    return { update, flushNickroll: nickroll.flush, renderSessions, renderLogs, renderNicks:nicks.render, openManager, showIngame, clearAccount(){calendarView.clear();sessionsKey='';sessionsDay='';recentKey='';cardGeneration++;cardsById.clear();openSessionCards.clear();$('#session-history-list').replaceChildren();recentTarget.replaceChildren();pages.clearAccount();}, showSignIn:signIn };
}
module.exports={mount};
