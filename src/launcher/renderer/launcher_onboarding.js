'use strict';
function mount({document,node,button,invoke,clipboard,navigate,getState,refresh,skin}) {
    const grid=document.querySelector('.dashboard-main-grid');
    const panel=node('section','panel fury-onboarding');grid.prepend(panel);
    const style=node('link','');style.rel='stylesheet';style.href='src/launcher/styles/launcher_onboarding.css';document.head.append(style);
    let phase='',pending=false,code='',url='',error='',forceReady=false,lastKey='',generation=0,signature='',connectionError='';
    const key=()=>getState()?.viewedAccount?.key||'';
    const stepper=()=>'<div class="fury-onboarding-steps"><h3>In Minecraft</h3><ol>'+['Multiplayer','Add Server','Server Address','Done','Join Server'].map((label,i)=>`<li><b>${i+1}</b><span>${label}</span></li>`).join('')+'</ol></div>';
    const browserIcon='<svg class="fury-onboarding-browser" viewBox="0 0 80 65" aria-hidden="true"><rect x="3" y="3" width="63" height="48" rx="5"/><path d="M3 16h63M12 10h1m7 0h1m7 0h1"/><path class="accent" d="M50 58H39V36h22m-11-9h23v23M72 28 51 49"/></svg>';
    function render(){
        const state=getState(),account=state?.viewedAccount,missing=!account?.hasLogin||account.state==='missing'||account.signInRequired;
        const completed=key()&&localStorage.getItem('fury-onboarded:'+key())==='yes';
        const connected=state?.proxyHealth?.connectedAccount;
        if(state?.proxyHealth?.connectionReady&&connected&&account?.name?.toLowerCase()===connected.toLowerCase()) {localStorage.setItem('fury-onboarded:'+key(),'yes');forceReady=false;}
        if(!pending){phase=error?'error':missing?'welcome':forceReady||(!completed&&!state?.sessionHistory?.sessions?.length)?'ready':'hidden';}
        panel.hidden=phase==='hidden';grid.classList.toggle('fury-onboarding-active',!panel.hidden);
        if(panel.hidden)return;
        const nextSignature=JSON.stringify([phase,code,url,error,connectionError,key(),account?.name,state?.settings?.server?.proxyDirectPort]);
        if(nextSignature===signature)return;signature=nextSignature;
        panel.replaceChildren();
        if(pending){
            panel.append(node('div','',browserIcon+'<h2>Finish signing in in your browser</h2>'));
            if(code){
                panel.append(node('p','fury-onboarding-label','Sign-in code'),node('strong','fury-onboarding-code',code));
                panel.append(button('Copy code',()=>{clipboard.writeText(code);},'fury-onboarding-secondary'));
            }
            panel.append(node('span','fury-onboarding-spinner'),node('p','fury-onboarding-muted',code?'Waiting for sign-in\u2026':'Preparing Microsoft sign-in\u2026'));
            const actions=node('div','fury-onboarding-actions');
            const open=button('Open browser again',()=>document.dispatchEvent(new CustomEvent('onboarding-open-browser',{detail:url})),'primary');open.disabled=!url;
            const cancel=button('Cancel',async()=>{if(!pending)return;cancel.disabled=true;await invoke('auth:microsoft-cancel');},'fury-onboarding-secondary');actions.append(open,cancel);panel.append(actions);
        }else if(phase==='ready'){
            panel.append(node('p','fury-onboarding-success','\u2713 &nbsp; Account connected'));
            const identity=node('div','fury-onboarding-identity');const head=node('span','fury-avatar');head.innerHTML=skin(account,44);identity.append(head,node('strong','',account?.name||''));panel.append(identity,node('h2','',"You\u2019re ready to connect"));
            const address=node('div','fury-onboarding-address');const value=node('input','');value.readOnly=true;value.value=`localhost:${state?.settings?.server?.proxyDirectPort||25565}`;value.setAttribute('aria-label','Minecraft server address');
            const copy=button('Copy address',async()=>{copy.disabled=true;try{if(!getState()?.services?.proxy?.running)await invoke('service:start','proxy');clipboard.writeText(value.value);copy.textContent='Copied';await refresh();}catch(e){connectionError=e.message;render();}finally{copy.disabled=false;}},'primary');address.append(value,copy);panel.append(address,node('p','fury-onboarding-muted','Copy and use the address in Minecraft when adding a new multiplayer server.'),node('div','',stepper()));
            if(connectionError){const note=node('p','fury-onboarding-muted');note.textContent=connectionError;note.setAttribute('role','alert');panel.append(note);}
        }else{
            panel.append(node('span','fury-onboarding-badge','Sign-in required'),node('h2','',error?'Sign-in could not be completed':'Sign in to Minecraft'));
            const description=node('p','fury-onboarding-muted');description.textContent=error||'Connect the Microsoft account you use to play Minecraft before joining through Fury.';description.setAttribute('role','status');panel.append(description);
            panel.append(button(error?'Try again':'Sign in with Microsoft',()=>start(account),'primary fury-onboarding-signin'));
            panel.append(node('p','fury-onboarding-muted','Your browser will open to complete sign-in.'));
            panel.append(node('ol','fury-onboarding-intro','<li><b>1</b> Sign in</li><li><b>2</b> Copy server address</li><li><b>3</b> Join in Minecraft</li>'));
        }
    }
    async function start(account=null){
        if(pending)return;
        navigate('dashboard');pending=true;phase='waiting';code='';url='';error='';const run=++generation;render();
        try{await invoke('auth:microsoft-login',account?.username||account?.name||'');forceReady=true;}
        catch(e){if(!/cancelled/i.test(e.message))error=e.message;}
        finally{if(run===generation){code='';url='';await refresh();pending=false;lastKey=key();signature='';render();}}
    }
    document.addEventListener('onboarding-code',event=>{if(!pending)return;code=event.detail?.code||'';url=event.detail?.directUrl||event.detail?.url||'';render();});
    return {start,update(){const current=key();if(current!==lastKey&&!pending){error='';forceReady=false;lastKey=current;}render();}};
}
module.exports={mount};
