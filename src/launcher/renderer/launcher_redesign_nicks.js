'use strict';

const { migrationNoticeText } = require('../../denick/migrationNotice');

function mount({document,node,button,escape}) {
    const $=selector=>document.querySelector(selector),page=$('[data-page="denicks"]'),tabs=$('[data-denick-subpage-button]').parentElement;
    tabs.classList.add('fury-nick-tabs');page.querySelector('.page-title').after(tabs);tabs.querySelectorAll('button').forEach(b=>b.classList.remove('primary'));
    tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Nicks');
    tabs.querySelectorAll('[data-denick-subpage-button]').forEach(b=>{
        const key=b.dataset.denickSubpageButton,panel=$(`[data-denick-subpage="${key}"]`),selected=b.classList.contains('active');
        b.querySelector('span').textContent=key==='history'?'Saved':'Lookup';
        b.id=`fury-nicks-${key}-tab`;b.setAttribute('role','tab');b.setAttribute('aria-controls',`fury-nicks-${key}-panel`);b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;
        panel.id=`fury-nicks-${key}-panel`;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',b.id);
    });
    tabs.addEventListener('keydown',event=>{
        const choices=[...tabs.querySelectorAll('[data-denick-subpage-button]')],index=choices.indexOf(event.target);
        if(index<0||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?choices.length-1:(index+(event.key==='ArrowRight'?1:choices.length-1))%choices.length;
        choices[next].focus(); // Enter/Space activates; arrows must not load the lookup catalog.
    });
    const count=$('#denick-results-count');tabs.append(count);
    const notice=node('div','fury-nick-migration-notice');
    notice.hidden=true;notice.setAttribute('role','status');notice.setAttribute('aria-atomic','true');tabs.after(notice);
    let noticeHistory=null,hasPending=false;
    function update(next) {
        if(!page.classList.contains('active'))return;
        const history=next.denickHistory;
        if(history!==noticeHistory){noticeHistory=history;hasPending=(history?.players||[]).some(player=>!player.realUuid&&player.identityState!=='missing');}
        const live=next.proxyHealth?.denickMigration;
        const state=live?.state||(hasPending?(next.proxyHealth||next.services?.proxy?.running?'unavailable':'stopped'):'complete');
        const message=migrationNoticeText(state);
        if(notice.textContent!==message){notice.textContent=message;schedule();}
        if(notice.hidden!==!message)notice.hidden=!message;
    }
    const tools=$('.denick-history-tools'),filters=$('.denick-filter-grid');tools.prepend(filters);$('.denick-filter-control').classList.add('fury-removed');
    $('#denick-search').placeholder='Search name…';$('#denick-search').setAttribute('aria-label','Search saved matches');
    $('.denick-summary').classList.add('fury-removed');$('.denick-matches-head').classList.add('fury-removed');
    const mapping=node('dialog','fury-dialog fury-mapping-dialog','<header><h2>Save manual mapping</h2></header>'),close=()=>mapping.close();
    mapping.querySelector('h2').id='fury-mapping-title';mapping.setAttribute('aria-labelledby','fury-mapping-title');
    const closeButton=button('×',close,'fury-close');closeButton.setAttribute('aria-label','Close mapping dialog');mapping.querySelector('header').append(closeButton);
    const original=$('.denick-manual-compact');mapping.append(original);document.body.append(mapping);
    for(const[id,title]of[['manual-denick-nick','Nickname'],['manual-denick-real','Real IGN']]){const input=document.getElementById(id),label=node('label','',title);input.before(label);label.append(input);}
    mapping.append(button('Cancel',close));
    const openMapping=()=>{mapping.showModal();$('#manual-denick-nick').focus();};
    tools.append(button('+ Add mapping',openMapping,'fury-gold-outline'));
    const lookup=$('[data-denick-subpage="lookup"]');lookup.querySelector('.denick-lookup-title').append(button('Manual mapping',openMapping,'fury-gold-outline'));
    const main=$('main'),host=$('#denick-list'),view=document.defaultView;
    const rowHeight=62,overscan=6;
    const dates=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
    const shortDates=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
    const date=value=>{const d=new Date(value);return value&&Number.isFinite(d.getTime())?dates.format(d):'Unknown';};
    const shortDate=value=>{const d=new Date(value);return value&&Number.isFinite(d.getTime())?shortDates.format(d):'Unknown';};
    const method=value=>({skin:'Skin',stats:'Stats',manual:'Manual',skin_manual:'Manual skin',party_variation:'Party variation',own_nick:'Your nickname',party_shared:'Fury teammate'}[value]||'Unknown');
    const latest=player=>(player.events||[]).reduce((best,event)=>!best||Date.parse(event.at)>Date.parse(best.at)?event:best,null)||{};
    const avatar=(player,size)=>`<span class="fury-nick-avatar" style="--avatar-size:${size}px"><span>${escape((player.realIGN||'?')[0])}</span><img loading="lazy" decoding="async" src="https://mc-heads.net/avatar/${encodeURIComponent(player.uuid||player.realIGN)}/${size}" alt="" onerror="this.hidden=true"></span>`;
    let selectedName='',detailKey='',players=[],start=-1,end=-1,focusedIndex=0,frame=null,destroyed=false;
    const table=node('section','fury-nick-table','<div class="fury-nick-table-head"><button type="button" data-nick-sort="nick" aria-label="Sort by nickname">Nickname<span aria-hidden="true">↓</span></button><button type="button" data-nick-sort="name" aria-label="Sort by real IGN">Real IGN<span aria-hidden="true">↓</span></button><span class="fury-nick-method">Method</span><button type="button" data-nick-sort="recent" aria-label="Sort by newest match">Last seen<span aria-hidden="true">↓</span></button><span aria-hidden="true"></span></div>');
    table.setAttribute('aria-label','Saved nickname matches. Use arrow keys to move between matches.');
    const top=node('div','fury-nick-spacer'),rows=node('div','fury-nick-rows'),bottom=node('div','fury-nick-spacer'),detail=node('aside','fury-nick-detail');
    const detailDialog=node('dialog','fury-dialog fury-nick-dialog','<header><h2 id="fury-nick-detail-title">Saved match</h2></header>');
    detailDialog.id='fury-nick-detail-dialog';detailDialog.setAttribute('aria-labelledby','fury-nick-detail-title');
    const closeDetail=button('×',()=>detailDialog.close(),'fury-close');closeDetail.setAttribute('aria-label','Close match details');
    detailDialog.querySelector('header').append(closeDetail);detailDialog.append(detail);
    top.setAttribute('aria-hidden','true');bottom.setAttribute('aria-hidden','true');
    count.classList.add('fury-nicks-count');
    table.append(top,rows,bottom);host.replaceChildren(table,count,detailDialog);
    const sort=$('#denick-sort'),sortButtons=[...table.querySelectorAll('[data-nick-sort]')];
    for(const control of sortButtons)control.addEventListener('click',()=>{if(sort.value===control.dataset.nickSort)return;sort.value=control.dataset.nickSort;sort.dispatchEvent(new view.Event('change',{bubbles:true}));});
    function syncSelection(){
        for(const row of rows.children){if(!row.matches('.fury-nick-row'))continue;const selected=row.dataset.real===selectedName;row.classList.toggle('active',selected);row.setAttribute('aria-expanded',String(selected&&detailDialog.open));}
    }
    detailDialog.addEventListener('close',()=>{
        if(destroyed)return;syncSelection();
        if(host.getClientRects().length)rows.querySelector(`[data-index="${focusedIndex}"]`)?.focus({preventScroll:true});
    });
    detailDialog.addEventListener('click',event=>{if(event.target!==detailDialog)return;const r=detailDialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)detailDialog.close();});
    function show(player) {
        selectedName=player.realIGN;
        const event=latest(player),nick=event.nick||player.nicks?.[0]||'Unknown',previous=(player.nicks||[]).filter(n=>n!==nick);
        const key=JSON.stringify([player.realIGN,player.uuid,nick,previous,event.method||player.methods?.[0],player.firstSeen,player.lastSeen]);
        if(key===detailKey){syncSelection();return;}
        detailKey=key;
        const active=document.activeElement,focusSelector=detailDialog.open&&detail.contains(active)
            ?active.matches('[data-copy-denick]')?'[data-copy-denick]':active.matches('[data-denick-remove]')?'[data-denick-remove]':null:null;
        detailDialog.querySelector('h2').textContent=player.realIGN;
        detail.innerHTML=`<div class="fury-nick-detail-head">${avatar(player,48)}<div><span>Latest nickname</span><h3>${escape(nick)}</h3></div></div><dl><div><dt>Previous nicknames</dt><dd>${escape(previous.join(', ')||'None')}</dd></div><div><dt>Match source</dt><dd>${escape(method(event.method||player.methods?.[0]))}</dd></div><div><dt>First seen</dt><dd>${escape(date(player.firstSeen))}</dd></div><div><dt>Last seen</dt><dd>${escape(date(player.lastSeen))}</dd></div></dl><div class="fury-nick-detail-actions"><button data-copy-denick="${escape(player.realIGN)}">Copy IGN</button><button class="fury-remove-match" data-denick-remove data-denick-real="${escape(player.realIGN)}" data-denick-nick="${escape(nick)}">Remove saved match</button></div>`;
        syncSelection();
        if(focusSelector)detail.querySelector(focusSelector)?.focus({preventScroll:true});
    }
    function windowRows(force=false) {
        if(destroyed||!players.length||!host.getClientRects().length)return;
        const viewport=main.getBoundingClientRect(),listTop=table.getBoundingClientRect().top+table.firstElementChild.offsetHeight;
        const visible=Math.max(0,viewport.top-listTop),capacity=Math.ceil(main.clientHeight/rowHeight)+overscan*2;
        const from=Math.max(0,Math.min(players.length-capacity,Math.floor(visible/rowHeight)-overscan)),to=Math.min(players.length,from+capacity);
        if(!force&&from===start&&to===end)return;
        const hadFocus=rows.contains(document.activeElement),fragment=document.createDocumentFragment();
        focusedIndex=Math.max(from,Math.min(to-1,focusedIndex));
        for(let i=from;i<to;i++){
            const player=players[i],event=latest(player);
            const nick=event.nick||player.nicks?.[0]||'Unknown',source=method(event.method||player.methods?.[0]);
            const row=button(`<strong>${escape(nick)}</strong><span class="fury-nick-real">${avatar(player,24)}<span>${escape(player.realIGN)}</span></span><span class="fury-nick-method">${escape(source)}</span><span class="fury-nick-seen" title="${escape(date(player.lastSeen))}">${escape(shortDate(player.lastSeen))}</span><span class="fury-nick-open" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg></span>`,()=>{focusedIndex=i;show(player);detailDialog.showModal();syncSelection();closeDetail.focus();},'fury-nick-row');
            row.dataset.real=player.realIGN;row.dataset.index=String(i);row.tabIndex=i===focusedIndex?0:-1;
            row.setAttribute('aria-haspopup','dialog');row.setAttribute('aria-controls',detailDialog.id);
            row.setAttribute('aria-label',`${nick}, real IGN ${player.realIGN}, matched by ${source}, last seen ${date(player.lastSeen)}. Open match details.`);
            row.classList.toggle('active',player.realIGN===selectedName);row.setAttribute('aria-expanded',String(player.realIGN===selectedName&&detailDialog.open));
            fragment.append(row);
        }
        top.style.height=`${from*rowHeight}px`;bottom.style.height=`${(players.length-to)*rowHeight}px`;
        rows.replaceChildren(fragment);start=from;end=to;
        if(hadFocus)rows.querySelector(`[data-index="${focusedIndex}"]`)?.focus({preventScroll:true});
    }
    function schedule() {
        if(frame!==null||destroyed||document.hidden||!host.getClientRects().length)return;
        frame=view.requestAnimationFrame(()=>{frame=null;windowRows();});
    }
    function navigate(event) {
        const row=event.target.closest('.fury-nick-row');if(!row)return;
        const index=Number(row.dataset.index),pageSize=Math.max(1,Math.floor(main.clientHeight/rowHeight)-1);
        const next={ArrowDown:index+1,ArrowUp:index-1,Home:0,End:players.length-1,PageDown:index+pageSize,PageUp:index-pageSize}[event.key];
        if(next===undefined)return;
        event.preventDefault();focusedIndex=Math.max(0,Math.min(players.length-1,next));
        const listTop=table.getBoundingClientRect().top+table.firstElementChild.offsetHeight,viewport=main.getBoundingClientRect();
        const targetTop=listTop+focusedIndex*rowHeight;
        if(targetTop<viewport.top)main.scrollTop+=targetTop-viewport.top;
        else if(targetTop+rowHeight>viewport.top+main.clientHeight)main.scrollTop+=targetTop+rowHeight-viewport.top-main.clientHeight;
        windowRows(true);rows.querySelector(`[data-index="${focusedIndex}"]`)?.focus({preventScroll:true});
    }
    rows.addEventListener('keydown',navigate);
    rows.addEventListener('focusin',event=>{const row=event.target.closest('.fury-nick-row');if(row){focusedIndex=Number(row.dataset.index);for(const item of rows.children)item.tabIndex=item===row?0:-1;}});
    main.addEventListener('scroll',schedule,{passive:true});tabs.addEventListener('click',schedule);
    const resize=new view.ResizeObserver(schedule);resize.observe(main);
    function render(nextPlayers,history) {
        players=nextPlayers;start=end=-1;
        sortButtons.forEach(control=>control.setAttribute('aria-pressed',String(control.dataset.nickSort===sort.value)));
        if(!players.length){
            if(detailDialog.open)detailDialog.close();selectedName='';detailKey='';focusedIndex=0;
            top.style.height=bottom.style.height='0px';
            rows.replaceChildren(node('div','fury-empty-inline',history.fileExists?'No saved matches fit these filters.':'Saved nick matches will appear here.'));
            detail.replaceChildren(node('p','','Select a match to see its details.'));return;
        }
        const selected=players.find(p=>p.realIGN===selectedName);
        if(!selected){if(detailDialog.open)detailDialog.close();selectedName='';}
        focusedIndex=Math.max(0,Math.min(players.length-1,focusedIndex));
        rows.replaceChildren();top.style.height='0px';bottom.style.height=`${players.length*rowHeight}px`;
        if(detailDialog.open&&selected)show(selected);windowRows(true);schedule();
    }
    function destroy() {
        destroyed=true;if(detailDialog.open)detailDialog.close();if(frame!==null)view.cancelAnimationFrame(frame);resize.disconnect();
        main.removeEventListener('scroll',schedule);tabs.removeEventListener('click',schedule);
        view.removeEventListener('beforeunload',destroy);
    }
    view.addEventListener('beforeunload',destroy,{once:true});
    return{render,update,destroy};
}
module.exports={mount};
