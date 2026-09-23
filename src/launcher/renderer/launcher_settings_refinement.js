'use strict';

// A shared control system and roomier layouts; existing inputs keep their IDs,
// values, validation, keyboard behavior and persistence listeners.
function mount({document,node,button}){
    const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
    document.documentElement.classList.add('fury-settings-roomy');
    const style=node('link','');style.rel='stylesheet';style.href='src/launcher/styles/launcher_settings_refinement.css';document.head.append(style);
    // Match the visible stop square to the status dot, so the label itself and
    // the complete group share the button center; remove the old SVG gutter.
    $('#proxy-stop >svg').setAttribute('viewBox','6 6 8 8');
    $('#proxy-start >svg').setAttribute('viewBox','6 3 11 14');
    const sidebarChoices=node('div','fury-sidebar-choice-buttons');
    $$('.fury-sidebar-options >button').forEach(control=>sidebarChoices.append(control));
    $('.fury-sidebar-options').append(sidebarChoices);
    const check='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 10.2 3.3 3.3 7.7-7.8"/></svg>';
    const names={launcher:'Appearance',scan:'Scanning & sharing',gameplay:'Automation',sessions:'Sessions & recaps',denick:'Nicknames',overlay:'Overlay & chat',display:'In-game appearance',api:'API keys',network:'Connection settings'};
    for(const [key,title] of Object.entries(names)){
        const pane=$(`[data-settings-subpage="${key}"]`),old=pane.querySelector(':scope >.feature-section-title,:scope >.settings-pane-heading');
        const heading=node('header','fury-category-heading'),copy=node('div','',`<h2>${title}</h2>`);
        const icon=$(`[data-settings-category="${key}"] .settings-category-icon`)||$(`[data-settings-subpage-button="${key}"] .settings-category-icon`);
        if(icon){const art=icon.cloneNode(true);art.className='fury-category-icon';heading.append(art);}
        const description=old?.querySelector('.note,.setting-description');if(description)copy.append(description);
        heading.append(copy);old?.classList.add('fury-removed');pane.prepend(heading);
    }
    // Scanning gets a full-width sequence of deliberate, related groups.
    const scan=$('[data-settings-subpage="scan"]'),oldScan=$('[data-settings-subpage="scan"] .fury-settings-columns');
    const flow=node('div','fury-scan-flow'),mode=$('.scan-mode-card');
    flow.append(mode,$('.share-threshold-panel'));
    const sharing=$('.share-settings-module'),preferences=node('div','fury-share-preferences'),preview=node('div','fury-share-preview'),shareBody=node('div','fury-share-body');
    sharing.querySelectorAll(':scope >.share-option-row').forEach(row=>preferences.append(row));
    preview.append($('.share-include-panel'),$('.party-chat-preview'));shareBody.append(preferences,preview);sharing.append(shareBody);
    flow.append(sharing,$('.kill-switch-card'));scan.append(flow);oldScan.classList.add('fury-removed');
    // Session controls follow their workflow instead of two long narrow columns.
    const session=$('[data-settings-subpage="sessions"]'),oldSession=session.querySelector('.fury-settings-columns'),sessionFlow=node('div','fury-session-settings-flow');
    const original=[...oldSession.querySelectorAll(':scope >.fury-settings-column >*')];
    original.forEach(item=>sessionFlow.append(item));session.append(sessionFlow);oldSession.classList.add('fury-removed');

    // Regroup existing labels without replacing their inputs or save listeners.
    for(const container of $$('.session-history-field-grid .session-field-chips')){
        const groups=[['Results',['wins','losses','games']],['Combat',['finals','finalDeaths','beds','bedsLost','kills','deaths','assists']],['Ratios',['wlr','fkdr','kdr','bblr']],['Progress',['stars']],['Chart',['gamesByMode']]];
        const labels=[...container.querySelectorAll('label')];
        for(const [title,keys] of groups){
            const selected=keys.map(key=>labels.find(label=>label.querySelector('input').value===key)).filter(Boolean);
            if(!selected.length)continue;
            const row=node('div','fury-session-stat-group'),heading=node('span','fury-session-stat-heading',title),choices=node('div','fury-session-stat-choices');
            row.setAttribute('role','group');row.setAttribute('aria-label',title);
            choices.append(...selected);row.append(heading,choices);container.append(row);
        }
        container.querySelectorAll('input[value="finals"]').forEach(input=>{const caption=input.closest('label').querySelector('.fury-chip-label');if(caption)caption.textContent='Final kills';});
    }
    const previewLabel=$('.session-recap-preview-shell >.eyebrow');
    previewLabel.textContent='Chat preview';previewLabel.className='fury-session-preview-label';

    function syncQueueTime(){
        $('#queue-time-party-chat-enabled').disabled=!$('#queue-time-enabled').checked;
    }
    $('#queue-time-enabled').addEventListener('change',syncQueueTime);
    syncQueueTime();
    const numbers=[];
    function upgradeNumbers(){
    $$('input[type="number"]').filter(input=>!input.dataset.plainNumber&&!input.closest('.fury-number-control')).forEach(input=>{
        const label=input.closest('label'),name=input.getAttribute('aria-label')||input.dataset.notificationLabel||label?.querySelector('span')?.textContent||input.id;
        const wrap=node('div','fury-number-control');input.before(wrap);
        const change=direction=>event=>{
            event.preventDefault();if(input.disabled)return;const previous=input.value;
            if(input.value==='')input.value=input.min||'0';
            try{direction>0?input.stepUp():input.stepDown();}catch{return;}
            if(input.value!==previous){input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}
            sync();
        };
        const minus=button('<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10"/></svg>',change(-1)),plus=button('<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10M10 5v10"/></svg>',change(1));
        minus.setAttribute('aria-label',`Decrease ${name}`);plus.setAttribute('aria-label',`Increase ${name}`);wrap.append(minus,input,plus);
        function sync(){minus.disabled=input.disabled||(input.min!==''&&Number(input.value)<=Number(input.min));plus.disabled=input.disabled||(input.max!==''&&Number(input.value)>=Number(input.max));wrap.classList.toggle('disabled',input.disabled);}
        input.addEventListener('input',sync);input.addEventListener('change',sync);numbers.push(sync);sync();
    });
    }
    upgradeNumbers();
    // Reuse the five original inputs so loading, saving and dependencies stay intact.
    const nicknameModule=$('.denick-settings-module');
    const nicknameHeading=$('[data-settings-subpage="denick"] .fury-category-heading');
    nicknameHeading.querySelector('h2').textContent='Nickname detection';
    nicknameHeading.querySelector('.note')?.remove();
    const nicknameSections=[
        ['denick-detection-title','Identify players using',[
            ['auto-skin-denick-enabled','Skin','Only works when player is using his real skin while nicked'],
            ['auto-stats-denick-enabled','Bedwars Stats','Only works when player has kill messages including finals and bed counters']
        ]],
        ['denick-results-title','Show real names in',[
            ['show-denicked-real-ign','Overlay & Tab Stats','Only visible to you'],
            ['denick-chat-announcements-enabled','Announce in chat','Only visible to you'],
            ['denick-party-announce-enabled','Announce in party','Sends party chat message']
        ]]
    ];
    const nicknameGroups=nicknameSections.map(([id,title,settings])=>{
        const section=node('section','fury-nickname-section');
        section.setAttribute('aria-labelledby',id);
        const heading=node('h3','');heading.id=id;heading.textContent=title;
        const rows=node('div','fury-nickname-rows');
        for(const [inputId,title,description] of settings){
            const input=document.getElementById(inputId),label=input.closest('label');
            const row=node('div','fury-nickname-row settings-search-item');
            const copy=node('div','fury-nickname-copy'),name=node('h4','');
            name.textContent=title;copy.append(name);
            if(description){const note=node('small','');note.textContent=description;copy.append(note);}
            input.setAttribute('aria-label',title);input.dataset.notificationLabel=title;
            label.className='switch fury-chip';
            label.querySelector('.fury-chip-label').textContent='Enabled';
            const toggle=node('div','feature-toggle');toggle.append(label);
            row.append(copy,toggle);rows.append(row);
        }
        section.append(heading,rows);return section;
    });
    nicknameModule.classList.add('fury-nickname-settings');
    nicknameHeading.querySelector('h2').id='denick-settings-title';
    nicknameModule.replaceChildren(...nicknameGroups);
    // Overlay & chat uses the same text-led groups; retain every live input.
    const overlayPage=$('[data-settings-subpage="overlay"]');
    const oldOverlayModules=[...overlayPage.children].filter(el=>!el.classList.contains('fury-category-heading'));
    const overlayFlow=node('div','fury-overlay-settings');
    function overlaySection(title){
        const section=node('section','fury-overlay-section');
        const heading=node('h3','');heading.textContent=title;
        const panel=node('div','fury-overlay-panel');section.append(heading,panel);overlayFlow.append(section);return panel;
    }
    function overlayRow(panel,id,title,description,titleId){
        const input=document.getElementById(id),label=input.closest('label');
        label.className='switch fury-chip';label.querySelector('.fury-chip-label').textContent='Enabled';
        input.setAttribute('aria-label',title);input.dataset.notificationLabel=title;
        const row=node('div','fury-overlay-row settings-search-item'),copy=node('div','fury-overlay-copy'),name=node('h4','');
        name.textContent=title;if(titleId)name.id=titleId;copy.append(name);
        if(description){const note=node('small','');note.textContent=description;copy.append(note);}
        const toggle=node('div','feature-toggle');toggle.append(label);row.append(copy,toggle);panel.append(row);return row;
    }
    const overlayPanel=overlaySection('Overlay');overlayPanel.classList.add('overlay-concept-module');
    overlayRow(overlayPanel,'social-overlay-adds-enabled','Use Overlay','Add players from mentions, direct messages, and party invites.','overlay-sources-title');
    const triggerPanel=overlaySection('Chat triggers');triggerPanel.classList.add('fury-phrase-editor');
    const triggerHelp=node('p','');triggerHelp.textContent='Add senders to Overlay when their message contains a phrase.';
    const triggerInput=$('#chat-trigger-input');triggerInput.placeholder='Add a phrase…';triggerInput.setAttribute('aria-label','Chat trigger phrase');
    triggerPanel.append(triggerHelp,triggerInput.closest('.feature-trigger-input'),$('#chat-trigger-list'));
    const statsPanel=overlaySection('Player stats in chat');
    overlayRow(statsPanel,'pregame-chat-stats-enabled','Pregame lobby','BedWars waiting rooms');
    overlayRow(statsPanel,'lobby-chat-stats-enabled','Lobby stats','Only visible to you');
    const sourceHeading=node('div','fury-message-types-title');sourceHeading.textContent='Lobby message types';
    const sources=node('div','fury-message-types');sources.setAttribute('role','group');sources.setAttribute('aria-label','Lobby message types');
    for(const [id,title] of [['lobby-chat-stats-mention-enabled','Mentions'],['lobby-chat-stats-dm-enabled','Direct messages'],['lobby-chat-stats-trigger-enabled','Chat triggers']]){
        const input=document.getElementById(id),label=input.closest('label'),choice=node('div','fury-message-type');
        label.className='switch fury-chip';label.querySelector('.fury-chip-label').textContent=title;
        input.setAttribute('aria-label',title);input.dataset.notificationLabel=title;choice.append(label);
        if(id==='lobby-chat-stats-trigger-enabled'){const note=node('small','');note.textContent='Uses the phrases above.';choice.append(note);}
        sources.append(choice);
    }
    statsPanel.append(sourceHeading,sources);
    const queuePanel=overlaySection('Queue time');queuePanel.id='queue-time-settings';
    overlayRow(queuePanel,'queue-time-enabled','Show queue time','Show folds and queue time when a game starts.').classList.add('queue-time-row');
    overlayRow(queuePanel,'queue-time-party-chat-enabled','Send to party chat','Off: only visible to you').classList.add('queue-time-row');
    // Hidden compatibility flags remain available to existing form collection.
    oldOverlayModules.forEach(el=>{el.querySelectorAll('input[type="checkbox"][hidden]').forEach(input=>overlayPage.append(input));el.remove();});
    overlayPage.append(overlayFlow);
    function upgradeChoices(){
        // Plain filter labels (including Incomplete only) use the same chip.
        $$('label:not(.switch):not(.fury-chip)').forEach(label=>{
            const input=label.querySelector(':scope >input[type="checkbox"]');
            if(!input||input.hidden||label.querySelector('h3,h4,button,select'))return;
            const caption=node('span','fury-chip-label');
            [...label.childNodes].filter(child=>child!==input).forEach(child=>caption.append(child));
            label.classList.add('fury-chip');
            label.append(node('span','fury-check-box'),caption);
        });
        $$('.fury-chip').forEach(label=>{
            if(label.dataset.refined)return;label.dataset.refined='1';
            const input=label.querySelector('input[type="checkbox"]');if(!input)return;
            const box=label.querySelector('.fury-check-box');if(box){box.innerHTML=check;box.setAttribute('aria-hidden','true');}
            const card=label.closest('.fc-choice-card');
            if(card){
                card.classList.add('fury-option-card');label.classList.add('fury-overlay-choice');
                const title=card.querySelector('h3,h4,strong')?.textContent.trim()||input.getAttribute('aria-label')||'';
                const originalIcon=card.querySelector('.auto-dodge-choice-icon,.share-include-icon,.denick-method-icon,.chat-stats-source-icon');
                const icon=node('span','fury-toggle-icon');icon.setAttribute('aria-hidden','true');
                if(originalIcon)icon.innerHTML=originalIcon.innerHTML;
                else icon.innerHTML='<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="m8 12 3 3 5-6"/></svg>';
                if(input.id==='lobby-chat-stats-trigger-enabled')icon.innerHTML='<svg viewBox="0 0 24 24"><path d="m13 2-9 12h7l-1 8 10-13h-7z"/></svg>';
                const caption=node('span','fury-toggle-title');caption.textContent=title;
                [...card.children].forEach(child=>child.classList.add('fury-toggle-legacy'));
                label.classList.remove('fury-toggle-legacy');card.append(icon,caption,label);
                input.setAttribute('aria-label',title);
            }
            else if(label.querySelector('.fury-chip-label')?.textContent.trim()==='Enabled'){
                label.classList.add('fury-binary-choice');
                label.append(node('span','fury-binary-off','Off'),node('span','fury-binary-on','On'));
                label.querySelector('.fury-binary-off').dataset.checked='false';label.querySelector('.fury-binary-on').dataset.checked='true';
                label.addEventListener('click',event=>{
                    const segment=event.target.closest('[data-checked]');if(!segment)return;event.preventDefault();
                    if(!input.disabled&&input.checked!==(segment.dataset.checked==='true'))input.click();
                });
            }else label.classList.add('fury-choice-tile');
        });
    }
    upgradeChoices();new MutationObserver(()=>{upgradeChoices();upgradeNumbers();}).observe(document.body,{childList:true,subtree:true});
    return{update(){upgradeChoices();upgradeNumbers();syncQueueTime();numbers.forEach(sync=>sync());}};
}
module.exports={mount};
