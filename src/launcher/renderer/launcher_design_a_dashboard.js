'use strict';

const cards=require('./launcher_session_card');

// Dashboard presentation only. Native controls and the accepted compact history
// response retain ownership of actions, accounts, results and data freshness.
function mount({document,navigate,getState,startProxy,stopProxy,checkDust,invoke}){
 const $=selector=>document.querySelector(selector),win=document.defaultView;
 const make=(tag,cls,text='')=>{const node=document.createElement(tag);node.className=cls;node.textContent=text;return node;};
 const svg=path=>{const host=make('span','da-dashboard-icon');host.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;return host.firstElementChild;};
 const paths={play:'<path d="m8 5 11 7-11 7Z"/>',stop:'<rect x="6" y="6" width="12" height="12" rx="1"/>',arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',chevron:'<path d="m6 9 6 6 6-6"/>'};
 const button=(text,action,cls='da-dashboard-button')=>{const node=make('button',cls,text);node.type='button';node.addEventListener('click',action);return node;};
 const page=$('[data-page="dashboard"]'),grid=$('.dashboard-main-grid'),guide=$('.dashboard-server-guide');
 page.classList.add('da-dashboard');guide.classList.add('da-server-strip');
 $('.fury-dashboard-right').classList.add('da-legacy');$('.fury-connection-help').classList.add('da-legacy');
 const identity=$('.fury-connection-identity'),lines=identity.lastElementChild,address=$('#join-direct-address');
 const mark=make('img','da-server-icon');mark.src='assets/fury-server-icon.png';mark.alt='';identity.prepend(mark);
 $('#join-proxy-title').textContent='Fury';lines.append(address);
 const serverStatus=make('span','da-server-status');serverStatus.setAttribute('role','status');lines.append(serverStatus);
 const copyField=$('[data-copy-route="direct"]').closest('.join-address-field');
 const options=$('.fury-connection-options'),summary=options.querySelector('summary');summary.textContent='';summary.append(svg(paths.chevron));summary.setAttribute('aria-label','Connection options');summary.title='Connection options';
 // Direct is already in the server strip; the popover contains alternate routes.
 options.querySelector('.fury-route-menu-heading').classList.add('da-legacy');
 options.querySelector('.fury-direct-route').classList.add('da-legacy');
 for(const route of options.querySelectorAll('.join-route:not(.fury-direct-route)')){
  const copy=route.querySelector('[data-copy-route]');copy.dataset.copyLabel='Copy';copy.textContent='Copy';copy.title=copy.getAttribute('aria-label');
  route.querySelector('.fury-route-copy').append(route.querySelector('.join-destination'));
  route.querySelector('[id$="-help"]').classList.add('da-legacy');
 }
 const actions=make('div','da-server-actions');actions.append(copyField,options);
 const start=button('',()=>getState()?.services?.proxy?.running?stopProxy():startProxy(),'da-dashboard-start'),proxyIcon=svg(paths.play),proxyLabel=make('span','','Start proxy');start.append(proxyIcon,proxyLabel);
 const signal=make('span','da-signal');signal.setAttribute('aria-hidden','true');for(let i=0;i<5;i++){const bar=make('i','');bar.style.setProperty('--i',String(i));signal.append(bar);}
 const glow=make('span','da-server-glow');glow.setAttribute('aria-hidden','true');
 guide.prepend(glow);identity.after(signal,start,actions);
 const minecraftSetup=require('./launcher_minecraft_setup').mount({document,invoke});
 const recent=$('.fury-recent'),recentBody=$('.fury-recent-content');recent.classList.add('da-recent');
 const reminders=make('div','ds-dashboard-reminders');
 const openReminders=()=>navigate('reminders');
 const reminderCard=(title)=>{const card=make('section','ds-reminder-summary'),head=make('header','da-reminder-head'),reading=make('div','da-reminder-reading'),progress=make('progress','da-progress');head.append(make('h2','',title));progress.setAttribute('aria-label',title);card.append(head,reading,progress);reminders.append(card);return{card,head,reading,progress};};
 const dust=reminderCard('Ender Dust'),george=reminderCard('Gambler George');
 const settings=button('',openReminders,'da-reminder-settings');settings.append($('[data-page-tab="settings"]>svg').cloneNode(true));settings.setAttribute('aria-label','Reminder settings');settings.title='Reminder settings';dust.head.append(settings);
 const check=button('Check now',async()=>{
  if(check.disabled)return;check.disabled=true;check.textContent='Checking…';
  try{await checkDust();}finally{if(check.isConnected){check.disabled=false;check.textContent='Check now';update(getState()||{});}}
 },'da-reminder-check');
 const dustValue=make('strong',''),dustTotal=make('span','','/ 300');dust.reading.append(dustValue,dustTotal,check);dust.progress.max=300;
 const dustStatus=make('p','da-reminder-status');dustStatus.setAttribute('role','status');dust.card.append(dustStatus);
 const georgeValue=make('strong',''),georgeTotal=make('span',''),ready=make('span','da-ready-badge','Ready');george.head.append(ready);george.reading.append(georgeValue,georgeTotal);george.progress.max=2;
 grid.append(reminders,make('div','da-dashboard-notices'));
 const reduce=win.matchMedia('(prefers-reduced-motion: reduce)');
 let connectionKey='',reminderKey='',recentKey='',counters=[],frame=0,finishCount=null,needsEntrance=true,disposed=false;
 const fullMotion=()=>!disposed&&!document.hidden&&page.classList.contains('active')&&document.documentElement.dataset.motion==='full'&&!reduce.matches;
 function finish(){if(frame)win.cancelAnimationFrame(frame);frame=0;finishCount?.();finishCount=null;}
 function countUp(){
  finish();if(!counters.length||!fullMotion())return;
  const targets=counters.slice(),paint=t=>{for(const {node,value,decimals}of targets)node.textContent=(value*t).toFixed(decimals);};
  const started=win.performance.now();finishCount=()=>paint(1);paint(0);
  const tick=now=>{if(!fullMotion()){finish();return;}const t=Math.min(1,(now-started)/800);paint(1-(1-t)**3);if(t<1)frame=win.requestAnimationFrame(tick);else{frame=0;finishCount=null;}};
  frame=win.requestAnimationFrame(tick);
 }
 function update(next){
  minecraftSetup.update(next);
  if(disposed||!page.classList.contains('active'))return;
  const running=Boolean(next.services?.proxy?.running),starting=document.documentElement.dataset.proxyStarting==='true',stopping=document.documentElement.dataset.proxyStopping==='true';
  const connection=stopping?'stopping':starting?'starting':running?'running':'stopped',signatureKey=`${connection}:${running}`;
  if(signatureKey!==connectionKey){connectionKey=signatureKey;guide.dataset.proxy=connection;start.disabled=starting||stopping;start.dataset.action=running?'stop':'start';proxyLabel.textContent=stopping?'Stopping…':starting?'Starting…':running?'Stop proxy':'Start proxy';proxyIcon.innerHTML=running?paths.stop:paths.play;actions.hidden=!running;address.hidden=!running;serverStatus.hidden=running;serverStatus.textContent=starting?'Pinging…':"Can't connect to server";signal.title=stopping?'Stopping proxy':starting?'Starting proxy':running?'Proxy running':'Proxy stopped';}
  const checking=$('#ender-dust-reminder-check').disabled;
  if(check.disabled!==checking)check.disabled=checking;
  const checkLabel=checking?'Checking…':'Check now';if(check.textContent!==checkLabel)check.textContent=checkLabel;
  const dustData=next.reminders?.enderDust,bet=next.reminders?.gamblerGeorge;
  const reminderSignature=JSON.stringify([next.accountKey,next.viewedAccount?.key,dustData?.enderDust,dustData?.error,bet?.known,bet?.wins,bet?.requiredWins,bet?.claimReady]);
  if(reminderSignature!==reminderKey){reminderKey=reminderSignature;
   reminders.hidden=!next.viewedAccount;dustValue.textContent=dustData?.enderDust==null?'—':String(dustData.enderDust);dust.progress.value=Number(dustData?.enderDust)||0;dust.progress.setAttribute('aria-valuetext',dustData?.enderDust==null?'Not checked':`${dustData.enderDust} of 300`);dustStatus.textContent=dustData?.error||'';dustStatus.hidden=!dustStatus.textContent;
   georgeValue.textContent=bet?.known?String(bet.wins||0):'—';georgeTotal.textContent=`/ ${bet?.requiredWins||2} wins`;george.progress.max=Number(bet?.requiredWins)||2;george.progress.value=Number(bet?.wins)||0;george.progress.setAttribute('aria-valuetext',bet?.known?`${bet.wins||0} of ${bet.requiredWins||2} wins`:'Not checked');ready.hidden=!bet?.claimReady;
  }
  const latest=next.sessionHistory?.sessions?.[0],live=Boolean(latest?.active&&next.proxyHealth?.liveGame?.gameActive);
  const games=latest?.games||[],shown=games.slice(0,36);
  const signature=JSON.stringify([next.accountKey,next.viewedAccount?.key,next.viewedAccount?.uuid,latest?.id,latest?.name,latest?.startedAt,latest?.active,latest?.durationMs,latest?.modes,shown.map(g=>[g.id,g.mode,g.result]),games.length,live]);
  if(signature!==recentKey||!recentBody.firstChild){recentKey=signature;finish();counters=[];recent.dataset.live=String(live);
   if(!latest)recentBody.replaceChildren(make('strong','','No sessions yet'));
   else{
    const identity=make('div','da-recent-identity'),head=make('span','da-recent-avatar'),image=make('img','');image.alt='';image.hidden=true;image.dataset.accountUuid=latest.uuid||next.viewedAccount?.uuid||'';head.append(image);
    const copy=make('div','da-recent-copy');copy.append(make('strong','',next.viewedAccount?.name||latest.name),make('span','',latest.active?`Live session · Started ${cards.time(latest.startedAt)}`:`Last session · ${cards.date(latest.startedAt)}`));
    const open=button('Open',()=>navigate('sessions'),'da-text-button');open.append(svg(paths.arrow));identity.append(head,copy,open);
    const modes=latest.modes||[],sum=key=>{
     const applicable=['finals','finalDeaths','beds'].includes(key)?modes.filter(m=>m.mode==='BEDWARS'):modes;
     return applicable.length&&applicable.every(m=>m[key]!=null&&Number.isFinite(Number(m[key])))?applicable.reduce((n,m)=>n+Number(m[key]),0):null;
    };
    const finals=sum('finals'),deaths=sum('finalDeaths'),metrics=make('div','da-session-metrics'),fkdr=finals==null||deaths==null?null:deaths?finals/deaths:finals;
    for(const [label,value,decimals]of [['Duration',cards.duration(latest.durationMs)],['Wins',sum('wins'),0],['Final kills',finals,0],['FKDR',fkdr,2],['Beds broken',sum('beds'),0]]){
     const node=make('strong','',value==null?'—':typeof value==='number'?value.toFixed(decimals):value);if(typeof value==='number')counters.push({node,value,decimals});const stat=make('div','');stat.append(make('span','',label),node);metrics.append(stat);
    }
    const form=make('div','da-session-form');form.setAttribute('aria-label','Recent game results');
    for(const game of shown.slice().reverse()){const result=['win','loss','draw'].includes(game.result)?game.result:'unknown',mark=make('i',`da-result-${result}`);mark.title=`${game.mode||'Game'} · ${result==='unknown'?'Result unavailable':result[0].toUpperCase()+result.slice(1)}`;form.append(mark);}
    if(live){const now=make('i','da-result-live');now.title='Game in progress';form.append(now);}
    const count=Math.max(games.length,sum('games')||0);form.append(make('span','',`${count} ${count===1?'game':'games'}`));if(games.length>36)form.title='Showing the latest 36 recorded game results';
    recentBody.replaceChildren(identity,metrics,form);
   }
  }
  if(needsEntrance&&counters.length&&!document.hidden){needsEntrance=false;countUp();}
 }
 function onNavigate(name){if(name!=='dashboard'){needsEntrance=true;finish();}else update(getState()||{});}
 function visibility(){page.dataset.suspended=String(document.hidden);if(document.hidden)finish();else if(needsEntrance)update(getState()||{});}
 function dispose(){disposed=true;minecraftSetup.dispose();finish();document.removeEventListener('visibilitychange',visibility);win.removeEventListener('pagehide',dispose);}
 document.addEventListener('visibilitychange',visibility);win.addEventListener('pagehide',dispose,{once:true});visibility();
 update(getState()||{});
 return{update,onNavigate,dispose};
}
module.exports={mount};
