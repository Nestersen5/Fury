'use strict';
const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const mc=require('../../features/minecraft_chat');mc.setChatPrefixAccent('#16b8c8');
const rows=[];
function chars(component){return component.extra.flatMap(segment=>{const {text,...props}=segment;return [...String(text||'')].map(text=>({text,...props}));});}
function verify(label,input,expectedPrefix){
 const untouched=structuredClone(input),before=mc.normalizeLegacyJsonComponent(input);let packet;
 mc.sendChat({write:(name,data)=>{assert.equal(name,'chat');assert.equal(data.position,0);packet=JSON.parse(data.message);}},input);
 assert.deepEqual(input,untouched,'formatter must not mutate builder input');
 const range=mc.featurePrefixRange(mc.extractText(before));assert.equal(Boolean(range),expectedPrefix,label);
 const expected=chars(before).map((c,i)=>range&&i>=range.start&&i<range.end?{...c,color:'dark_aqua'}:c);
 assert.deepEqual(chars(packet),expected,label+': exact text, body colors, styles and event metadata');
 rows.push({label,input,before,after:packet,range});return packet;
}
const metadata={bold:true,italic:true,underlined:true,strikethrough:false,obfuscated:false,
 hoverEvent:{action:'show_text',value:{text:'Keep §cformatting',extra:[{text:' detail',color:'gold'}]}},
 clickEvent:{action:'suggest_command',value:'/help'},insertion:'Keep this'};
for(const prefix of ['Fury »','FURY »','[Fury]','[FURY]','[Alias]','[Clip]','Gambler George »','Queue time »','Lobby »','Quick Buy »','Quick Buy + Hotbar »','Hotbar »','Preview »','Layout »','Urchin »','Seraph »','Tags »']){
 verify(prefix,{text:'  '+prefix+' body stays red',color:'red',...metadata},true);
}
for(const prefix of ['[MVP+]','[ADMIN]','[Server]','[System]','[Menu]','Book Trace »','[Team debug]','[ClickInfo]','Dodge Test »','[fury]','FURY player says'])verify(prefix,{text:prefix+' body',color:'gold',...metadata},false);
verify('nested and split prefix',{text:' ',color:'red',extra:[{text:'[Fu',color:'gold',...metadata,extra:[{text:'ry]',color:'light_purple',...metadata},{text:' body',color:'green',...metadata}]}]},true);
const km=verify('KM','§c[KM] Unknown kill message: §fExampleStyle',true);
assert.equal(km.extra.find(x=>x.text.includes('Unknown')).color,'red');
const aurora=verify('Aurora','§e[Aurora] Searching for matching stats: §fFKDR: 2.00',true);
assert.equal(aurora.extra.find(x=>x.text.includes('Searching')).color,'yellow');
let feature;require('../../features/feature_panel').createFeatureStatus({title:'API keys',sendLine:x=>feature=x}).open();verify('real feature builder',feature,true);
for(const input of require('../../src/health/settingsAnnouncements').buildSettingsAnnouncements([{label:'In-game chat prefix accent',from:'off',to:'on'}]))verify('real settings announcement',input,true);
verify('real Quick Buy builder',require('../../src/menu/quickBuyMessages').quickBuyMessage('Layout updated.','success'),true);
const rootMetadata={text:'',bold:true,extra:[{text:'[KM] body',color:'red',...metadata}],clickEvent:metadata.clickEvent};
const split=mc.applyChatPrefixAccent(rootMetadata);assert.equal(split.bold,true);assert.deepEqual(split.clickEvent,metadata.clickEvent);
const dir=path.join(REPOSITORY_ROOT,'output/consistency-implementation/group1');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'chat-output.json'),JSON.stringify(rows,null,2));
console.log('PASS '+rows.length+' exact chat output cases; root/nested styles, metadata, body boundaries and excluded families');
