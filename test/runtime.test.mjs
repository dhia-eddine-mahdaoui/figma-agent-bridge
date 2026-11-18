import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir, utimes, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { once } from 'node:events';

test('AI calls start a detached broker, concurrent starts converge and credentials survive restart',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'figma-bridge-runtime-'));
  const probe=net.createServer(); probe.listen(0,'127.0.0.1'); await once(probe,'listening'); const port=probe.address().port; await new Promise(r=>probe.close(r));
  const cwd=fileURLToPath(new URL('../',import.meta.url));
  const env={...process.env,FIGMA_BRIDGE_DATA_DIR:directory,FIGMA_BRIDGE_PORT:String(port)};
  const pids=new Set();
  t.after(async()=>{for(const pid of pids) {try{process.kill(pid);}catch{}} await rm(directory,{recursive:true,force:true});});
  const run=()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['call.mjs'],{cwd,env,stdio:['ignore','pipe','pipe']}); let stdout='',stderr='';
    child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.on('error',reject);
    child.on('exit',code=>code===0?resolve(JSON.parse(stdout)):reject(new Error(stderr)));
  });
  const abandoned=join(directory,'start.lock');await mkdir(abandoned);const old=new Date(Date.now()-20000);await utimes(abandoned,old,old);
  const values=await Promise.all(Array.from({length:6},run)); assert.ok(values.every(v=>v.connected===false));
  const first=JSON.parse(await readFile(join(directory,'session.json'),'utf8'));pids.add(first.pid);
  const key=JSON.parse(await readFile(join(directory,'credentials.json'),'utf8')).token;
  await run();assert.equal(JSON.parse(await readFile(join(directory,'session.json'),'utf8')).pid,first.pid);
  process.kill(first.pid); await new Promise(r=>setTimeout(r,200));
  await run();
  const second=JSON.parse(await readFile(join(directory,'session.json'),'utf8'));pids.add(second.pid);
  assert.notEqual(second.pid,first.pid);assert.equal(second.token,key);
});

test('SSH discovery inherits the installation data directory and reports only the owned remote port',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'figma-ssh-info-'));let pid;
  t.after(async()=>{if(pid)try{process.kill(pid);}catch{}await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
  const source=fileURLToPath(new URL('../',import.meta.url));
  for(const file of ['ssh-info.mjs','runtime.mjs','paths.mjs','server.mjs','connection.mjs','pairing.mjs','contracts.mjs'])await copyFile(join(source,file),join(directory,file));
  const data=join(directory,'installed-state');await writeFile(join(directory,'installation.json'),JSON.stringify({dataDirectory:data}));
  const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const env={...process.env,FIGMA_BRIDGE_PORT:String(port)};delete env.FIGMA_BRIDGE_DATA_DIR;
  const output=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(directory,'ssh-info.mjs')],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);child.on('error',reject);child.on('exit',code=>code===0?resolve(stdout):reject(new Error(stderr)));});
  const session=JSON.parse(await readFile(join(data,'session.json'),'utf8'));pid=session.pid;
  assert.deepEqual(JSON.parse(output),{product:'figma-local-bridge',protocol:2,remotePort:port});
  assert.ok(!output.includes(session.token));await assert.rejects(readFile(join(directory,'.local','session.json')),/ENOENT/);
});
