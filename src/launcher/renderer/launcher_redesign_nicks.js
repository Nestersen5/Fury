'use strict';

function mount({document,node,button,escape}) {
    const $=selector=>document.querySelector(selector),page=$('[data-page="denicks"]'),tabs=$('[data-denick-subpage-button]').parentElement;
    tabs.classList.add('fury-nick-tabs');page.querySelector('.page-title').after(tabs);tabs.querySelectorAll('button').forEach(b=>b.classList.remove('primary'));
    tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Nicks');
    tabs.querySelectorAll('[data-denick-subpage-button]').forEach(b=>{
        const key=b.dataset.denickSubpageButton,panel=$(`[data-denick-subpage="${key}"]`),selected=b.classList.contains('active');
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
    let selectedName='';
    const date=value=>{const d=new Date(value);return value&&Number.isFinite(d.getTime())?d.toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'Unknown';};
    const method=value=>({skin:'Skin',stats:'Stats',manual:'Manual',skin_manual:'Manual skin',party_variation:'Party variation'}[value]||'Unknown');
    const latest=player=>[...(player.events||[])].sort((a,b)=>new Date(b.at)-new Date(a.at))[0]||{};
    const avatar=(player,size)=>`<span class="fury-nick-avatar" style="--avatar-size:${size}px"><span>${escape((player.realIGN||'?')[0])}</span><img src="https://mc-heads.net/avatar/${encodeURIComponent(player.uuid||player.realIGN)}/${size}" alt="" onerror="this.hidden=true"></span>`;
    function render(players,history) {
        const host=$('#denick-list');host.replaceChildren();
        const table=node('section','fury-nick-table','<div class="fury-nick-table-head"><span>Nick</span><span>Real account</span><span>Method</span><span>Last seen</span></div>'),detail=node('aside','fury-nick-detail');host.append(table,detail);
        if(!players.length){table.append(node('div','fury-empty-inline',history.fileExists?'No saved matches fit these filters.':'Saved nick matches will appear here.'));detail.append(node('p','','Select a match to see its details.'));return;}
        if(!players.some(p=>p.realIGN===selectedName))selectedName=players[0].realIGN;
        const show=player=>{
            selectedName=player.realIGN;table.querySelectorAll('.fury-nick-row').forEach(row=>row.classList.toggle('active',row.dataset.real===selectedName));
            const event=latest(player),nick=event.nick||player.nicks?.[0]||'Unknown',previous=(player.nicks||[]).filter(n=>n!==nick);
            detail.innerHTML=`<div class="fury-nick-detail-head">${avatar(player,80)}<div><h3>${escape(nick)}</h3><span>Real account</span><strong>${escape(player.realIGN)}</strong></div></div><dl><div><dt>Match source</dt><dd>${escape(method(event.method||player.methods?.[0]))}</dd></div><div><dt>First seen</dt><dd>${escape(date(player.firstSeen))}</dd></div><div><dt>Last seen</dt><dd>${escape(date(player.lastSeen))}</dd></div><div><dt>Previous nicknames</dt><dd>${escape(previous.join(', ')||'None')}</dd></div></dl><div class="fury-nick-detail-actions"><button data-copy-denick="${escape(player.realIGN)}">Copy IGN</button><button class="fury-remove-match" data-denick-remove data-denick-real="${escape(player.realIGN)}" data-denick-nick="${escape(nick)}">Remove saved match</button></div>`;
        };
        for(const player of players){const event=latest(player),row=button(`<strong>${escape(event.nick||player.nicks?.[0]||'Unknown')}</strong><span>${avatar(player,28)}${escape(player.realIGN)}</span><span class="fury-nick-method">${escape(method(event.method||player.methods?.[0]))}</span><span>${escape(date(player.lastSeen))}</span>`,()=>show(player),'fury-nick-row');row.dataset.real=player.realIGN;table.append(row);}
        show(players.find(p=>p.realIGN===selectedName));
    }
    return{render};
}
module.exports={mount};
