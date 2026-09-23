'use strict';

// Presentation only: retain the launcher's original inputs and save handlers.
const colors = require('../../stats/colors');
const {closestLegacyChatColor} = require('../../../features/minecraft_chat');
const {formatBedwarsPrestige,formatSkyWarsLevel} = require('../../stats/format');
const palette = {0:'#000000',1:'#0000aa',2:'#00aa00',3:'#00aaaa',4:'#aa0000',5:'#aa00aa',6:'#ffaa00',7:'#aaaaaa',8:'#555555',9:'#5555ff',a:'#55ff55',b:'#55ffff',c:'#ff5555',d:'#ff55ff',e:'#ffff55',f:'#ffffff'};
const mc = (text, color='f') => `<span style="color:${palette[color] || color}">${text}</span>`;
const formatted = text => {
    let color='f';
    return text.split(/(§[0-9a-f])/i).map(part=>{
        if(/^§[0-9a-f]$/i.test(part)){color=part[1].toLowerCase();return '';}
        return part?mc(part,color):'';
    }).join('');
};
const statColor = (field, value) => {
    if (field==='finals') return 'b';
    if (field==='wins') return 'a';
    if (field==='ping') return '7';
    const fn = /fkdr$/.test(field) ? colors.getFkdrColor : ({kdr:colors.getKdrColor,wlr:colors.getWlrColor,ws:colors.getWsColor})[field];
    return fn ? fn(parseFloat(value)).slice(-1) : 'e';
};
const samples = [
    {name:'DemoPlayer_',team:'b',letter:'A',stars:24,fkdr:'1.98',ws:'0'},
    {name:'SecondSample',team:'9',letter:'B',stars:16,fkdr:'0.04',ws:'1'},
    {name:'ThirdSample7',team:'a',letter:'G',stars:11,fkdr:'0.18',ws:'0'},
    {name:'AlisonSmith',team:'c',letter:'R',stars:1347,fkdr:'7.44',ws:'0',tags:'CF'},
    {name:'oFourthDemo',team:'e',letter:'Y',stars:168,fkdr:'1.60',ws:'0'}
].map((p,i)=>({...p,kdr:['2.08','0.71','1.72','8.42','3.15'][i],wlr:['1.21','0.38','0.96','3.82','1.82'][i],dailyfkdr:'2.61',weeklyfkdr:'3.44',monthlyfkdr:'3.09',finals:'4120',wins:'945',guild:i===3?'FURY':'',ping:`${42+i*12}ms`}));

function renderTab({document,layout,mode,style,enabled}) {
    const target=document.getElementById('tablist-preview-rows');
    const compact={fkdr:'F',dailyfkdr:'D.F',weeklyfkdr:'W.F',monthlyfkdr:'M.F',kdr:'K',wlr:'W',finals:'FK',wins:'WIN',ws:'WS',ping:'P'};
    const full={...compact,fkdr:'FKDR',dailyfkdr:'DAILY FKDR',weeklyfkdr:'WEEKLY FKDR',monthlyfkdr:'MONTHLY FKDR',kdr:'KDR',wlr:'WLR',finals:'FINALS',wins:'WINS',ping:'PING'};
    const fields=enabled?layout:['name'];
    const attached=fields[0]==='name' && fields[1]==='stars';
    // Count the same padded identity and separators as the runtime's 88-character
    // budget. These are fixture-only calculations; no DOM measurements or runtime work.
    const stars=samples.map((p,i)=>mode==='SKYWARS'?formatSkyWarsLevel({level:8+i*3}):formatBedwarsPrestige(p.stars));
    const plain=text=>text.replace(/§[0-9a-fk-or]/gi,'');
    const width=text=>plain(text).split('').reduce((sum,c)=>sum+(c===' '?4:'!.,:;i|'.includes(c)?2:"'`l".includes(c)?3:'[](){}tfI'.includes(c)?4:'"*<>'.includes(c)?5:6),0);
    const identities=samples.map((p,i)=>`${mode==='BEDWARS'?p.letter+' ':''}${p.name}${attached?' '+plain(stars[i]):''}`);
    const identityWidth=Math.max(138,...identities.map(width));
    target.innerHTML=samples.map((p,i)=>{
        const star=formatted(stars[i]);
        const parts=fields.map(field=>{
            let value='';
            if(field==='name')value=`<span class="ia-tab-team-prefix">${mc(p.letter,p.team)}</span>${mc(p.name,p.team)}`+(attached?`<span class="ia-tab-prestige">${star}</span>`:'');
            else if(field==='stars')value=attached?'':star;
            else if(field==='tags')value=p.tags?mc(p.tags,'d'):'';
            else if(field==='guild')value=p.guild?mc(`[${p.guild}]`,'b'):'';
            else value=(style==='value'?'':mc(`${(style==='full'?full:compact)[field]}: `))+mc(p[field],statColor(field,p[field]));
            const text=field==='name'?identities[i]+' '.repeat(Math.max(0,Math.ceil((identityWidth-width(identities[i]))/4))):field==='stars'?plain(stars[i]):field==='tags'?(p.tags||''):field==='guild'?`[${p.guild}]`:(style==='value'?'':`${(style==='full'?full:compact)[field]}: `)+p[field];
            return value?{field,text,html:`<span class="ia-tab-field" data-preview-field="${field}">${value}</span>`}:null;
        }).filter(Boolean);
        while(parts.length>1&&parts.map(part=>part.text).join(' | ').length>88){
            const removable=parts.map(part=>part.field).lastIndexOf('name')===parts.length-1?parts.length-2:parts.length-1;
            parts.splice(Math.max(0,removable),1);
        }
        return `<div class="ia-tab-row" style="--team:${palette[p.team]}"><span class="ia-sample-head ia-head-${i}" aria-hidden="true"></span><span class="ia-tab-fields">${parts.map(part=>part.html).join('<span class="ia-tab-divider"> | </span>')}</span><span class="ia-health">20</span></div>`;
    }).join('');
    const title=document.getElementById('tablist-preview-title');
    title.innerHTML=`${mc('You are playing on ','b')}${mc('MC.HYPIXEL.NET','e')}`;
}

function mount({document}) {
    const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
    const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;};
    const sheet=el('link');sheet.rel='stylesheet';sheet.href='src/launcher/styles/launcher_ingame_appearance.css';document.head.append(sheet);
    const page=$('[data-settings-subpage="display"]');page.classList.add('ia-page');
    const rename=(selector,text)=>{const e=$(selector);if(e)e.textContent=text;};
    const binary=(id,title)=>{
        const input=document.getElementById(id), label=input.closest('label');
        label.className='switch fury-chip fury-binary-choice';label.dataset.refined='1';
        [...label.children].filter(e=>e!==input).forEach(e=>e.remove());
        const off=el('span','fury-binary-off','Off'),on=el('span','fury-binary-on','On');
        label.append(off,on);input.setAttribute('aria-label',title);
        label.addEventListener('click',event=>{
            if(event.target===input)return;
            event.preventDefault();const checked=event.target.closest('.fury-binary-off')?false:event.target.closest('.fury-binary-on')?true:!input.checked;
            if(!input.disabled && checked!==input.checked)input.click();
        });
        return label;
    };
    const row=(title,id,description)=>{const r=el('div','ia-setting-row'),copy=el('div');copy.append(el('h3','',title));if(description)copy.append(el('p','',description));r.append(copy,binary(id,title));return r;};
    const master=$('.tablist-master');master.replaceChildren(row('Tab stats','tab-stats-enabled'));
    $('.tablist-designer').prepend(master);
    const tagsInput=$('#show-tags-in-tabstats');
    tagsInput.checked=true;tagsInput.hidden=true;
    const tagsRow=tagsInput.closest('.fury-setting-choice,.feature-card');
    $('.tablist-designer').prepend(tagsInput);tagsRow?.remove();
    $$('.tablist-preview-shell >button').forEach(e=>e.remove());
    const editor=$('.tablist-editor-controls'), shell=$('#tablist-preview-shell');
    editor.prepend($('.tablist-mode-switch'));
    const presetLabel=$('#tab-stats-preset').closest('label');
    const presetSelect=$('#tab-stats-preset');presetLabel.replaceChildren(document.createTextNode('Preset'),presetSelect);
    $('.tablist-preview-toolbar').hidden=true;
    shell.prepend(el('h3','ia-section-title','Live preview'));
    $('.minecraft-tablist-subtitle').hidden=true;
    $('.minecraft-tablist-footer').innerHTML=`${mc('Kills: ','b')}${mc('0','e')} ${mc('Final Kills: ','b')}${mc('0','e')} ${mc('Beds Broken: ','b')}${mc('0','e')}<br>${mc('Ranks, Boosters & MORE! ','a')}${mc('STORE.HYPIXEL.NET','c')}`;
    const available=$('#tablist-field-palette').closest('.tablist-field-section'),order=$('#tablist-order-list').closest('.tablist-field-section');
    const details=el('details','ia-add-fields');details.append(el('summary','','＋ Add field'),$('#tablist-field-palette'));available.replaceWith(details);editor.append(details);
    $('.fury-tablist-available')?.remove();
    order.querySelector('strong').textContent='Field order';order.querySelector('small').textContent='Drag to reorder';
    $('.tablist-editor-hint').textContent='Each game mode keeps its own layout.';
    const decorateOrder=()=>$$('#tablist-order-list .tablist-order-item').forEach(item=>{
        if(item.querySelector('.ia-remove-field')||item.dataset.tablistOrderField==='name')return;
        const remove=el('button','ia-remove-field','×');remove.type='button';remove.setAttribute('aria-label',`Remove ${item.querySelector('.tablist-order-label').textContent}`);
        remove.addEventListener('pointerdown',e=>e.stopPropagation());
        remove.addEventListener('click',e=>{e.stopPropagation();$(`[data-tablist-field="${item.dataset.tablistOrderField}"]`).click();});item.append(remove);
    });
    new MutationObserver(decorateOrder).observe($('#tablist-order-list'),{childList:true});decorateOrder();

    const world=$('.world-label-designer'), controls=$('.fury-nametag-controls'), stage=$('#nametag-preview-stage');
    const worldMaster=$('.world-label-master');worldMaster.replaceChildren(row('Custom nametags','nametag-overlay-enabled'));world.before(worldMaster);
    const starCard=$('#nametag-star-brackets-enabled').closest('.feature-card');starCard.replaceChildren(row('Star brackets','nametag-star-brackets-enabled'));
    const tagCard=$('#nametag-tag-display-mode').closest('.feature-card');tagCard.querySelector('h3').textContent='Tag display';tagCard.querySelector('.note')?.remove();
    $$('#nametag-tag-display-mode option').forEach(o=>o.textContent=o.value==='acronyms'?'Acronyms':'Full text');
    const header=$('.fury-nametag-preview-header');const tabs=header.querySelector('div');tabs.classList.add('ia-audience-tabs');
    const group=el('section','ia-player-groups');group.append(el('h3','ia-section-title','Player groups'),tabs);
    controls.append(group);
    $$('.nametag-audience-card').forEach(card=>{
        const key=card.dataset.nametagAudience;card.querySelector('.nametag-audience-head').replaceChildren(row(`Custom nametags for ${key}`,`nametag-${key}-enabled`));
        card.querySelectorAll('.nametag-fallback-slot').forEach(label=>{[...label.childNodes].filter(n=>n.nodeType===3).forEach(n=>n.textContent='If unavailable, use');});
        group.append(card);
    });
    header.replaceChildren(el('strong','','Live preview'));
    stage.classList.add('ia-night-preview');
    rename('#nametag-preview-primary','Stats available');rename('#nametag-preview-fallback','Stats unavailable');
    rename('.nametag-preview-mode >span','Preview data');

    const names=$('.fury-ingame-pane[data-ingame="colors"]');const identity=el('section','ia-identity');identity.append(el('h3','ia-section-title','Real identity'));
    const identityPanel=el('div','ia-panel');
    for(const [id,title] of [['denick-real-ign-nametags','Show real in-game name'],['denick-real-skin','Show real skin'],['denick-real-ign-chat','Show real name in chat']]) identityPanel.append(row(title,id));
    identity.append(identityPanel,el('p','ia-note','For players identified by nickname detection.'));
    const event=el('section','ia-preview-setting'),score=el('section','ia-preview-setting');
    event.append(row('BedWars event text color','accent-bedwars-event-labels-enabled','Use the closest Minecraft color to your accent.'));
    score.append(row('Enhanced scoreboard','bedwars-sidebar-team-colors-enabled','Color-coded BedWars teams.'));
    const chat=el('div','ia-live-panel'),board=el('div','ia-live-panel');chat.append(el('h3','ia-section-title','Live preview'));board.append(el('h3','ia-section-title','Live preview'));
    const caption=el('div','ia-accent-caption');caption.append(el('span','','Uses launcher accent'),el('i','ia-accent-swatch'));chat.append(caption);
    const chatSample=el('div','ia-chat-sample');chatSample.innerHTML=`<div><b class="ia-event-label ia-bed-label">BED DESTRUCTION</b> ${mc('>')} ${mc('Blue Bed','9')} ${mc('was bed ','7')}${mc('#10,186','e')} ${mc('destroyed by','7')} ${mc('JonathanArntzen!','a')}</div><div>${mc('Zayn_malik69','8')} ${mc('was killed by','7')} ${mc('ItzJosep.','c')} <b class="ia-event-label ia-final-label">FINAL KILL!</b></div>`;chat.append(chatSample);
    const boardScene=el('div','ia-score-scene'),boardSample=el('div','ia-scoreboard');
    boardSample.innerHTML=`<strong>${mc('BED WARS','e')}</strong><div>${mc('09/12/26  m6708','7')}</div><p>Diamond II in ${mc('5:43','a')}</p>`;
    const teams=[['R','Red','c'],['B','Blue','9'],['G','Green','a'],['Y','Yellow','e'],['A','Aqua','b'],['W','White','f'],['P','Pink','d'],['S','Gray','7']];
    for(const [letter,name,color] of teams){const r=el('div','ia-score-team');r.style.setProperty('--team-color',palette[color]);r.dataset.eliminated=String(['Blue','Green'].includes(name));r.innerHTML=`<span class="ia-team-letter">${letter} </span><span class="ia-team-name">${name}</span><span class="ia-team-alive">: ${mc('✓','a')}</span><span class="ia-team-eliminated">: ${mc('✗','c')}</span>${name==='Pink'?` ${mc('YOU','7')}`:''}`;boardSample.append(r);}
    const footer=el('p');footer.innerHTML=mc('www.hypixel.net','e');boardSample.append(footer);boardScene.append(boardSample);board.append(boardScene);event.append(chat);score.append(board);
    names.replaceChildren(identity,event,score);
    function update(){
        const on=$('#accent-bedwars-event-labels-enabled').checked;
        chat.classList.toggle('ia-enhanced',on);caption.classList.toggle('ia-default',!on);caption.querySelector('span').textContent=on?'In-game accent color':'Default colors';
        board.classList.toggle('ia-enhanced',$('#bedwars-sidebar-team-colors-enabled').checked);
    }
    function updateAccent(hex){
        const mapped=closestLegacyChatColor(hex);
        chat.style.setProperty('--ia-event-accent',mapped.hex);
        caption.querySelector('i').title=`${mapped.name.replace(/_/g,' ')} (§${mapped.code})`;
    }
    window.addEventListener('fury:accent-change',event=>updateAccent(event.detail.color));
    updateAccent(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    page.addEventListener('change',update);update();
    return {update};
}
module.exports={mount,renderTab};
