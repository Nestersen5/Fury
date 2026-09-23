'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),{EventEmitter}=require('events');
const {messages,hasSavedLogin,markSignInRequired,requireBrowserSignIn,guardConnection}=require('../../src/accounts/connectionAuth');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'fury-connection-auth-'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function pair(){const client=new EventEmitter(),upstream=new EventEmitter();client.reasons=[];client.end=reason=>{client.reasons.push(reason);client.emit('end');};upstream.end=()=>upstream.emit('end');return {client,upstream};}
(async()=>{
 assert.equal(hasSavedLogin(root,'Nestersen'),false);
 assert.equal(hasSavedLogin(root,'../escape'),false);
 fs.mkdirSync(path.join(root,'Nestersen'));
 fs.writeFileSync(path.join(root,'Nestersen','fixture_mca-cache.json'),JSON.stringify({mca:{access_token:'cached-expired-token'}}));
 assert(hasSavedLogin(root,'Nestersen'),'expired tokens must be allowed to refresh silently');
 assert.throws(requireBrowserSignIn,error=>error.code==='FURY_SIGN_IN_REQUIRED');
 {
  const {client,upstream}=pair();guardConnection(client,upstream,{timeoutMs:50,onExpired:()=>markSignInRequired(root,'Nestersen')});
  const error=new Error('Sign in');error.code='FURY_SIGN_IN_REQUIRED';upstream.emit('error',error);
  assert.deepEqual(client.reasons,[messages.expired]);assert(fs.existsSync(path.join(root,'Nestersen','fury-signin-required.json')));
 }
 {
  const {client,upstream}=pair();guardConnection(client,upstream,{timeoutMs:50});upstream.emit('error',new Error('ECONNREFUSED'));
  assert.deepEqual(client.reasons,[messages.failed],'network failure must not be called expired sign-in');
 }
 {
  const {client,upstream}=pair();guardConnection(client,upstream,{timeoutMs:15});await delay(25);assert.deepEqual(client.reasons,[messages.timeout]);
 }
 {
  const {client,upstream}=pair();guardConnection(client,upstream,{timeoutMs:15});upstream.emit('login');await delay(25);assert.deepEqual(client.reasons,[]);
 }
 // Confirm Minecraft actually receives a readable disconnect packet.
 const mc=require('minecraft-protocol');
 const server=mc.createServer({'online-mode':false,host:'127.0.0.1',port:0,version:'1.8.9'});
 await new Promise(resolve=>server.once('listening',resolve));
 server.on('login',client=>client.end(messages.missing));
 const remote=mc.createClient({host:'127.0.0.1',port:server.socketServer.address().port,username:'NewPlayer',auth:'offline',version:'1.8.9'});
 try{const kick=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('No disconnect message')),3000);remote.once('kick_disconnect',packet=>{clearTimeout(timer);resolve(packet.reason);});remote.on('error',reject);});assert(kick.includes('Sign-in required'));assert(kick.includes('Open Fury'));}
 finally{remote.end();server.close();}
 console.log('PASS saved/missing auth, refresh allowance, expiry marker, network errors, timeout, successful login and Minecraft disconnect packet');
})().catch(error=>{console.error(error);process.exitCode=1;});
