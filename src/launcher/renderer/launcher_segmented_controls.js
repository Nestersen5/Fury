// One moving backdrop; original controls retain their events and keyboard behavior.
function mount(document) {
    const selector = '.fury-sidebar-choice-buttons,.fury-binary-choice,.scan-mode-buttons,.scan-mode-options,.fury-field-tabs,.fury-recap-tabs,.ia-audience-tabs,.fury-ingame-tabs,.tablist-mode-switch,.nametag-preview-mode,.denick-advanced-switch';
    const view = document.defaultView, groups = new Map();
    const style = document.createElement('style');
    style.textContent = `
      .fury-sliding-group {position:relative!important;isolation:isolate;}
      /* Every slider uses connected segments; the container clips the outer corners. */
      html.fury-redesign.fury-settings-roomy .fury-sliding-group.fury-sliding-group {padding:0!important;gap:0!important;overflow:hidden!important;align-items:stretch!important;}
      html.fury-redesign.fury-settings-roomy .fury-sliding-group.fury-sliding-group >:is(button,.fury-binary-off,.fury-binary-on) {flex:1;align-self:stretch!important;height:auto!important;margin:0!important;border:0!important;border-radius:0!important;}
      html.fury-redesign.fury-settings-roomy .fury-sliding-group >button:focus-visible {outline-offset:-3px!important;}
      html.fury-redesign.fury-settings-roomy .fury-sliding-group >.fury-slider-option.fury-slider-option.fury-slider-option {position:relative;z-index:1;background:transparent!important;transition-property:color,border-color,box-shadow!important;}
      .fury-slider-highlight {position:absolute!important;display:block!important;pointer-events:none!important;z-index:0;box-sizing:border-box;}
    `;
    document.head.append(style);
    let scheduled = false;
    const observer = new view.MutationObserver(schedule);
    const options = {subtree:true,childList:true,attributes:true,attributeFilter:['class','aria-selected','aria-pressed','data-motion','data-theme','data-accent','data-sidebar']};
    const resize = new view.ResizeObserver(schedule);
    function schedule() {
        if (scheduled) return;
        scheduled = true;
        view.requestAnimationFrame(sync);
    }
    function sync() {
        scheduled = false;
        observer.disconnect();
        const motion = document.documentElement.dataset.motion === 'full' && !view.matchMedia('(prefers-reduced-motion: reduce)').matches;
        for (const [group, state] of groups) if (!group.isConnected) {resize.unobserve(group);state.animation?.cancel();groups.delete(group);}
        for (const group of document.querySelectorAll(selector)) {
            let state = groups.get(group);
            if (!state) {
                const highlight = document.createElement('i');
                highlight.className = 'fury-slider-highlight';highlight.setAttribute('aria-hidden','true');
                group.append(highlight);group.classList.add('fury-sliding-group');
                state = {highlight};groups.set(group,state);resize.observe(group);
            }
            const items = [...group.children].filter(item => item.matches('button,.fury-binary-off,.fury-binary-on'));
            const input = group.querySelector('input[type="checkbox"]');
            const selected = input ? group.querySelector(input.checked ? '.fury-binary-on' : '.fury-binary-off') : items.find(item => item.classList.contains('active') || item.getAttribute('aria-selected') === 'true' || item.getAttribute('aria-pressed') === 'true');
            if (!selected || !group.getClientRects().length) {state.highlight.hidden = true;state.highlight.style.visibility='hidden';state.previous=null;continue;}
            const transitions = items.map(item=>[item.style.getPropertyValue('transition'),item.style.getPropertyPriority('transition')]);
            items.forEach(item=>{item.style.setProperty('transition','none','important');item.classList.remove('fury-slider-option');});
            // Read the theme's actual selected fill, including the neutral Off state.
            const computed = view.getComputedStyle(selected);
            const fill = computed.backgroundColor, radius = computed.borderRadius;
            const rect = selected.getBoundingClientRect(), parent = group.getBoundingClientRect();
            const next = {x:rect.left-parent.left-group.clientLeft,y:rect.top-parent.top-group.clientTop,w:rect.width,h:rect.height};
            next.leftPercent=next.x/group.clientWidth*100;
            next.widthPercent=next.w/group.clientWidth*100;
            const previous = state.previous;
            if (!motion) state.animation?.cancel();
            if (previous && selected !== state.selected && motion) {
                const current = state.highlight.getBoundingClientRect();
                const currentFill = view.getComputedStyle(state.highlight).backgroundColor;
                const running = state.animation?.playState === 'running';
                const fromLeft = running ? (current.left-parent.left-group.clientLeft)/group.clientWidth*100 : previous.leftPercent;
                const fromWidth = running ? current.width/group.clientWidth*100 : previous.widthPercent;
                state.animation?.cancel();
                state.animation = state.highlight.animate([
                    {left:`${fromLeft}%`,width:`${fromWidth}%`,backgroundColor:currentFill},
                    {left:`${next.leftPercent}%`,width:`${next.widthPercent}%`,backgroundColor:fill}
                ],{duration:input?260:240,easing:'cubic-bezier(.2,.65,.3,1)'});
            }
            Object.assign(state.highlight.style,{visibility:'visible',left:`${next.x}px`,top:`${next.y}px`,width:`${next.w}px`,height:`${next.h}px`,background:fill,borderRadius:radius,transformOrigin:'top left'});
            state.highlight.hidden=false;
            items.forEach(item=>item.classList.add('fury-slider-option'));
            // Commit the transparent button surface before restoring transitions.
            // Only the shared backdrop should paint or animate the selection fill.
            view.getComputedStyle(selected).backgroundColor;
            items.forEach((item,index)=>{const [value,priority]=transitions[index];if(value)item.style.setProperty('transition',value,priority);else item.style.removeProperty('transition');});
            state.previous=next;state.selected=selected;
        }
        observer.observe(document.documentElement,options);
    }
    document.addEventListener('change',schedule,true);
    document.addEventListener('click',schedule,true);
    view.addEventListener('resize',schedule);
    view.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',schedule);
    sync();
}
module.exports = {mount};
