'use strict';

// The exported image and launcher preview share this renderer. Bitmap glyph
// advances determine every column; no padded labels or fixed-value gutters.
const {MINECRAFT_STAR_SYMBOL}=require('../../stats/format');
const COLORS = { gold: '#ffbf16', pink: '#ef36e9', red: '#ff3636', cyan: '#00e4ed', green: '#36f451', text: '#d1d2d5', white: '#f4f4f4' };
const {getWlrColor,getFkdrColor,getKdrColor}=require('../../stats/colors');
const RATIO_COLORS={wlr:getWlrColor,fkdr:getFkdrColor,kdr:getKdrColor,bblr:()=> 'e'};
const MINECRAFT_COLORS={'7':'#aaaaaa',a:'#55ff55','2':'#00aa00',e:'#ffff55','6':'#ffaa00','4':'#aa0000'};
function entryColor(mode,key,fallback){
    if(['wins','finals','kills','beds'].includes(key))return '#55ff55';
    if(['losses','finalDeaths','deaths','bedsLost'].includes(key))return '#ff5555';
    if(mode.mode!=='BEDWARS'||!RATIO_COLORS[key])return fallback;
    return MINECRAFT_COLORS[RATIO_COLORS[key](number(mode[key])).slice(-1)]||fallback;
}
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const count = value => number(value).toLocaleString('en-US');
const duration = value => { const min = Math.floor(number(value) / 60000); return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : min ? `${min}m` : `${Math.floor(number(value) / 1000)}s`; };
const date = value => new Date(value).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
const time = value => new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
function relativeDate(value, now = new Date()) {
    const start = new Date(value), today = new Date(now);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(today.getTime())) return '';
    // Compare local calendar dates in UTC so daylight-saving changes don't lose a day.
    const from = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    const to = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    if (from >= to) return from === to ? '(today)' : '';
    let months = (today.getFullYear() - start.getFullYear()) * 12 + today.getMonth() - start.getMonth();
    const anniversary = offset => {
        const lastDay = new Date(Date.UTC(start.getFullYear(), start.getMonth() + offset + 1, 0)).getUTCDate();
        return Date.UTC(start.getFullYear(), start.getMonth() + offset, Math.min(start.getDate(), lastDay));
    };
    if (anniversary(months) > to) months--;
    const days = Math.round((to - anniversary(months)) / 86400000);
    const parts = [];
    if (months) parts.push(`${months} month${months === 1 ? '' : 's'}`);
    if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`);
    return `(${parts.join(' ')} ago)`;
}
let fontPromise;
const images = new Map();
function loadImage(src) {
    if (!images.has(src)) images.set(src, new Promise(resolve => {
        const img = new Image(); img.crossOrigin = 'anonymous';
        const timer = setTimeout(() => resolve(null), 2200);
        img.onload = () => { clearTimeout(timer); resolve(img); };
        img.onerror = () => { clearTimeout(timer); resolve(null); };
        img.src = src;
    }));
    return images.get(src);
}
async function font() {
    if (!fontPromise) fontPromise = loadImage('assets/session-card-font.png').then(img => {
        if (!img) throw new Error('The session card font could not be loaded.');
        const atlas = document.createElement('canvas'); atlas.width = atlas.height = 128;
        const ctx = atlas.getContext('2d'); ctx.drawImage(img, 0, 0);
        const pixels = ctx.getImageData(0, 0, 128, 128).data;
        const widths = Array.from({ length: 256 }, (_, code) => {
            if (code === 32) return 3;
            let edge = 0;
            for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
                if (pixels[(((code >> 4) * 8 + y) * 128 + (code % 16) * 8 + x) * 4 + 3] > 20) edge = Math.max(edge, x + 1);
            }
            return edge || 5;
        });
        return { atlas, widths, tinted: new Map() };
    });
    return fontPromise;
}
function stats(mode, fields) {
    const defs = [
        ['wins','Wins','green'], ['losses','Losses','white'], ['finals','Final kills','pink'], ['finalDeaths','Final deaths','white'],
        ['kills','Kills','pink'], ['deaths','Deaths','white'], ['beds','Beds broken','red'], ['bedsLost','Beds lost','white'], ['assists','Assists','pink'],
        ['wlr','WLR','gold'], ['fkdr','FKDR','gold'], ['kdr','KDR','gold'], ['bblr','BBLR','gold'], ['games','Games','green'], ['stars','Stars gained','cyan'], ['localStreak','Local streak','gold']
    ];
    return defs.filter(([key]) => key in mode && (!mode.local || (key!=='stars' && Number.isFinite(mode[key]))) && (!Array.isArray(fields) || fields.includes(key))).map(([key,label,color]) => ({ key, label, color: entryColor(mode,key,COLORS[color]), value: ['wlr','fkdr','kdr','bblr','stars'].includes(key) ? `${key === 'stars' ? '+' : ''}${number(mode[key]).toFixed(2)}` : count(mode[key]) }));
}
async function render(session, { mode: requestedMode, submode = 'overall', fields, avatar = true, skinAccount = session } = {}) {
    const f = await font();
    const symbols=await loadImage('assets/session-card-symbols.png');
    const overall = session.modes?.find(item => item.mode === requestedMode) || session.modes?.[0] || { label: 'Session', mode: 'SESSION' };
    const selected = overall.submodes?.find(item => item.id === submode);
    const calendar=session.calendar;
    const periodTitle=calendar?calendar.kind[0].toUpperCase()+calendar.kind.slice(1):'Session';
    const mode = selected ? { ...selected, label: `${overall.label} - ${selected.label}`, breakdown: overall.breakdown, ...('stars' in overall ? {stars: overall.stars} : {}) } : overall;
    const entries = stats(mode, mode.local ? undefined : fields);
    if(selected)entries.forEach(entry=>{if(entry.key==='stars')entry.label=calendar?'Full period stars':'Full session stars';if(entry.key==='games')entry.label=`${selected.label} games`;});
    const advance = (text, scale = 2) => [...String(text)].reduce((sum,c) => sum + (c===MINECRAFT_STAR_SYMBOL?8.5:((f.widths[c.charCodeAt(0)] || 5) + 1)) * scale, 0);
    const labelValue = entry => `${entry.label}: ${entry.value}`;
    const ratios = entries.filter(item => ['wlr','fkdr','kdr','bblr'].includes(item.key));
    const totals = entries.filter(item => !['wlr','fkdr','kdr','bblr','stars','games'].includes(item.key));
    const left = totals.filter(item => !['losses','finalDeaths','deaths','bedsLost'].includes(item.key));
    const right = totals.filter(item => ['losses','finalDeaths','deaths','bedsLost'].includes(item.key));
    const middle = Math.max(left.length, right.length);
    const widthOf = list => Math.max(0, ...list.map(e => advance(labelValue(e)))) + 22;
    const avatarWidth = avatar ? Math.max(128, advance(session.name || 'Unknown account') + 24) : 0;
    const showChart = !Array.isArray(fields) || !fields.includes('hideGamesByMode');
    const calendarChart=calendar?.chart;
    const monthly=calendar?.kind==='monthly';
    const breakdown = showChart ? calendarChart ? {total:mode.games,entries:calendarChart.entries.map(day=>{
        const dayMode=day.modes.find(m=>m.mode===mode.mode);
        const value=selected?(dayMode?.submodes?.find(m=>m.id===selected.id)||(dayMode?.submodes?.length?{games:0}:undefined)):dayMode;
        return {...day,games:Number.isFinite(value?.games)?value.games:0,unavailableValue:!day.future&&(!value||!Number.isFinite(value.games))};
    }),note:''} : require('../../session/modeBreakdown').displayBreakdown(mode.mode, mode.breakdown) : {entries:[]};
    const chartTitle=calendarChart?(monthly?'Daily activity':'Games by day'):'Games by mode';
    const labels={eight_one:'Solos',eight_two:'Doubles',four_three:'Threes',four_four:'Fours',two_four:'4v4'};
    const compactSkywars = mode.mode === 'SKYWARS';
    const bars = (breakdown.entries || []).filter(entry=>calendarChart||!compactSkywars||entry.games>0).map(entry=>({...entry,label:labels[entry.id]||entry.label}));
    const wideChart = showChart && !calendarChart && bars.length > 5;
    const tileWidth = Math.max(108, ...ratios.map(e => advance(e.value) + 28));
    const totalWidth = Math.max(340, widthOf(left) + (right.length ? widthOf(right) : 0), ratios.length * tileWidth + 28);
    const chartWidth = calendarChart?Math.max(420,advance(chartTitle)+advance(`${count(breakdown.total)} games`)+52):Math.max(compactSkywars?260:340, advance('Games by mode') + advance(`${count(breakdown.total)} games`) + 52, 28 + bars.length * Math.max(88, ...bars.flatMap(e => e.label.split(' ').map(word => advance(word) + 12))));
    const title = session.name || 'Unknown account';
    const finishedAt=session.endedAt||session.lastSeen,finishedDay=new Date(finishedAt);
    const crossesMidnight=finishedDay.toDateString()!==new Date(session.startedAt).toDateString();
    const finishedText=`${crossesMidnight?`${finishedDay.toLocaleDateString('en-US',{month:'short',day:'numeric'})}, `:''}${time(finishedAt)}`;
    const timeline = calendar?`${calendar.sessionIds.length} sessions - ${duration(session.durationMs)} tracked - ${calendar.activeDays} active days`:`${selected?'Full session - ':''}Started: ${time(session.startedAt)}   ${session.active ? 'Live' : `Finished: ${finishedText}`}   Duration: ${duration(session.durationMs)}`;
    const dateText = calendar?`${calendar.label.replace(/\u2013/g,'-')} - ${calendar.timeZone}`:date(session.startedAt), ageText = calendar?'':relativeDate(session.startedAt);
    const cardTitle=`${mode.label.toUpperCase()} ${periodTitle.toUpperCase()}`;
    const dateLine = `${dateText}${ageText ? `  ${ageText}` : ''}`;
    const localStatus = 'Local tracking - API off';
    const localDetail = mode.unavailable?.length ? 'Incomplete coverage - uncertain stats hidden' : 'Local streak counts consecutive observed wins';
    const emptyLocal = 'No verified counters available';
    const wrapLabel=(label,max)=>{
        const result=[];let line='';
        for(const word of label.split(' ')){
            if(line&&advance(line+' '+word)>max){result.push(line);line='';}
            for(const char of (line?' ':'')+word){if(advance(line+char)>max){result.push(line);line='';}line+=char;}
        }
        if(line)result.push(line);return result;
    };
    const width = Math.max(avatarWidth + totalWidth + (!showChart || wideChart ? 0 : chartWidth + 10) + 46, wideChart ? 1120 : 0,
        advance(timeline) + 52, advance(dateLine) + 52, advance(title, 3) + advance(cardTitle) + 70,
        mode.local ? avatarWidth + Math.max(advance(localDetail), advance(emptyLocal)) + 52 : 0);
    const rowHeight = compactSkywars?24:28;
    const statsHeight = Math.max(compactSkywars?106:130, middle * rowHeight + 54) + (ratios.length ? 110 : 0);
    const chartColumns=wideChart?Math.min(10,bars.length):Math.max(1,bars.length);
    const chartCell=((wideChart?width-24:chartWidth)-28)/chartColumns;
    const chartLabelLines=Math.max(1,...bars.map(e=>wrapLabel(e.label,chartCell-8).length));
    const chartRowHeight=Math.max(234,180+chartLabelLines*18);
    const footerHeight = (mode.local?108:entries.some(e => e.key === 'stars')?82:54)+(calendar?22:0);
    const bodyHeight = Math.max(monthly&&showChart?340:0,avatar ? (compactSkywars?210:238) : 160, statsHeight, !showChart || wideChart ? 0 : Math.max(compactSkywars?220:260,(compactSkywars?154:194)+chartLabelLines*18+(breakdown.note?26:0)));
    const chartRows = Math.ceil(bars.length / 10) || 1;
    const chartHeight = 60 + chartRows * chartRowHeight + (breakdown.note ? 26 : 0);
    const height = 136 + bodyHeight + (wideChart ? chartHeight + 10 : 0) + 10 + footerHeight + 12;
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(width); canvas.height = Math.ceil(height);
    canvas.setAttribute('aria-label', `${title}, ${mode.label} ${periodTitle.toLowerCase()}, ${dateLine}, ${timeline}. ${entries.map(labelValue).join(', ')}`);
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
    const box = (x,y,w,h,color='#101113',radius=9) => { ctx.fillStyle=color; ctx.beginPath(); ctx.roundRect(x,y,w,h,radius); ctx.fill(); };
    const text = (value,x,y,color=COLORS.text,scale=2) => {
        x=Math.round(x);y=Math.round(y);
        if (!f.tinted.has(color)) { const tint = document.createElement('canvas'); tint.width=tint.height=128; const tc=tint.getContext('2d');tc.drawImage(f.atlas,0,0);tc.globalCompositeOperation='source-in';tc.fillStyle=color;tc.fillRect(0,0,128,128);f.tinted.set(color,tint); }
        for(const char of String(value)) {
            if(char===MINECRAFT_STAR_SYMBOL&&symbols){
                const key='symbols:'+color;
                if(!f.tinted.has(key)){const tint=document.createElement('canvas');tint.width=tint.height=256;const tc=tint.getContext('2d');tc.drawImage(symbols,0,0);tc.globalCompositeOperation='source-in';tc.fillStyle=color;tc.fillRect(0,0,256,256);f.tinted.set(key,tint);}
                // U+272B from Minecraft's original Unicode atlas; 15px glyph,
                // rendered at half the ASCII scale just like the game font.
                ctx.drawImage(f.tinted.get(key),176,32,15,16,x,y,7.5*scale,8*scale);x+=8.5*scale;continue;
            }
            const raw=char.charCodeAt(0),code=raw<256?raw:63;ctx.drawImage(f.tinted.get(color),(code%16)*8,(code>>4)*8,8,8,x,y,8*scale,8*scale);x+=((f.widths[code]||5)+1)*scale;}
    };
    const lines = (list,x,y) => list.forEach((entry,i) => {text(`${entry.label}: `,x,y+i*rowHeight);text(entry.value,x+advance(`${entry.label}: `),y+i*rowHeight,entry.color);});
    box(0,0,width,height,'#22262b',12);box(2,2,width-4,height-4,'#171c20',11);box(12,12,width-24,112);
    text(title,26,26,COLORS.gold,3);text(cardTitle,width-26-advance(cardTitle),31);
    text(dateText,26,64,COLORS.white);
    if(ageText) text(ageText,26+advance(`${dateText}  `),64,'#686b70');
    text(timeline,26,94);
    let x=12;const y=136;
    if(avatar) {
        box(x,y,avatarWidth-8,bodyHeight);text(title,x+Math.max(8,(avatarWidth-8-advance(title))/2),y+14);
        const skins=require('./launcher_account_skin');
        const skin=await skins.body(skinAccount);
        if(skin) {const h=Math.min(246,bodyHeight-56),w=skin.width/skin.height*h;ctx.drawImage(skin,x+(avatarWidth-8-w)/2,y+44,w,h);}
        x+=avatarWidth;
    }
    const ratioPanelWidth=wideChart&&ratios.length?Math.max(260,ratios.length*tileWidth+28):0;
    const totalsWidth=!showChart?width-x-12:wideChart?width-x-12-(ratioPanelWidth?ratioPanelWidth+10:0):width-x-chartWidth-22;
    box(x,y,totalsWidth,bodyHeight);text(selected?`${selected.label} totals`:`${periodTitle} totals`,x+14,y+14);
    lines(left,x+14,y+46);lines(right,x+14+widthOf(left),y+46);
    if(!totals.length){text(mode.local?emptyLocal:'Stats unavailable',x+14,y+46);canvas.setAttribute('aria-label',`${canvas.getAttribute('aria-label')}. ${mode.local?emptyLocal:'Stats unavailable'}`);}
    if(ratios.length){
        const rx=wideChart?x+totalsWidth+10:x,rw=wideChart?ratioPanelWidth:totalsWidth;
        const ry=wideChart?y+8:y+Math.max(100,middle*rowHeight+56);
        if(wideChart)box(rx,y,rw,bodyHeight);else box(rx+14,ry-8,rw-28,1,'#303840',0);
        text('Ratios',rx+14,ry+8);
        const tw=(rw-28-(ratios.length-1)*8)/ratios.length;
        ratios.forEach((entry,i)=>{const tx=rx+14+i*(tw+8);box(tx,ry+36,tw,62,'#303840',7);box(tx+1,ry+37,tw-2,60);text(entry.label,tx+(tw-advance(entry.label))/2,ry+45);text(entry.value,tx+(tw-advance(entry.value))/2,ry+71,entry.color);});
    }
    if(showChart) {
        const chartX=wideChart?12:x+totalsWidth+10,chartY=wideChart?y+bodyHeight+10:y;
        const cw=wideChart?width-24:chartWidth,ch=wideChart?chartHeight:bodyHeight;
        box(chartX,chartY,cw,ch);text(selected&&!calendarChart?'Games by mode (overall)':chartTitle,chartX+14,chartY+14);
        if(monthly&&calendarChart){
            const offset=(new Date(calendar.start+'T00:00:00Z').getUTCDay()+6)%7;
            const max=Math.max(1,...bars.map(e=>e.games));const cell=(cw-28)/7;
            ['M','T','W','T','F','S','S'].forEach((label,i)=>text(label,chartX+14+cell*(i+.5)-advance(label)/2,chartY+48,'#a1aab5'));
            bars.forEach((entry,i)=>{
                const col=(i+offset)%7,row=Math.floor((i+offset)/7),cx=chartX+14+col*cell,cy=chartY+76+row*36;
                const opacity=entry.games/max;
                box(cx+3,cy,cell-6,29,entry.future?'#17191c':entry.unavailableValue?'#22252a':`rgb(${Math.round(67+opacity*116)},${Math.round(61+opacity*84)},${Math.round(36-opacity*14)})`,4);
                text(entry.label,cx+(cell-advance(entry.label))/2,cy+7,entry.future?'#53565c':COLORS.text);
            });
            text('Darker: less activity   Brighter: more games',chartX+14,chartY+ch-36,'#a1aab5',1);
            text('Gray: no recorded data',chartX+14,chartY+ch-20,'#90969d',1);
            canvas.setAttribute('aria-label',`${canvas.getAttribute('aria-label')}. Daily activity: ${bars.map(e=>`${e.id}: ${e.future?'Future':e.unavailableValue?'No recorded data':e.games+' games'}`).join(', ')}`);
        }else if(bars.length){
            const total=breakdown.total || bars.reduce((n,e)=>n+e.games,0);
            const caption=`${count(total)} ${calendarChart&&!Number.isFinite(mode.games)?'recorded ':''}${total===1?'game':'games'}`;
            text(caption,chartX+cw-14-advance(caption),chartY+14,'#a1aab5');
            const max=Math.max(1,...bars.map(e=>e.games));
            const columns=wideChart?Math.min(10,bars.length):bars.length;
            const cell=(cw-28)/columns;
            const labelLines=Math.max(1,...bars.map(e=>wrapLabel(e.label,cell-8).length));
            const availableRow=wideChart?chartRowHeight:(ch-54-(breakdown.note?24:0));
            const barHeight=Math.max(50,availableRow-(calendarChart?72:52)-labelLines*18);
            bars.forEach((entry,i)=>{
                const row=Math.floor(i/columns),col=i%columns,center=chartX+14+cell*(col+.5);
                const base=chartY+70+row*chartRowHeight+barHeight;
                const h=barHeight*entry.games/max,bw=Math.max(1,cell-Math.min(14,cell*.22));
                box(center-bw/2,base-h,bw,h,selected&&entry.id===selected.id?COLORS.gold:entry.unknown?'#24272d':'#292c31',0);
                box(center-bw/2,base-h,bw,entry.games?3:1,entry.games?(entry.unknown?'#89919d':selected&&entry.id!==selected.id?'#89919d':COLORS.gold):'#454a52',0);
                const countLabel=entry.future?'--':entry.unavailableValue?'N/A':count(entry.games);
                text(countLabel,center-advance(countLabel)/2,base-h-22,COLORS.white);
                const percent=entry.unavailableValue?'--':`${(total?entry.games/total*100:0).toFixed(1).replace(/\.0$/,'')}%`;
                if(!calendarChart && h>0) {
                    // Center the visible 7px glyphs, excluding the trailing advance.
                    const scale=Math.min(2,bw/(advance(percent,1)+4),h/9);
                    const inkWidth=advance(percent,scale)-scale;
                    const color=selected&&entry.id===selected.id?'#101113':entry.unknown?'#a1aab5':COLORS.green;
                    text(percent,center-inkWidth/2,base-h/2-7*scale/2,color,scale);
                }
                wrapLabel(entry.label,cell-8).forEach((line,j)=>text(line,center-advance(line)/2,base+14+j*18));
            });
            canvas.setAttribute('aria-label',`${canvas.getAttribute('aria-label')}. ${chartTitle}: ${bars.map(e=>`${e.label}: ${e.future?'Future':e.unavailableValue?'Unavailable':`${e.games} (${(total?e.games/total*100:0).toFixed(1)}%)`}`).join(', ')}`);
        }else{
            text('Unavailable',chartX+14,chartY+66,'#a1aab5');
            text('No saved mode counts',chartX+14,chartY+98,'#90969d',1);
        }
        if(breakdown.note&&!monthly)text(breakdown.note,chartX+14,chartY+ch-18,'#90969d',1);
        canvas.setAttribute('aria-label',`${canvas.getAttribute('aria-label')}. ${breakdown.note || ''}`);
    }
    const bottomX=12,bottomY=height-footerHeight-12;
    box(bottomX,bottomY,width-24,footerHeight);
    if(calendar){const status=`${session.active?'In progress - ':''}${calendar.partial?'Partial coverage - uncertain stats hidden - ':''}Stats recorded by Fury`;text(status,26,height-28,'#a1aab5',1);canvas.setAttribute('aria-label',`${canvas.getAttribute('aria-label')}. ${status}`);}
    if(mode.local){text(localStatus,26,bottomY+42,COLORS.gold);text(localDetail,26,bottomY+72);canvas.setAttribute('aria-label',`${canvas.getAttribute('aria-label')}. ${localStatus}. ${localDetail}`);}
    const games=entries.find(e=>e.key==='games'),stars=entries.find(e=>e.key==='stars');
    let bx=26;
    if(games){lines([games],bx,bottomY+14);bx+=advance(labelValue(games))+26;}
    if('winRate' in mode){const rate=`Win rate: ${number(mode.winRate).toFixed(1)}%`;text(rate,bx,bottomY+14,COLORS.green);canvas.setAttribute('aria-label',`${canvas.getAttribute('aria-label')}. ${rate}`);}
    if(stars){
        lines([stars],26,bottomY+42);
        const gained=Math.max(0,number(mode.stars)),target=Math.ceil(gained);
        const filled=gained===target&&gained>0?1:gained-Math.floor(gained);
        const progress=`${gained.toFixed(2)}/${count(target)} ${MINECRAFT_STAR_SYMBOL}`;
        const progressX=width-26-advance(progress);
        const barX=26+advance(labelValue(stars))+20,barW=progressX-barX-18;
        // Fill the exact fraction, including a partial segment at the boundary.
        for(let i=0;i<30;i++){
            const start=i*barW/30,segmentWidth=Math.max(2,barW/30-2);
            box(barX+start,bottomY+43,segmentWidth,12,'#4c4d51',0);
            const fillWidth=Math.max(0,Math.min(segmentWidth,filled*barW-start));
            if(fillWidth)box(barX+start,bottomY+43,fillWidth,12,COLORS.cyan,0);
        }
        text(progress,progressX,bottomY+42,COLORS.cyan);
        canvas.setAttribute('aria-label',`${canvas.getAttribute('aria-label')}. ${progress}`);
    }
    const localDay=new Date(session.startedAt),fileDate=[localDay.getFullYear(),String(localDay.getMonth()+1).padStart(2,'0'),String(localDay.getDate()).padStart(2,'0')].join('-');
    return { canvas, width, height, mode: mode.mode, filename: `Fury-${title}-${calendar?calendar.start:fileDate}-${mode.mode}${calendar?`-${calendar.kind}`:''}${selected?`-${selected.label}`:''}.png`, entries };
}
module.exports = { render, stats, duration, date, time, relativeDate };
