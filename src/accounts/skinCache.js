'use strict';

const fs=require('fs'),path=require('path');
const {normalizeUuid}=require('./launcherAccounts');
const FRESH_MS=15*60*1000,RETRY_MS=60*1000;
function validSkin(png){
    return Buffer.isBuffer(png)&&png.length>=33&&png.length<1024*1024
        &&png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        &&png.readUInt32BE(16)===64&&[32,64].includes(png.readUInt32BE(20));
}
function createAccountSkinCache({directory,axios,now=Date.now}){
    const entries=new Map(),pending=new Map(),retryAfter=new Map();
    function read(uuid){
        if(entries.has(uuid))return entries.get(uuid);
        try{
            const data=JSON.parse(fs.readFileSync(path.join(directory,`${uuid}.json`),'utf8'));
            if(data.uuid===uuid&&validSkin(Buffer.from(data.png,'base64'))){entries.set(uuid,data);return data;}
        }catch{}
        return null;
    }
    const result=data=>data?{uuid:data.uuid,skinUrl:`data:image/png;base64,${data.png}`,model:data.model==='slim'?'slim':'default',updatedAt:data.updatedAt}:null;
    async function get(account){
        const uuid=normalizeUuid(typeof account==='string'?account:account?.uuid);if(!uuid)return null;
        const cached=read(uuid);
        if(cached&&now()-cached.updatedAt<FRESH_MS)return result(cached);
        if((retryAfter.get(uuid)||0)>now())return result(cached);
        if(pending.has(uuid))return pending.get(uuid);
        const work=(async()=>{
            try{
                const {data:profile}=await axios.get(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`,{timeout:5000,maxContentLength:40000,maxRedirects:0});
                if(normalizeUuid(profile.id)!==uuid)throw new Error('Skin profile identity mismatch');
                const property=profile.properties?.find(p=>p.name==='textures');
                const skin=JSON.parse(Buffer.from(property?.value||'','base64').toString('utf8')).textures?.SKIN;
                const url=new URL(skin?.url);
                if(!['http:','https:'].includes(url.protocol)||url.hostname!=='textures.minecraft.net'||url.port||url.username||url.password||url.search||url.hash||!/^\/texture\/[a-f0-9]{32,64}$/.test(url.pathname))throw new Error('Invalid Minecraft texture URL');
                url.protocol='https:';
                const {data:bytes}=await axios.get(url.href,{responseType:'arraybuffer',timeout:5000,maxContentLength:1024*1024,maxRedirects:0});
                const png=Buffer.from(bytes);if(!validSkin(png))throw new Error('Invalid Minecraft skin PNG');
                const data={uuid,png:png.toString('base64'),model:skin.metadata?.model==='slim'?'slim':'default',updatedAt:now()};
                entries.set(uuid,data);
                try{
                    fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,`${uuid}.json`),temporary=`${file}.${process.pid}.tmp`;
                    try{fs.writeFileSync(temporary,JSON.stringify(data));fs.renameSync(temporary,file);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
                }catch{} // A read-only cache must not prevent a correct live skin.
                return result(data);
            }catch{retryAfter.set(uuid,now()+RETRY_MS);return result(cached);}
            finally{pending.delete(uuid);}
        })();
        pending.set(uuid,work);return work;
    }
    return{get};
}
module.exports={createAccountSkinCache,validSkin};
