'use strict';

// Move the existing functional controls into the approved page compositions.
// Their IDs and event handlers continue to own validation and persistence.
function mount({ document, node, button, getState, openManager, validateNetwork }) {
    const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
    const reminders=$('[data-page="reminders"]');
    const account=node('div','fury-reminder-account','<span class="fury-reminder-selected"></span>');
    account.append(button('Change account',openManager),$('#ender-dust-reminder-check'));
    reminders.querySelector('.page-title').append(account);
    const reminderInfo=$('#reminder-account-copy');reminderInfo.classList.remove('fury-removed');reminders.append(reminderInfo);
    for(const card of $$('.reminder-card')) {
        const header=card.querySelector('.reminder-card-head'),body=card.querySelector('.reminder-card-body');
        const options=node('div','fury-reminder-options');
        [...header.children].slice(1).forEach(child=>options.append(child));body.prepend(options);
        card.classList.add('fury-reminder-layout');
    }
    const dust=$('.reminder-dust-card .reminder-card-body'),reading=$('.reminder-reading');
    const dustGrid=node('div','fury-dust-grid');dust.querySelector('.fury-reminder-options').after(dustGrid);
    dustGrid.append(reading,$('.reminder-target-control'));
    const targetSlider=$('#ender-dust-reminder-threshold-slider')?.closest('.fc-slider-control');if(targetSlider)$('.reminder-target-control').append(targetSlider);
    reading.append(node('div','fury-progress','<i id="fury-dust-progress"></i>'));
    const george=$('.reminder-george-card .reminder-card-body');
    const progress=node('div','fury-george-progress','<div><span>Daily bet progress</span><strong id="fury-george-wins">Not checked</strong><div class="fury-progress"><i id="fury-george-progress"></i></div></div><div id="fury-george-state"></div>');
    george.querySelector('.fury-reminder-options').after(progress);

    const profiles=$('[data-page="profiles"]'),profileLayout=node('div','fury-profile-layout');
    profiles.querySelector('.page-title').after(profileLayout);
    const list=$('#profile-list'),create=$('.profile-create-panel');
    const savePanel=node('details','fury-profile-save','<summary>Save current setup</summary>');
    const review=node('aside','fury-profile-review');review.id='fury-profile-review';review.setAttribute('aria-label','Profile change preview');
    savePanel.append(create);profileLayout.append(list,review,savePanel);
    profiles.querySelector('.page-actions').append(button('Save current setup',()=>{savePanel.open=true;create.scrollIntoView({block:'nearest'});$('#profile-create-name').focus();},'fury-gold-outline'));
    $('#profile-active-summary').classList.add('fury-removed');

    const api=$('[data-settings-subpage="api"]'),apiList=node('div','fury-api-list');
    const apiCards=$$('.api-key-card');api.append(apiList);apiCards.forEach(card=>apiList.append(card));
    const admin=$('[data-api-card="urchinadmin"]'),urchin=$('[data-api-card="urchin"]');
    urchin.querySelector('.api-key-card-body').append(admin);admin.querySelector('strong').textContent='Admin key (advanced)';
    for(const card of apiCards) {
        const body=card.querySelector('.api-key-card-body'),input=card.querySelector('.api-key-input'),actions=card.querySelector('.api-key-actions');
        [...actions.children].filter(el=>!el.dataset.keyCopy).forEach(el=>input.append(el));actions.hidden=true;
        if(card.dataset.apiCard==='urchin')card.open=true;
    }
    api.querySelector('.api-service-workspace')?.classList.add('fury-removed');
    $$('.api-service-module').forEach(el=>el.classList.add('fury-removed'));

    const panel=(title,copy='')=>node('section','fury-settings-panel',`<h3>${title}</h3>${copy?`<p>${copy}</p>`:''}`);
    const choice=(id,title,copy='')=>{
        const input=document.getElementById(id),label=node('label','switch fury-chip','<span class="fury-check-box"></span>');
        input.hidden=false;input.removeAttribute('aria-hidden');input.setAttribute('aria-label',title);label.prepend(input);label.append(node('span','fury-chip-label',title));
        const wrap=node('div','fury-setting-choice');wrap.append(label);if(copy)wrap.append(node('p','',copy));return wrap;
    };
    const columns=key=>{const pane=$(`[data-settings-subpage="${key}"]`),layout=node('div','fury-settings-columns'),left=node('div','fury-settings-column'),right=node('div','fury-settings-column');layout.append(left,right);pane.append(layout);pane.querySelectorAll(':scope > .settings-subgroup').forEach(el=>el.classList.add('fury-removed'));return{pane,left,right};};
    const scanning=columns('scan');
    scanning.left.append($('.scan-mode-card'),$('.share-threshold-panel'));
    const share=$('.share-settings-module'),chatPreview=$('.party-chat-preview');scanning.right.append(share,$('.kill-switch-card'));
    const shareLayout=$('.share-settings-layout');shareLayout.querySelectorAll('.share-option-row').forEach(el=>share.append(el));share.append($('.share-include-panel'),chatPreview);shareLayout.classList.add('fury-removed');
    $('#share-settings-title').textContent='Share scan results';
    const include=$('.share-include-grid');include.querySelectorAll('.fury-chip').forEach(label=>{label.classList.add('fury-share-choice');});
    for(const [id,title] of [['share-tags-include-tagged','Tagged'],['share-tags-include-nicks','Nicked'],['share-tags-include-threats','Stat threats']]){const label=document.getElementById(id).closest('.fury-chip');label.querySelector('.fury-chip-label').textContent=title;include.append(label);}
    [...include.children].filter(el=>!el.matches('label')).forEach(el=>el.classList.add('fury-removed'));

    const sessionColumns=columns('sessions');
    sessionColumns.left.append($('.session-settings-module'),$('.session-recap-designer'),$('#replay-details-module'));
    const fields=panel('Session card appearance','Choose which stats appear on your session cards.'),fieldTabs=node('nav','fury-field-tabs');fields.append(fieldTabs);
    const fieldGrid=$('.session-history-field-grid');fields.append(fieldGrid);sessionColumns.right.append(fields);
    let cardMode='BEDWARS',cardPreviewKey='',cardPreviewGeneration=0;
    const fieldModes=[['BEDWARS','BedWars','session-bedwars-fields','sessionBedwarsFields'],['SKYWARS','SkyWars','session-skywars-fields','sessionSkywarsFields'],['DUELS','Duels','session-duels-fields','sessionDuelsFields']];
    function selectCardMode(mode){cardMode=mode;for(const [key,,id]of fieldModes)document.getElementById(id).parentElement.hidden=key!==mode;fieldTabs.querySelectorAll('button').forEach(b=>(b.classList.toggle('active',b.dataset.mode===mode),b.setAttribute('aria-pressed',String(b.dataset.mode===mode))));updateCardPreview(getState());}
    for(const [key,label]of fieldModes){const b=button(label,()=>selectCardMode(key));b.dataset.mode=key;fieldTabs.append(b);}
    const cardPreview=node('section','fury-session-preview-section','<h4>Session card preview</h4>'),cardImage=node('div','fury-settings-card-preview');cardPreview.append(cardImage);fields.append(cardPreview);fields.classList.add('fury-session-appearance');
    function clearCardPreview(){cardPreviewKey='';cardPreviewGeneration++;cardImage.replaceChildren();}
    function updateCardPreview(state){
        if(!state)return;const session=state.sessionHistory?.sessions?.find(s=>s.modes?.some(m=>m.mode===cardMode));
        const fieldContainer=document.getElementById(fieldModes.find(([key])=>key===cardMode)[2]);
        const selectedFields=[...fieldContainer.querySelectorAll('input:checked')].map(input=>input.value);
        if(!fieldContainer.querySelector('input[value="gamesByMode"]').checked)selectedFields.push('hideGamesByMode');
        const key=JSON.stringify([state.accountKey,session,cardMode,selectedFields]);if(key===cardPreviewKey)return;cardPreviewKey=key;const generation=++cardPreviewGeneration;cardImage.replaceChildren();
        if(!session){cardImage.textContent=`Your next ${fieldModes.find(([key])=>key===cardMode)[1]} session for ${state.viewedAccount?.name||'the selected account'} will appear here.`;return;}
        cardImage.textContent='Generating card…';require('./launcher_session_card').render(session,{mode:cardMode,fields:selectedFields,skinAccount:session.uuid?session:state.viewedAccount||session}).then(result=>{if(generation===cardPreviewGeneration){result.canvas.classList.add('fury-account-preview-enter');cardImage.replaceChildren(result.canvas);}},()=>{if(generation===cardPreviewGeneration)cardImage.textContent='Unable to generate this preview.';});
    }
    fieldGrid.addEventListener('change',()=>updateCardPreview(getState()));
    selectCardMode('BEDWARS');
    const recapStyle=$('#session-recap-style'),recapTabs=node('nav','fury-recap-tabs');recapStyle.after(recapTabs);recapStyle.hidden=true;
    function syncRecapTabs(){recapTabs.querySelectorAll('button').forEach(b=>{const active=b.dataset.style===recapStyle.value;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});}
    for(const option of recapStyle.options){const b=button(option.textContent,()=>{recapStyle.value=option.value;syncRecapTabs();recapStyle.dispatchEvent(new Event('change',{bubbles:true}));});b.dataset.style=option.value;recapTabs.append(b);}
    recapStyle.addEventListener('change',syncRecapTabs);

    const overlay=$('[data-settings-subpage="overlay"]'),overlayModule=$('.overlay-concept-module'),chatModule=$('.chat-stats-module');
    overlay.append(overlayModule);
    const triggers=panel('Chat triggers');triggers.append($('.feature-trigger-editor'));overlay.append(triggers,chatModule,$('#queue-time-settings'));
    overlay.querySelectorAll(':scope > .settings-subgroup').forEach(el=>el.classList.add('fury-removed'));
    $('.concept-module-hero h3').textContent='Use Overlay';
    const sources=$('.chat-stats-source-list'),sourcePanel=panel('Show stats for','Choose which lobby events trigger player stats.');sourcePanel.classList.add('fury-chat-sources');sourcePanel.append(sources);chatModule.append(sourcePanel);

    const network=$('[data-settings-subpage="network"]'),route=$('.network-studio'),endpoints=$('.network-endpoints-module'),health=$('.network-health-row');
    // Keep the monitor input in the hidden original form for internal use.
    network.querySelectorAll(':scope >.settings-subgroup').forEach(el=>el.classList.add('fury-removed'));
    const connections=node('div','fury-connections');network.append(connections);
    for(const [key,title] of [['direct','MAIN CONNECTION'],['failover','PROXY CONNECTION']]){
        const old=$(`[data-network-status="${key}"]`).closest('.network-endpoint-card');
        const card=node('details','fury-connection-card settings-search-item');card.open=true;
        const header=node('summary','fury-connection-heading');
        const icon=old.querySelector('.network-endpoint-head >span');icon.setAttribute('aria-hidden','true');
        const status=old.querySelector('[data-network-status]');status.setAttribute('aria-live','polite');
        header.append(icon,node('h3','',title),status,node('span','fury-connection-chevron','⌃'));
        const body=node('div','fury-connection-body'),fields=node('div','fury-connection-fields');
        for(const [suffix,caption] of [['port','Port number'],['host','Game server']]){
            const input=$(`#proxy-${key}-${suffix}`),label=node('label','');
            input.dataset.plainNumber='true';input.setAttribute('aria-label',`${title.toLowerCase()} ${caption.toLowerCase()}`);
            label.append(node('span','',caption),input);fields.append(label);
        }
        const check=button('Check settings',validateNetwork,'primary');check.setAttribute('aria-label',`Check ${title.toLowerCase()} settings`);fields.append(check);
        const address=node('p','fury-connection-address');
        const portInput=fields.querySelector('input');
        const syncAddress=()=>{address.textContent=`Minecraft address: localhost:${portInput.value}`;};
        portInput.addEventListener('input',syncAddress);
        const detail=old.querySelector('[data-network-detail]'),hostDetail=$(`[data-network-host-status="${key}"]`);
        for(const message of [detail,hostDetail]){message.hidden=true;message.setAttribute('role','status');}
        body.append(fields,address,detail,hostDetail);card.append(header,body);connections.append(card);syncAddress();
    }
    const alerts=node('section','fury-connection-alerts settings-search-item');
    const alertIcon=node('span','fury-connection-alert-icon','<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12h5l3-9 4 18 3-9h5"/></svg>');
    const copy=node('div','','<h3>SLOWDOWN ALERTS</h3><p>Warn about lag and briefly pause extra features.</p>');
    health.querySelector('input').setAttribute('aria-label','Slowdown alerts');
    alerts.append(alertIcon,copy,health.querySelector('.feature-toggle'));connections.append(alerts);
    const networkFooter=node('div','fury-connection-footer');
    const actions=node('div','fury-connection-actions');
    $('#network-copy-config').textContent='Copy settings';$('#network-safe-defaults').textContent='Reset to defaults';
    $('#save-settings').hidden=true;
    const restart=button('Restart proxy',async()=>{
        restart.disabled=true;
        document.dispatchEvent(new CustomEvent('settings-restart-request'));
    },'primary');restart.id='connection-restart';restart.hidden=true;
    actions.append($('#network-copy-config'),$('#network-safe-defaults'),restart);
    const saveNote=node('span','','Connection changes save automatically.');saveNote.id='connection-save-status';saveNote.setAttribute('role','status');
    networkFooter.append(saveNote,actions);connections.append(networkFooter);
    const summary=$('#network-validation-summary');summary.hidden=true;summary.setAttribute('role','status');connections.append(summary);
    const category=$('[data-settings-category="network"] strong')||$('[data-settings-subpage-button="network"] strong');if(category)category.textContent='Connection settings';


    // Keep the existing tab-list editor and drag handlers, with controls on the
    // left and the live Minecraft preview in the matching right column.
    const tabControls=$('.tablist-editor-controls');tabControls.prepend($('.tablist-master'));
    const available=$('#tablist-field-palette').closest('.tablist-field-section'),availableDrawer=node('details','fury-tablist-available','<summary>+ Add stat</summary>');available.before(availableDrawer);availableDrawer.append(available);
    tabControls.append(availableDrawer);const modeToolbar=$('.tablist-preview-toolbar');$('.tablist-control-row').after(modeToolbar,choice('show-tags-in-tabstats','Show tags','Display player tags in the in-game tab list.'));
    const tabPreview=$('.tablist-preview-shell');tabPreview.append(button('Open nametag designer',()=>$('.fury-ingame-tabs button[data-ingame="nametags"]').click(),'fury-gold-outline'));
    const display=$('[data-settings-subpage="display"]');display.querySelectorAll(':scope >.settings-subgroup:not(.fury-ingame-pane)').forEach(el=>{if(!el.querySelector('input,select'))el.classList.add('fury-removed');});
    const colorSettings=$('.bedwars-event-accent-card'),eventPreview=$('.fury-event-preview'),colorPanel=node('div','fury-colors-panel');colorSettings.before(colorPanel);colorPanel.append(colorSettings,eventPreview);
    eventPreview.querySelectorAll(':scope >div').forEach(row=>{const text=node('p','','<span>[BedWars]</span> PlayerOne was killed by ExamplePlayer. ');text.append(row.querySelector('strong'));row.append(text);});

    // Compact automation: option chips, one threshold row.
    const automation=$('[data-settings-subpage="gameplay"]'),dodge=$('.auto-dodge-module');
    const first=automation.querySelector('.feature-section-title');first.querySelector('h2').textContent='Automation';first.after(dodge);
    const choices=$('.auto-dodge-choice-grid');
    const triggerOptions=node('div','fury-dodge-options');choices.before(triggerOptions);
    choices.querySelectorAll('.fury-chip').forEach(label=>triggerOptions.append(label));choices.classList.add('fury-removed');
    const timing=$('.auto-dodge-timing-layout'),thresholds=$('.auto-dodge-threshold-grid'),thresholdRow=node('div','fury-dodge-thresholds');
    $('.auto-dodge-body').append(thresholdRow);[...thresholds.children].forEach(el=>thresholdRow.append(el));
    if(timing) [...timing.children].forEach(el=>thresholdRow.append(el));
    $$('.auto-dodge-section-heading').forEach(el=>el.classList.add('fury-removed'));
    // Keep the original provider/status/detection controls in their own panels.
    const nickname=$('[data-settings-subpage="denick"]');
    for(const [id,text] of [['show-denicked-real-ign','Visible to you'],['denick-party-announce-enabled','Visible to party']]) {
        const badge=document.getElementById(id)?.closest('.denick-output-card')?.querySelector('.denick-card-kicker');if(badge){badge.classList.add('fury-visibility');badge.textContent=text;}
    }
    return { update(state) {
        document.dispatchEvent(new CustomEvent('settings-status-refresh'));
        updateCardPreview(state);recapTabs.querySelectorAll('button').forEach(b=>{b.classList.toggle('active',b.dataset.style===recapStyle.value);b.setAttribute('aria-pressed',String(b.dataset.style===recapStyle.value));});
        const selected=state.viewedAccount;account.querySelector('.fury-reminder-selected').textContent=selected?`Status for ${selected.name}`:'Choose an account';
        const dust=state.reminders?.enderDust,amount=Number(dust?.enderDust);$('#fury-dust-progress').style.width=`${dust?.enderDust==null?0:Math.min(100,amount/300*100)}%`;
        const bet=state.reminders?.gamblerGeorge;$('#fury-george-wins').textContent=bet?.known?`${bet.wins||0} / ${bet.requiredWins||2} wins`:'Not checked';$('#fury-george-progress').style.width=`${bet?.known?Math.min(100,(bet.wins||0)/(bet.requiredWins||2)*100):0}%`;
        const status=$('#fury-george-state');status.textContent=bet?.claimReady?'✓  Ready to claim':bet?.active?'Bet in progress':bet?.known?'Waiting for a new bet':'No saved progress for this account';status.classList.toggle('ready',Boolean(bet?.claimReady));
    }, clearAccount:clearCardPreview };
}
module.exports={mount};
