'use strict';

const {buildCalendarStats,validTimezone,dayAt}=require('../../session/calendarStats');
const cards=require('./launcher_session_card');
const TITLES={daily:'Daily',weekly:'Weekly',monthly:'Monthly'};

function mount({document,node,button,svg,escape,toolbar,dateSelect,specificDay,getState,openManager,notify,clipboard,nativeImage,toggleList,viewCard,cardMenu,onChange}) {
    const list=document.querySelector('#session-history-list');
    const tabs=node('div','fury-period-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Session history period');
    toolbar.before(tabs);
    const panel=node('section','fury-calendar-panel');panel.id='fury-calendar-panel';panel.setAttribute('role','tabpanel');panel.hidden=true;list.before(panel);
    const detectedTimezone=()=>validTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC');
    let timeZone=detectedTimezone();
    const modeSelect=document.querySelector('#session-mode-filter');
    modeSelect.hidden=true;modeSelect.setAttribute('aria-hidden','true');modeSelect.tabIndex=-1;
    const modes=node('div','fury-history-modes');modes.setAttribute('role','radiogroup');modes.setAttribute('aria-label','Filter sessions by game mode');
    tabs.before(modes);
    const syncModes=()=>{for(const choice of modes.children){const selected=choice.dataset.filterMode===modeSelect.value;choice.setAttribute('aria-checked',String(selected));choice.tabIndex=selected?0:-1;}};
    for(const [index,option]of [...modeSelect.options].entries()){
        const choice=button(escape(option.textContent),()=>{modeSelect.value=option.value;modeSelect.dispatchEvent(new Event('change',{bubbles:true}));syncModes();});
        choice.dataset.filterMode=option.value;choice.setAttribute('role','radio');
        choice.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=(index+1)%modes.children.length;else if(event.key==='ArrowLeft')next=(index+modes.children.length-1)%modes.children.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=modes.children.length-1;else return;event.preventDefault();modes.children[next].click();modes.children[next].focus();});
        modes.append(choice);
    }
    modeSelect.addEventListener('change',syncModes);syncModes();
    let kind='sessions',key='';const rows=new Map();
    const api={history:{},filters:{},sessionIds:null,update,clear,filterSessions};
    function select(value){kind=value;key='';api.sessionIds=null;onChange();}
    for(const [i,value]of ['sessions','daily','weekly','monthly'].entries()) {
        const tab=button(value==='sessions'?'Sessions':TITLES[value],()=>select(value));
        tab.id=`fury-period-${value}`;tab.dataset.period=value;tab.setAttribute('role','tab');
        tab.setAttribute('aria-controls',value==='sessions'?'session-history-list':panel.id);
        tab.addEventListener('keydown',event=>{
            let next;if(event.key==='Home')next=0;else if(event.key==='End')next=3;else if(event.key==='ArrowRight')next=(i+1)%4;else if(event.key==='ArrowLeft')next=(i+3)%4;else return;
            event.preventDefault();tabs.children[next].click();tabs.children[next].focus();
        });tabs.append(tab);
    }
    function filterSessions(source){
        if(!api.sessionIds)return source;
        const byId=new Map(source.map(s=>[s.id,s]));
        return (api.history.calendarSessions||source).filter(s=>api.sessionIds.includes(s.id)).map(s=>byId.get(s.id)||{...s,durationMs:Math.max(0,(s.endedAt||s.lastSeen)-s.startedAt)});
    }
    function clear(){key='';rows.clear();panel.replaceChildren();api.sessionIds=null;api.history={sessions:[],calendarSessions:[]};}
    function update(history,filters) {
        api.history=history;api.filters=filters;
        timeZone=detectedTimezone();syncModes();
        const calendar=kind!=='sessions';
        toolbar.hidden=calendar;
        list.hidden=calendar;list.classList.toggle('fury-calendar-hidden',calendar);panel.hidden=!calendar;
        dateSelect.hidden=calendar;specificDay.hidden=calendar||dateSelect.value!=='day';
        for(const tab of tabs.children){const selected=tab.dataset.period===kind;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;}
        const titleActions=document.querySelector('[data-page="sessions"] .page-actions');if(titleActions)titleActions.classList.toggle('fury-calendar-actions',calendar);
        document.querySelector('.fury-contribution-filter')?.remove();
        if(!calendar){
            if(api.sessionIds){const banner=node('div','fury-contribution-filter',`<span>${api.sessionIds.length} contributing sessions</span>`);banner.append(button('Show all sessions',()=>{api.sessionIds=null;onChange();}));toolbar.after(banner);}
            return false;
        }
        panel.setAttribute('aria-labelledby',`fury-period-${kind}`);
        const currentAccount=getState()?.viewedAccount;
        const source=history.calendarSessions||history.sessions||[];
        const fields=getState()?.settings?.features||{};
        const nextKey=JSON.stringify([source,kind,timeZone,filters.mode,currentAccount?.key,dayAt(Date.now(),timeZone),fields.sessionBedwarsFields,fields.sessionSkywarsFields,fields.sessionDuelsFields]);
        if(nextKey===key)return true;key=nextKey;
        const periods=buildCalendarStats(source,{kind,timeZone,mode:filters.mode});
        const heading=node('h2','fury-calendar-heading',`${TITLES[kind]} summaries`);
        const content=node('div','fury-calendar-list');
        const retained=new Map();
        for(const period of periods){
            const fingerprint=JSON.stringify([{...period,durationMs:Math.floor(period.durationMs/60000)},fields.sessionBedwarsFields,fields.sessionSkywarsFields,fields.sessionDuelsFields]);
            let record=rows.get(period.id);
            if(!record||record.fingerprint!==fingerprint){record=createRow(period,currentAccount,fields,record?.row.open,record?.selectedMode,record?.selectedSubmode);record.fingerprint=fingerprint;}
            retained.set(period.id,record);content.append(record.row);
        }
        rows.clear();for(const [id,row]of retained)rows.set(id,row);
        if(!periods.length)content.append(node('div','fury-empty',`<span class="fury-empty-icon">${svg('sessions')}</span><h3>No ${kind} stats yet</h3><p>${currentAccount?'Play through Fury to record stats for this account and mode.':'Select an account to view its stats.'}</p>`));
        const noun={daily:'day',weekly:'week',monthly:'month'}[kind];
        panel.replaceChildren(heading,content,node('p','fury-calendar-footnote',`Calendar weeks start Monday · Local time (${escape(timeZone)}) · Stats recorded by Fury`),node('aside','fury-calendar-placeholder',periods.length?`Select a ${noun}`:''));
        for(const record of rows.values())if(record.row.open)record.generate();
        return true;
    }
    function createRow(period,currentAccount,fields,opened=false,previousMode,previousSubmode) {
        const row=node('details','fury-session-row fury-period-row');row.dataset.periodId=period.id;row.open=opened;
        if(period.active)row.classList.add('fury-period-current');
        const c=period.calendar;
        const label=period.active?{daily:'Today',weekly:'This week',monthly:'This month'}[kind]:c.label;
        const sessionsText=`${c.sessionIds.length} ${c.sessionIds.length===1?'session':'sessions'}`;
        // Rows name the period; its numbers live on the card.
        const summary=node('summary','',`<span class="fury-session-icon fury-period-icon">${svg('sessions')}</span><div class="fury-period-identity"><strong><span>${escape(label)}</span>${period.active?'<i class="fury-live-dot" title="In progress"></i>':''}</strong><span class="note">${period.active?`${escape(c.label)} <i>·</i> `:''}${sessionsText} <i>·</i> <b>${cards.duration(period.durationMs)}</b></span></div><span class="fury-view-label">View card ${svg('chevron')}</span>`);
        row.append(summary);
        const selected=period.modes[0];
        const body=node('div','fury-session-content'),controls=node('div','fury-card-toolbar',`<strong>${TITLES[kind]} card</strong>`),host=node('div','fury-card-stage');
        const head=node('div','fury-session-detail-head'),actions=node('div','fury-session-detail-actions');
        const heading=node('div','fury-session-detail-title',`<h3><span>${escape(label)}</span></h3><p class="note">${period.active?`${escape(c.label)} <i>·</i> `:''}${sessionsText} <i>·</i> ${cards.duration(period.durationMs)} tracked</p>`);
        let selectedMode=period.modes.some(m=>m.mode===previousMode)?previousMode:selected?.mode,selectedSubmode=previousSubmode||'overall',result=null,request=0,rendered=false;
        function slider(label,choices,value,onSelect){
            const group=node('div','fury-card-mode fury-card-mode-options fury-card-submode-options');
            group.setAttribute('role','radiogroup');group.setAttribute('aria-label',label);
            for(const [index,choice]of choices.entries()){
                const item=button(escape(choice.label),()=>{
                    for(const child of group.children){const active=child===item;child.setAttribute('aria-checked',String(active));child.tabIndex=active?0:-1;}
                    onSelect(choice.id);
                });
                item.dataset.calendarChoice=choice.id;item.setAttribute('role','radio');item.setAttribute('aria-checked',String(choice.id===value));item.tabIndex=choice.id===value?0:-1;
                item.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=(index+1)%choices.length;else if(event.key==='ArrowLeft')next=(index+choices.length-1)%choices.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=choices.length-1;else return;event.preventDefault();group.children[next].click();group.children[next].focus();});
                group.append(item);
            }
            return group;
        }
        if(period.modes.length>1)controls.append(slider('Calendar card game mode',period.modes.map(m=>({id:m.mode,label:m.label})),selectedMode,value=>{selectedMode=value;selectedSubmode='overall';updateSubmodes();rendered=false;generate();}));
        else{const only=node('span','fury-card-mode',escape(selected?.label||''));only.hidden=true;controls.append(only);}
        const submodeHost=node('div','fury-calendar-submodes');
        function updateSubmodes(){
            const choices=[{id:'overall',label:'Overall'},...(period.modes.find(m=>m.mode===selectedMode)?.submodes||[])];
            if(!choices.some(m=>m.id===selectedSubmode))selectedSubmode='overall';
            submodeHost.replaceChildren(slider('Calendar card mode details',choices,selectedSubmode,value=>{selectedSubmode=value;rendered=false;generate();}));
            submodeHost.hidden=choices.length===1;
        }
        updateSubmodes();controls.append(submodeHost);
        const copy=button(svg('copy'),()=>exportImage(false),'fury-calendar-copy');
        const download=button(`${svg('download')}<span>Save</span>`,()=>exportImage(true),'primary fury-calendar-save');copy.disabled=download.disabled=true;
        copy.setAttribute('aria-label','Copy image');copy.title='Copy image (Ctrl+C)';download.setAttribute('aria-label','Save as PNG');download.title='Save as PNG (Ctrl+S)';
        row.cardActions={zoom:()=>viewCard(result,`${TITLES[kind]} card: ${label}`),remove:null};
        const more=button(svg('more'),()=>cardMenu(more,row),'fury-card-more');
        actions.append(copy,download,more);head.append(heading,actions);
        host.addEventListener('click',event=>{if(event.target.closest('canvas'))row.cardActions.zoom();});
        const contributions=button(`View ${sessionsText} in this ${{daily:'day',weekly:'week',monthly:'month'}[kind]}`,()=>{
            api.sessionIds=c.sessionIds;kind='sessions';dateSelect.value='all';dateSelect.dispatchEvent(new Event('change',{bubbles:true}));onChange();
        },'fury-contributions');
        body.append(head,controls,host,contributions);row.append(body);
        async function generate(){
            if(rendered||!row.isConnected)return;rendered=true;const id=++request;copy.disabled=download.disabled=true;result=null;
            if(!host.querySelector('canvas'))host.textContent='Generating card…';
            try{
                const fieldKey={BEDWARS:'sessionBedwarsFields',SKYWARS:'sessionSkywarsFields',DUELS:'sessionDuelsFields'}[selectedMode];
                const card=await cards.render(period,{mode:selectedMode,submode:selectedSubmode,skinAccount:period.uuid?period:currentAccount||period,fields:fields[fieldKey]});
                if(id!==request||!row.isConnected||currentAccount?.key!==getState()?.viewedAccount?.key)return;
                const image=node('div','fury-card-image');image.append(card.canvas);host.replaceChildren(image);result=card;copy.disabled=download.disabled=false;
            }catch(error){if(id===request&&row.isConnected){host.textContent=error.message;rendered=false;}}
        }
        function exportImage(downloadImage){if(!result)return;try{const url=result.canvas.toDataURL('image/png');if(downloadImage){const a=document.createElement('a');a.href=url;a.download=result.filename;a.click();notify('Calendar card saved');}else{clipboard.writeImage(nativeImage.createFromDataURL(url));notify('Calendar card copied');}}catch(error){notify(`Could not export card: ${error.message}`);}}
        row.addEventListener('toggle',()=>{if(row.open)generate();});
        return {row,generate,get selectedMode(){return selectedMode;},get selectedSubmode(){return selectedSubmode;}};
    }
    return api;
}
module.exports={mount};
