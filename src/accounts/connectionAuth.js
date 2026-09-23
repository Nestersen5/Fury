'use strict';
const fs=require('fs'),path=require('path');
const messages={
    missing:'\u00a76Fury \u2014 Sign-in required\n\n\u00a7fOpen Fury and sign in with your\nMinecraft Microsoft account,\nthen reconnect.',
    expired:'\u00a76Fury \u2014 Sign-in expired\n\n\u00a7fYour sign-in has expired.\nOpen Fury to sign in again,\nthen reconnect.',
    failed:'\u00a76Fury \u2014 Connection failed\n\n\u00a7fCould not connect to the Minecraft server.\nPlease try again shortly.',
    timeout:'\u00a76Fury \u2014 Connection timed out\n\n\u00a7fThe server did not finish connecting.\nCheck your connection and try again.'
};
function hasSavedLogin(root,username){
    if(!/^[A-Za-z0-9_]{3,16}$/.test(username||''))return false;
    const directory=path.join(root,username);
    try{return fs.readdirSync(directory).some(file=>{
        if(!/_(mca|live)-cache\.json$/.test(file))return false;
        try{const data=JSON.parse(fs.readFileSync(path.join(directory,file),'utf8'));return Boolean(data?.mca?.access_token||data?.token?.refresh_token||data?.token?.access_token);}catch{return false;}
    });}catch{return false;}
}
function markSignInRequired(root,username){
    if(!/^[A-Za-z0-9_]{3,16}$/.test(username||''))return;
    const directory=path.join(root,username);fs.mkdirSync(directory,{recursive:true});
    fs.writeFileSync(path.join(directory,'fury-signin-required.json'),'true');
}
function requireBrowserSignIn(){const error=new Error('Sign in again in Fury');error.code='FURY_SIGN_IN_REQUIRED';throw error;}
function guardConnection(client,upstream,{timeoutMs=30000,onExpired=()=>{}}={}){
    let finished=false;
    const timer=setTimeout(()=>fail(messages.timeout),timeoutMs);timer.unref?.();
    function cleanup(){clearTimeout(timer);}
    function fail(message){if(finished)return;finished=true;cleanup();client.end(message);upstream.end();}
    upstream.once('login',()=>{finished=true;cleanup();});
    upstream.on('error',error=>{
        const expired=error?.code==='FURY_SIGN_IN_REQUIRED'||/invalid_grant|interaction_required|refresh token.*expired/i.test(error?.message||'');
        if(expired)onExpired();
        fail(expired?messages.expired:messages.failed);
    });
    upstream.once('end',cleanup);client.once('end',()=>{finished=true;cleanup();});
    return {cleanup};
}
module.exports={messages,hasSavedLogin,markSignInRequired,requireBrowserSignIn,guardConnection};
