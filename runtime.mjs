import { mkdir, readFile, writeFile, open, rm, stat, link } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { ROOT, DATA, CREDENTIAL_FILE, SESSION_FILE, URL_BASE } from './paths.mjs';
import {loopbackUrl,compatibleHealth} from './connection.mjs';
const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
export async function credentials() {
  await mkdir(DATA,{ recursive:true, mode:0o700 });
  try {
    const value = JSON.parse(await readFile(CREDENTIAL_FILE,'utf8'));
    if (!/^[0-9a-f]{64}$/.test(value.token)) throw new Error('Invalid saved credentials. Re-pair this installation.');
    let url=URL_BASE;
    try {const saved=JSON.parse(await readFile(SESSION_FILE,'utf8'));if(saved.token===value.token && loopbackUrl(saved.url))url=loopbackUrl(saved.url);}catch{}
    return { token:value.token, url };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let token = randomBytes(32).toString('hex');
  // Upgrade existing installs without invalidating their first pairing.
  try { const previous = JSON.parse(await readFile(SESSION_FILE,'utf8')); if (/^[0-9a-f]{64}$/.test(previous.token)) token = previous.token; } catch {}
  // Publish complete credentials in one step. A direct exclusive write can
  // expose an empty file to a concurrent first-time MCP caller.
  const temporary = CREDENTIAL_FILE + '.' + randomBytes(12).toString('hex') + '.tmp';
  await writeFile(temporary, JSON.stringify({ token }), { flag: 'wx', mode: 0o600 });
  try { await link(temporary, CREDENTIAL_FILE); }
  catch (error) { if (error.code !== 'EEXIST') throw error; return credentials(); }
  finally { await rm(temporary, { force: true }); }
  return { token, url:URL_BASE };
}
export async function health(session) {
  if(!await compatibleHealth(session.url,session.token))return null;
  try {
    const res = await fetch(session.url+'/status',{headers:{Authorization:`Bearer ${session.token}`},signal:AbortSignal.timeout(800),redirect:'error'});
    if (!res.ok) throw new Error(`Local port is occupied by a different or outdated bridge (HTTP ${res.status}).`);
    return await res.json();
  } catch (error) { if (error.message.startsWith('Local port')) throw error; return null; }
}
let starting;
export function ensureService() {
  if (!starting) starting = start().finally(()=>{starting=null;});
  return starting;
}
async function reapStaleLock(lock) {
  const recoveryLock = lock + '.recovery';
  try {
    await mkdir(recoveryLock);
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
  try {
    // Recheck while holding the recovery lock so contenders cannot delete a newly
    // acquired start lock based on observations of the previous one.
    let saved;
    try { saved = JSON.parse(await readFile(resolve(lock, 'owner.json'), 'utf8')); } catch {}
    const modified = await stat(lock).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!modified || Date.now() - (saved?.at ?? modified.mtimeMs) <= 10000) return false;
    if (Number.isInteger(saved?.pid) && saved.pid > 0) {
      try { process.kill(saved.pid, 0); return false; }
      catch (error) { if (error.code !== 'ESRCH') return false; }
    }
    await rm(lock, { recursive: true, force: true });
    return true;
  } finally {
    await rm(recoveryLock, { recursive: true, force: true });
  }
}
async function start() {
  const session = await credentials();
  async function ownedHealth(){try{return await health(session);}catch{return null;}}
  async function refreshHealth() {
    session.url = (await credentials()).url;
    return ownedHealth();
  }
  if (await ownedHealth()) return session;
  try{
    const previous=JSON.parse(await readFile(SESSION_FILE,'utf8'));
    if(Number.isInteger(previous.pid)&&previous.pid>0){let alive=false;try{process.kill(previous.pid,0);alive=true;}catch(error){alive=error.code==='EPERM';}
      if (alive) {
        // A concurrent caller may have registered the broker after our first probe.
        if (await refreshHealth()) return session;
        throw new Error('A recorded companion process is alive but its identity cannot be verified. Stop only that verified companion before upgrading or reconnecting.');
      }
    }
  }catch(error){if(error.message.startsWith('A recorded companion'))throw error;if(error.code && error.code!=='ENOENT')throw error;}
  const lock = resolve(DATA,'start.lock');
  let owner = false;
  try { await mkdir(lock); owner=true; await writeFile(resolve(lock,'owner.json'),JSON.stringify({pid:process.pid,at:Date.now()})); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (await reapStaleLock(lock)) return start();
  }
  try {
    if (owner && !(await refreshHealth())) {
      const log = await open(resolve(DATA,'broker.log'),'a',0o600);
      try {
        const child=spawn(process.execPath,[resolve(ROOT,'server.mjs')],{cwd:ROOT,detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd],env:process.env});
        child.on('error',()=>{}); child.unref();
      } finally { await log.close(); }
    }
    for (let i=0;i<60;i++) {if (await refreshHealth()) return session; await wait(100); }
    throw new Error(`Local bridge did not start. See ${resolve(DATA,'broker.log')}`);
  } finally { if (owner) await rm(lock,{recursive:true}).catch(()=>{}); }
}
