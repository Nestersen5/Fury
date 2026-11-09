'use strict';
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const execute=promisify(execFile);
// Fixed, read-only, on-demand Windows query. Never return or log full launch
// commands: Minecraft command lines can contain authentication information.
const QUERY=String.raw`
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$found = @(Get-CimInstance Win32_Process -Filter "(Name = 'javaw.exe' OR Name = 'java.exe') AND CommandLine LIKE '%--gameDir%'" | ForEach-Object {
 $line = [string]$_.CommandLine
 if ($line -match '(?i)lunar|badlion|prism|multimc|net\.minecraft') {
  $folderMatch = [regex]::Match($line, '(?i)--gameDir\s+(?:"([^"]+)"|(\S+))')
  if ($folderMatch.Success) {
   $folder = if ($folderMatch.Groups[1].Success) { $folderMatch.Groups[1].Value } else { $folderMatch.Groups[2].Value }
   $client = if ($line -match '(?i)lunar') { 'Lunar Client' } elseif ($line -match '(?i)badlion') { 'Badlion' } elseif ($line -match '(?i)prism') { 'Prism Launcher' } elseif ($line -match '(?i)multimc') { 'MultiMC' } else { 'Minecraft' }
   $versionMatch = [regex]::Match($line, '(?i)--version\s+"?([0-9]+\.[0-9]+(?:\.[0-9]+)?)')
   [pscustomobject]@{ directory=$folder; client=$client; version=$versionMatch.Groups[1].Value }
  }
 }
})
ConvertTo-Json -InputObject $found -Compress
`;
async function detectRunningClients({platform=process.platform,signal,run=execute,systemRoot=process.env.SystemRoot||'C:\\Windows'}={}){
 if(platform!=='win32')throw new Error('Running-client detection is not available here yet.');
 try{
  const {stdout}=await run(path.win32.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',QUERY],{windowsHide:true,timeout:6000,maxBuffer:65536,encoding:'utf8',signal});
  const rows=JSON.parse(stdout.trim()||'[]');
  if(!Array.isArray(rows))return[];
  return rows.slice(0,32).filter(r=>r&&typeof r.directory==='string'&&r.directory.length<4096&&typeof r.client==='string').map(r=>({directory:r.directory,client:r.client.slice(0,48),version:/^\d+\.\d+(?:\.\d+)?$/.test(r.version)?r.version:''}));
 }catch{throw new Error('Could not check for a running Minecraft client. Try again.');}
}
module.exports={detectRunningClients};
