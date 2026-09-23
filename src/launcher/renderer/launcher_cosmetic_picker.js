'use strict';

function mount({document,input,getField}) {
    const win=document.defaultView;
    const popup=document.createElement('div');
    popup.className='denick-cosmetic-picker';popup.hidden=true;
    const heading=document.createElement('div');heading.className='denick-picker-heading';
    const list=document.createElement('div');list.id='denick-cosmetic-options';list.className='denick-picker-list';list.setAttribute('role','listbox');list.setAttribute('aria-label','Cosmetics');
    popup.append(heading,list);document.body.append(popup);
    input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','false');
    let options=[],active=-1;
    function close(){popup.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;}
    function position(){
        const r=input.getBoundingClientRect(),below=win.innerHeight-r.bottom-12,above=r.top-12;
        const height=Math.min(340,Math.max(below,above));
        popup.style.width=`${Math.min(r.width,win.innerWidth-24)}px`;
        popup.style.left=`${Math.max(12,Math.min(r.left,win.innerWidth-r.width-12))}px`;
        popup.style.maxHeight=`${height}px`;
        popup.style.top=below>=Math.min(340,above)?`${r.bottom+6}px`:'auto';
        popup.style.bottom=below>=Math.min(340,above)?'auto':`${win.innerHeight-r.top+6}px`;
    }
    function highlight(index){
        active=index;
        [...list.querySelectorAll('[role="option"]')].forEach((row,i)=>row.setAttribute('aria-selected',String(i===active)));
        const row=list.querySelectorAll('[role="option"]')[active];
        if(row){input.setAttribute('aria-activedescendant',row.id);row.scrollIntoView({block:'nearest'});}
    }
    function choose(index){
        const option=options[index];if(!option)return;
        input.value=option.name;close();input.dispatchEvent(new win.Event('change',{bubbles:true}));input.focus();
    }
    function open(search=false){
        if(input.matches(':disabled'))return;
        const field=getField();if(!field)return;
        const query=search?input.value.trim().toLowerCase():'';
        options=(field.options||[]).filter(option=>!query||`${option.name} ${option.apiValue}`.toLowerCase().includes(query));
        heading.textContent=`${field.label} \u00b7 ${options.length} option${options.length===1?'':'s'}`;
        list.replaceChildren();
        let group='';
        options.forEach((option,index)=>{
            const next=option.common?'Common choices':'Cosmetics';
            if(next!==group){const label=document.createElement('div');label.className='denick-picker-group';label.textContent=next;list.append(label);group=next;}
            const row=document.createElement('div');row.className='denick-picker-option';row.id=`denick-cosmetic-option-${index}`;row.setAttribute('role','option');
            const name=document.createElement('span');name.textContent=option.name;row.append(name);
            if(option.description){const description=document.createElement('small');description.textContent=option.description;row.append(description);}
            row.addEventListener('pointerdown',event=>{event.preventDefault();choose(index);});
            list.append(row);
        });
        if(!options.length){const empty=document.createElement('div');empty.className='denick-picker-empty';empty.textContent='No matches. You can still add the name you typed.';list.append(empty);}
        popup.hidden=false;input.setAttribute('aria-expanded','true');position();highlight(options.length?0:-1);
    }
    input.addEventListener('click',()=>open(false));
    input.addEventListener('input',()=>open(true));
    input.addEventListener('keydown',event=>{
        if(event.key==='Escape'){close();event.stopImmediatePropagation();return;}
        if(event.key==='Tab'){close();return;}
        if(event.key==='ArrowDown'||event.key==='ArrowUp'){
            event.preventDefault();event.stopImmediatePropagation();
            if(popup.hidden){open(false);if(event.key==='ArrowUp')highlight(options.length-1);}
            else if(options.length)highlight((active+(event.key==='ArrowDown'?1:-1)+options.length)%options.length);
        }else if(event.key==='Enter'&&!popup.hidden&&active>=0){event.preventDefault();event.stopImmediatePropagation();choose(active);}
    },true);
    document.addEventListener('pointerdown',event=>{if(event.target!==input&&!popup.contains(event.target))close();});
    input.addEventListener('blur',close);
    win.addEventListener('resize',close);
    win.addEventListener('scroll',event=>{if(!popup.contains(event.target))close();},true);
    return {close,refresh:close,selected:()=>{
        const text=input.value.trim().toLowerCase();
        return (getField()?.options||[]).find(option=>option.name.toLowerCase()===text||String(option.apiValue).toLowerCase()===text)||null;
    }};
}
module.exports={mount};
