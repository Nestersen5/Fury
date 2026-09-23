'use strict';

// Every account view uses the same official texture, including its hat layer.
const {ipcRenderer}=require('electron');
const {normalizeUuid}=require('../../accounts/launcherAccounts');
const cache=new Map(),pending=new Map();
let fallbackPromise;
function makeSkin(data,image){
    const head=document.createElement('canvas');head.width=head.height=64;
    const ctx=head.getContext('2d');ctx.imageSmoothingEnabled=false;
    ctx.drawImage(image,8,8,8,8,0,0,64,64);ctx.drawImage(image,40,8,8,8,0,0,64,64);
    return {...data,image,headUrl:head.toDataURL('image/png')};
}
function fallbackSkin(){
    if(!fallbackPromise)fallbackPromise=new Promise((resolve,reject)=>{
        const image=new Image();image.onload=()=>resolve(makeSkin({fallback:true,model:'default'},image));image.onerror=reject;
        image.src=new URL('./assets/default-skin.png',document.baseURI).href;
    });
    return fallbackPromise;
}
async function get(account){
    const uuid=normalizeUuid(account?.uuid||account);if(!uuid)return fallbackSkin();
    const previous=cache.get(uuid);if(previous&&Date.now()<previous.expires)return previous.value;
    if(pending.has(uuid))return pending.get(uuid);
    const work=(async()=>{
        let value=null;
        try{
            const data=await ipcRenderer.invoke('account:skin',uuid);
            if(data?.uuid===uuid&&data.skinUrl?.startsWith('data:image/png;base64,')){
                const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=data.skinUrl;});
                value=makeSkin(data,image);
            }
        }catch{}
        if(!value)value={...await fallbackSkin(),uuid};
        cache.set(uuid,{value,expires:Date.now()+(value.fallback?60*1000:15*60*1000)});pending.delete(uuid);return value;
    })();pending.set(uuid,work);return work;
}
let observing=false;
const waiting=new WeakSet();
function isPlayerHead(img){return img?.tagName==='IMG'&&(img.matches('[data-account-uuid],.minecraft-tablist-head,.fury-avatar img,.fury-recent-avatar img,.fury-nick-avatar img,.denick-skin-head img')||/https:\/\/(?:mc-heads\.net\/avatar|crafatar\.com\/avatars)\//.test(img.src));}
function showFallback(img){
    return fallbackSkin().then(skin=>{if(img.isConnected){img.src=skin.headUrl;img.hidden=false;}});
}
function hydrate(root=document){
    root.querySelectorAll('img[data-account-uuid]').forEach(img=>{
        if(waiting.has(img))return;
        const uuid=img.dataset.accountUuid;
        waiting.add(img);
        showFallback(img).then(()=>get(uuid)).then(skin=>{
            if(!img.isConnected||img.dataset.accountUuid!==uuid)return;
            img.src=skin.headUrl;img.hidden=false;
            if(skin.fallback&&uuid)setTimeout(()=>{waiting.delete(img);if(img.isConnected)hydrate(img.parentElement);},60000);
        }).catch(()=>waiting.delete(img));
    });
    root.querySelectorAll('img:not([data-account-uuid])').forEach(img=>{
        if(isPlayerHead(img)&&img.complete&&!img.naturalWidth)void showFallback(img);
    });
}
function observe(){
    if(observing)return;observing=true;let scheduled=false;
    document.addEventListener('error',event=>{
        if(!isPlayerHead(event.target))return;
        // Older head elements hide themselves in an inline error handler.
        // Replace that behavior before it can hide the successfully loaded fallback.
        event.target.onerror=null;
        void showFallback(event.target);
    },true);
    new MutationObserver(()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;hydrate();});}).observe(document.body,{childList:true,subtree:true});hydrate();
}
async function body(account){
    const skin=await get(account);if(!skin)return null;
    if(!skin.body)skin.body=Promise.resolve().then(()=>{
        const SkinViewer=window.skinview3d?.SkinViewer;if(!SkinViewer)return null;
        let viewer;
        try{
            viewer=new SkinViewer({width:160,height:240,pixelRatio:1,zoom:0.85,renderPaused:true});
            viewer.loadSkin(skin.image,{model:skin.model});viewer.playerWrapper.rotation.y=0.2;viewer.render();
            const canvas=document.createElement('canvas');canvas.width=160;canvas.height=240;canvas.getContext('2d').drawImage(viewer.canvas,0,0);return canvas;
        }catch{return null;}finally{viewer?.dispose();}
    });
    return skin.body;
}
module.exports={get,body,observe,hydrate,fallbackSkin};
