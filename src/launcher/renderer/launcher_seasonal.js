'use strict';

// Launcher appearance only. Shares NesterTheme's local preference ownership;
// no account data, proxy state, network requests or polling are involved.
const STORAGE_KEY='fury-seasonal-v1';
const DEFAULTS=Object.freeze({theme:'christmas',snow:true,edges:true,lights:true,trail:true});
const LOGO='assets/launcher-themes/fury-icon-christmas.png';
const ART='assets/launcher-themes/christmas-row.png';
const PROTECTED_CONTENT=new Set(['input','select','textarea','img','svg','canvas','video','iframe']);
const SKIPPED_CONTENT=new Set(['script','style','link','template','noscript']);

function normalizePreferences(value){
    const input=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
    const result={theme:input.theme==='christmas'?'christmas':'none'};
    for(const key of ['snow','edges','lights','trail'])result[key]=typeof input[key]==='boolean'?input[key]:DEFAULTS[key];
    return result;
}

function readPreferences(storage){
    try{
        const saved=storage.getItem(STORAGE_KEY);
        // Invalid saved data stays off; only a missing entry uses the default.
        return saved===null?{...DEFAULTS}:normalizePreferences(JSON.parse(saved));
    }
    catch{return normalizePreferences(null);}
}

function canAnimate({theme,focused,visible,motion,reduced,disposed}){
    return !disposed&&theme==='christmas'&&focused&&visible&&motion==='full'&&!reduced;
}

function isClear(x,y,size,rects){
    const radius=size/2;
    for(const r of rects)if(x+radius>=r.left&&x-radius<=r.right&&y+radius>=r.top&&y-radius<=r.bottom)return false;
    return true;
}

function mount({document,notify=()=>{}}){
    const view=document.defaultView,root=document.documentElement,storage=view.localStorage;
    const {ipcRenderer}=require('electron');
    const host=document.getElementById('seasonal-themes');
    if(!host)return{dispose(){}};
    const inputs=[...host.querySelectorAll('input[name="fury-seasonal-theme"]')];
    const options=Object.fromEntries(['snow','edges','lights','trail'].map(key=>[key,document.getElementById('seasonal-'+key)]));
    const reduced=view.matchMedia('(prefers-reduced-motion: reduce)');
    const logos=[...document.querySelectorAll('.ds-brand .fury-mark img,.da-server-icon')].map(node=>({node,src:node.getAttribute('src')}));
    const listeners=[];
    let settings=readPreferences(storage),disposed=false,focused=document.hasFocus(),nativeActive=false,frame=0,lastTime=0;
    let layer=null,canvas=null,context=null,sprite=null,spriteColor='',dialog=null,previewTrigger=null;
    let width=0,height=0,pixelRatio=0,geometryDirty=true,observing=false,protectedRects=[],snow=[];
    let lastPointerTime=-Infinity,lastPointerX=null,lastPointerY=null,trailIndex=0;
    const trails=Array.from({length:8},()=>({born:-Infinity,x:0,y:0,dx:0,size:0}));
    const random=(min,max)=>min+Math.random()*(max-min);
    const active=()=>canAnimate({theme:settings.theme,focused:nativeActive&&focused&&document.hasFocus(),visible:!document.hidden,motion:root.dataset.motion,reduced:reduced.matches,disposed});
    const listen=(target,event,callback,options)=>{target.addEventListener(event,callback,options);listeners.push(()=>target.removeEventListener(event,callback,options));};
    const observer=new view.MutationObserver(records=>{
        // Canvas drawing changes no DOM. Ignore our own decorative descendants.
        if(records.some(record=>!layer?.contains(record.target)))invalidate();
    });

    function createLayer(){
        if(layer)return;
        layer=document.createElement('div');layer.className='fury-seasonal-layer';layer.setAttribute('aria-hidden','true');
        canvas=document.createElement('canvas');canvas.className='fury-seasonal-canvas';canvas.width=canvas.height=0;layer.append(canvas);
        const lights=document.createElement('div');lights.className='fury-seasonal-lights';
        const colors=['#f3c64e','#d7edf4','#dc756a','#f3c64e','#76b198'];
        for(let i=0;i<20;i++){const light=document.createElement('i');light.style.setProperty('--bulb',colors[i%colors.length]);lights.append(light);}
        const bank=document.createElement('div');
        bank.innerHTML='<svg class="fury-seasonal-bank" viewBox="0 0 1200 90" preserveAspectRatio="none"><path class="back" d="M0 43C40 42 58 5 110 9S171 55 238 54C285 54 299 34 349 38S447 69 521 64C586 59 602 41 665 45S757 65 817 57C874 49 887 13 942 19S1005 54 1065 50C1121 46 1153 13 1200 23V90H0Z"/><path d="M0 60C72 75 93 40 165 45S272 77 351 69C425 61 449 50 510 59S614 82 694 71C774 60 801 67 864 73S967 40 1030 45C1100 51 1137 75 1200 58V90H0Z"/></svg>';
        layer.append(lights,bank.firstElementChild);document.body.append(layer);
        context=canvas.getContext('2d');
    }

    function makeSprite(){
        const color=['light','frost'].includes(root.dataset.theme)?'#8fa8b8':'#dfedf7';
        if(sprite&&spriteColor===color)return;
        spriteColor=color;sprite=document.createElement('canvas');sprite.width=sprite.height=40;
        const ctx=sprite.getContext('2d');ctx.translate(20,20);ctx.strokeStyle=color;ctx.lineWidth=2;ctx.lineCap='round';
        ctx.beginPath();
        for(let i=0;i<6;i++){
            const angle=i*Math.PI/3,c=Math.cos(angle),s=Math.sin(angle);
            ctx.moveTo(0,0);ctx.lineTo(c*16,s*16);
            for(const side of [-1,1]){ctx.moveTo(c*10,s*10);ctx.lineTo(c*10-Math.cos(angle+side*.65)*6,s*10-Math.sin(angle+side*.65)*6);}
        }
        ctx.stroke();
    }

    function measureGeometry(){
        geometryDirty=false;
        const nextWidth=view.innerWidth,nextHeight=view.innerHeight,nextRatio=Math.min(view.devicePixelRatio||1,2);
        if(width!==nextWidth||height!==nextHeight||pixelRatio!==nextRatio||!canvas.width){
            width=nextWidth;height=nextHeight;pixelRatio=nextRatio;
            canvas.width=Math.round(width*pixelRatio);canvas.height=Math.round(height*pixelRatio);
            context.setTransform(pixelRatio,0,0,pixelRatio,0,0);
            // Similar density to the approved mockup, bounded even on large displays.
            snow=Array.from({length:Math.max(32,Math.min(110,Math.round(width*height/16000)))},()=>({
                x:random(0,width),y:random(0,height),size:random(2.5,7),speed:random(14,30),phase:random(0,Math.PI*2),alpha:random(.35,.8)
            }));
        }
        makeSprite();
        // Protect content, not the entire surface containing it. In particular,
        // wide clickable rows are buttons too: their empty space should show snow.
        const rects=[],stack=[document.body],range=document.createRange();
        const protect=(r,padding)=>{
            if(r.width>0&&r.height>0&&r.right>0&&r.left<width&&r.bottom>0&&r.top<height)
                rects.push({left:r.left-padding,right:r.right+padding,top:r.top-padding,bottom:r.bottom+padding});
        };
        while(stack.length){
            const node=stack.pop(),tag=node.localName;
            if(node===layer||SKIPPED_CONTENT.has(tag))continue;
            const boxes=node.getClientRects();
            // Prune hidden pages once; display:contents must retain its children.
            if(!boxes.length&&view.getComputedStyle(node).display==='none')continue;
            // Chromium can lay out a collapsed details subtree when its bounds
            // are queried. Only its first summary is visible; never measure the
            // hidden card controls/text beneath it.
            if(tag==='details'&&!node.open){
                for(const child of node.children)if(child.localName==='summary'){stack.push(child);break;}
                continue;
            }
            const bounds=boxes[0];
            const compactControl=(tag==='button'||tag==='summary')&&bounds&&bounds.width<=240&&bounds.height<=52;
            if(PROTECTED_CONTENT.has(tag)||compactControl||node.matches('dialog[open],[contenteditable="true"],#proxy-state')){
                for(const r of boxes)protect(r,3);
                continue;
            }
            for(const child of node.childNodes){
                if(child.nodeType===1)stack.push(child);
                else if(child.nodeType===3&&child.textContent.trim()){
                    range.selectNodeContents(child);
                    for(const r of range.getClientRects())protect(r,2);
                }
            }
        }
        protectedRects=rects;
    }

    function drawFlake(x,y,size,alpha){
        if(!isClear(x,y,size,protectedRects))return;
        context.globalAlpha=alpha;context.drawImage(sprite,x-size/2,y-size/2,size,size);
    }

    function tick(now){
        frame=0;
        if(!active()){syncMotion();return;}
        if(geometryDirty)measureGeometry();
        const dt=lastTime?Math.min((now-lastTime)/1000,.05):0;lastTime=now;
        context.clearRect(0,0,width,height);
        if(settings.snow){
            for(const flake of snow){
                flake.y+=flake.speed*dt;flake.x+=Math.sin(now/2300+flake.phase)*7*dt;
                if(flake.y>height+7){flake.y=-7;flake.x=random(0,width);}
                if(flake.x>width+7)flake.x=-7;if(flake.x<-7)flake.x=width+7;
                drawFlake(flake.x,flake.y,flake.size,flake.alpha);
            }
        }
        let trailLive=false;
        if(settings.trail)for(const trail of trails){
            const age=(now-trail.born)/700;
            if(age<0||age>=1)continue;
            trailLive=true;drawFlake(trail.x+trail.dx*age,trail.y+8*age,trail.size*(1-.45*age),.5*(1-age));
        }
        context.globalAlpha=1;
        // No continuously running JS when only static decorations/lights remain.
        if(settings.snow||trailLive)frame=view.requestAnimationFrame(tick);
    }

    function ensureFrame(){if(!frame&&active()&&(settings.snow||settings.trail))frame=view.requestAnimationFrame(tick);}
    function invalidate(){geometryDirty=true;ensureFrame();}
    function clearTrails(){for(const trail of trails)trail.born=-Infinity;lastPointerX=lastPointerY=null;lastPointerTime=-Infinity;}
    function stopMotion(){
        if(frame)view.cancelAnimationFrame(frame);frame=0;lastTime=0;clearTrails();
        if(context)context.clearRect(0,0,width,height);
        if(observing){observer.disconnect();observing=false;}
        if(root.dataset.seasonalMotion!=='paused')root.dataset.seasonalMotion='paused';
    }

    function syncMotion(){
        if(disposed)return;
        if(!active())stopMotion();
        else{
            if(root.dataset.seasonalMotion!=='running')root.dataset.seasonalMotion='running';
            if((settings.snow||settings.trail)&&!observing){
                observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','open']});observing=true;
            }else if(!settings.snow&&!settings.trail&&observing){observer.disconnect();observing=false;}
            if(!settings.snow&&!settings.trail){if(frame)view.cancelAnimationFrame(frame);frame=0;context?.clearRect(0,0,width,height);}
            invalidate();
        }
        const motionNote=document.getElementById('seasonal-motion-note');
        const hidden=settings.theme!=='christmas'||(root.dataset.motion==='full'&&!reduced.matches);
        if(motionNote.hidden!==hidden)motionNote.hidden=hidden;
        const message=reduced.matches?'Your system’s reduced-motion setting keeps falling snow and mouse trails off.':'Turn on Animations to see falling snow and mouse trails.';
        if(motionNote.textContent!==message)motionNote.textContent=message;
    }

    function renderControls(){
        for(const input of inputs)input.checked=input.value===settings.theme;
        for(const [key,input]of Object.entries(options))input.checked=settings[key];
        document.getElementById('seasonal-options').hidden=settings.theme!=='christmas';
        document.getElementById('seasonal-focus-note').hidden=settings.theme!=='christmas';
    }

    function apply(patch,persist=true){
        if(disposed)return false;
        const next=normalizePreferences({...settings,...patch});
        if(persist)try{storage.setItem(STORAGE_KEY,JSON.stringify(next));}
        catch{renderControls();notify('Couldn’t save theme','Try selecting the theme again.','error');return false;}
        settings=next;renderControls();
        root.dataset.seasonalTheme=settings.theme;
        for(const key of ['snow','edges','lights','trail'])root.dataset['seasonal'+key[0].toUpperCase()+key.slice(1)]=String(settings[key]);
        for(const logo of logos){const src=settings.theme==='christmas'?LOGO:logo.src;if(logo.node.getAttribute('src')!==src)logo.node.setAttribute('src',src);}
        clearTrails();
        if(settings.theme==='christmas'){createLayer();layer.hidden=false;}
        else if(layer){layer.hidden=true;stopMotion();canvas.width=canvas.height=0;snow=[];protectedRects=[];}
        geometryDirty=true;syncMotion();return true;
    }

    function pointerMove(event){
        if(!active()||!settings.trail||event.pointerType==='touch')return;
        const now=view.performance.now();if(now-lastPointerTime<75)return;
        const x=event.clientX,y=event.clientY;
        if(geometryDirty){ensureFrame();return;}
        if(lastPointerX!==null&&Math.hypot(x-lastPointerX,y-lastPointerY)<10)return;
        if(!isClear(x,y,10,protectedRects))return;
        lastPointerTime=now;lastPointerX=x;lastPointerY=y;
        const trail=trails[trailIndex];trailIndex=(trailIndex+1)%trails.length;
        trail.born=now;trail.x=x;trail.y=y;trail.dx=random(-4,4);trail.size=random(8,10);ensureFrame();
    }

    function openPreview(event){
        if(!dialog){
            dialog=document.createElement('dialog');dialog.className='fury-seasonal-dialog';dialog.setAttribute('aria-labelledby','seasonal-dialog-title');
            dialog.innerHTML='<img src="'+ART+'" alt="A pale pixel-art pine forest with white snowdrifts and a small tree with Christmas lights."><div class="fury-seasonal-dialog-copy"><h2 id="seasonal-dialog-title">Christmas</h2><p>A quiet winter scene, soft snowfall, warm lights and a little snowflake trail.</p><div class="fury-seasonal-dialog-actions"><button type="button" data-seasonal-close>Close</button><button type="button" class="primary" data-seasonal-use>Use Christmas</button></div></div>';
            document.body.append(dialog);
            listen(dialog.querySelector('[data-seasonal-close]'),'click',()=>dialog.close());
            listen(dialog.querySelector('[data-seasonal-use]'),'click',()=>{if(apply({theme:'christmas'}))dialog.close();});
            listen(dialog,'close',()=>previewTrigger?.focus());
            listen(dialog,'click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
        }
        previewTrigger=event.currentTarget;if(!dialog.open)dialog.showModal();invalidate();
    }

    function dispose(){
        if(disposed)return;
        stopMotion();disposed=true;listeners.splice(0).forEach(remove=>remove());
        observer.disconnect();if(dialog?.open)dialog.close();dialog?.remove();layer?.remove();
        if(canvas)canvas.width=canvas.height=0;
        for(const logo of logos)logo.node.setAttribute('src',logo.src);
        for(const key of ['seasonalTheme','seasonalSnow','seasonalEdges','seasonalLights','seasonalTrail','seasonalMotion'])delete root.dataset[key];
        snow=[];protectedRects=[];sprite=null;
    }

    for(const input of inputs)listen(input,'change',()=>{if(input.checked&&apply({theme:input.value}))notify('Theme updated',input.value==='christmas'?'Christmas effects are on.':'Seasonal effects are off.','success');});
    for(const [key,input]of Object.entries(options))listen(input,'change',()=>apply({[key]:input.checked}));
    listen(document.getElementById('seasonal-preview'),'click',openPreview);
    listen(view,'focus',()=>{focused=true;syncMotion();});listen(view,'blur',()=>{focused=false;syncMotion();});
    let activityRevision=0;
    const setWindowActivity=value=>{nativeActive=value===true;if(nativeActive)focused=document.hasFocus();syncMotion();};
    const onWindowActivity=(_event,value)=>{activityRevision++;setWindowActivity(value);};
    ipcRenderer.on('window:activity',onWindowActivity);listeners.push(()=>ipcRenderer.removeListener('window:activity',onWindowActivity));
    // Subscribe first; an old initial reply must not undo a newer focus event.
    const initialRevision=activityRevision;
    ipcRenderer.invoke('window:activity:get').then(value=>{
        if(!disposed&&activityRevision===initialRevision)setWindowActivity(value);
    }).catch(()=>{});
    listen(document,'visibilitychange',syncMotion);listen(reduced,'change',syncMotion);
    listen(view,'fury:motion-change',syncMotion);listen(view,'fury:theme-change',invalidate);listen(view,'fury:sidebar-change',invalidate);
    listen(view,'resize',invalidate);listen(document,'scroll',invalidate,{capture:true,passive:true});
    listen(document,'fury-settings-view-changed',()=>{clearTrails();invalidate();});
    listen(document,'animationend',invalidate);listen(document,'transitionend',invalidate);
    listen(view,'pointermove',pointerMove,{passive:true});listen(document,'pointerleave',()=>{lastPointerX=lastPointerY=null;});
    listen(view,'pagehide',dispose,{once:true});
    apply(settings,false);
    return{apply,dispose};
}

module.exports={mount,normalizePreferences,readPreferences,canAnimate,isClear,STORAGE_KEY};
