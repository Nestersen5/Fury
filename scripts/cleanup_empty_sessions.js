'use strict';
const fs=require('fs'),path=require('path');
const {sessionDeltaFor,sessionHasCardStats,sessionHasOnlyZeroStats}=require('../src/session/sessionStore');
const {hasCardStatMovement,pruneEmptyModeStats}=require('../src/session/cardStatsPolicy');
const {hasGameplayMovement}=require('../src/session/sessionSnapshot');

function cleanHistory(raw) {
    const removed=[],modes=[];const source=Array.isArray(raw)?raw:raw.sessions;
    if(!Array.isArray(source))throw new Error('Session history must contain a sessions array');
    const sessions=source.flatMap(original=>{
        if(!original.endedAt)return [original];
        const pending=(original.games||[]).some(g=>g.verificationStatus==='pending');
        const delta=sessionDeltaFor(original);
        const known=original.trackingSource==='local'?sessionHasOnlyZeroStats(original):Boolean(original.summary?.stats);
        if(!pending&&known&&!sessionHasCardStats(original,delta)){removed.push(original.id);return [];}
        if(original.trackingSource==='local'||pending)return [original];
        for(const key of ['Bedwars','SkyWars','Duels'])if(hasGameplayMovement(original.summary?.stats?.[key])&&!hasCardStatMovement(key,delta?.stats?.[key]))modes.push({id:original.id,mode:key});
        return [{...original,summary:pruneEmptyModeStats(original.summary),games:(original.games||[]).map(game=>game.delta?{...game,delta:pruneEmptyModeStats(game.delta)}:game)}];
    });
    return {data:Array.isArray(raw)?sessions:{...raw,sessions},removed,modes,before:source.length,after:sessions.length};
}
if(require.main===module){
    const args=process.argv.slice(2);if(args.some(a=>!['--apply'].includes(a)))throw new Error('Usage: node scripts/cleanup_empty_sessions.js [--apply]');
    const file=path.resolve(require('../src/storage/runtimePaths').dataPath('session_data.json'));
    const before=fs.readFileSync(file,'utf8'),result=cleanHistory(JSON.parse(before));
    let backup=null;
    if(args.includes('--apply')&&JSON.stringify(result.data)!==JSON.stringify(JSON.parse(before))){
        const dir=path.join(path.dirname(file),'backups','session-cleanup-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(dir,{recursive:true});
        backup=path.join(dir,'session_data.json');fs.writeFileSync(backup,before,{flag:'wx'});
        fs.writeFileSync(path.join(dir,'cleanup-report.json'),JSON.stringify({removed:result.removed,modes:result.modes,before:result.before,after:result.after},null,2));
        const temp=file+'.cleanup-'+process.pid+'.tmp';
        try{
            fs.writeFileSync(temp,JSON.stringify(result.data,null,2),{flag:'wx'});
            if(fs.readFileSync(file,'utf8')!==before)throw new Error('History changed during cleanup; original file left untouched. Rerun against fresh data.');
            fs.renameSync(temp,file);
        }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
    }
    console.log(JSON.stringify({applied:args.includes('--apply'),file,backup,before:result.before,after:result.after,removed:result.removed,emptyModes:result.modes},null,2));
}
module.exports={cleanHistory};
