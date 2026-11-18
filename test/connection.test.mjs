import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {mkdtemp,writeFile,readFile,rm,utimes,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBridge} from '../server.mjs';
import {compatibleHealth,listenAvailable,loopbackUrl} from '../connection.mjs';
import {health} from '../runtime.mjs';
import {installAgent} from '../install-agent.mjs';

async function listening(t,server){server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections?.();server.close();});return 'http://127.0.0.1:'+server.address().port;}
test('health identifies and proves the companion without exposing credentials or sending them to impostors',async t=>{
  const bridge=createBridge(),url=await listening(t,bridge.server);
  const publicHealth=await(await fetch(url+'/health')).json();assert.deepEqual(publicHealth,{product:'figma-local-bridge',protocol:2});
  assert.ok(await compatibleHealth(url,bridge.token));assert.equal(await compatibleHealth(url,'b'.repeat(64)),null);
  const received=[];
  const fake=http.createServer((req,res)=>{received.push(req.headers.authorization);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({product:'figma-local-bridge',protocol:2,proof:'0'.repeat(64)}));});
  const fakeUrl=await listening(t,fake);assert.equal(await health({url:fakeUrl,token:bridge.token}),null);assert.ok(received.length);assert.ok(received.every(value=>value===undefined));
  assert.equal(loopbackUrl('http://127.0.0.1:4318/path'),null);assert.equal(loopbackUrl('http://evil.example:4318'),null);assert.equal(loopbackUrl('http://localhost:4319'),'http://localhost:4319');
});
test('real server binding skips occupied ports and resolves concurrent bind races',async t=>{
  const occupied=http.createServer();const url=await listening(t,occupied),port=Number(new URL(url).port);
  const a=http.createServer(),b=http.createServer();t.after(()=>{a.close();b.close();});
  const ports=await Promise.all([listenAvailable(a,[port,0]),listenAvailable(b,[port,0])]);
  assert.ok(ports.every(value=>value!==port));assert.notEqual(ports[0],ports[1]);assert.ok(occupied.listening);
  const exhausted=http.createServer();await assert.rejects(listenAvailable(exhausted,[port]),/occupied/);assert.ok(occupied.listening);
});

test('localhost cannot be shadowed by an unrelated IPv6 listener',async t=>{
  const occupied=net.createServer();occupied.listen(0,'::1');try{await once(occupied,'listening');}catch(error){if(['EAFNOSUPPORT','EADDRNOTAVAIL'].includes(error.code)){t.skip('IPv6 unavailable');return;}throw error;}t.after(()=>occupied.close());
  const port=occupied.address().port,bridge=createBridge();t.after(()=>{bridge.server.closeAllConnections();bridge.server.close();});
  const selected=await listenAvailable(bridge.server,[port,0]);assert.notEqual(selected,port);assert.ok(occupied.listening);
  assert.ok(await compatibleHealth('http://localhost:'+selected,bridge.token));
  assert.ok(await compatibleHealth('http://127.0.0.1:'+selected,bridge.token));
});
test('pairing URLs and Origin checks use the local forwarded port, not the remote listener',async t=>{
  const bridge=createBridge(),url=await listening(t,bridge.server),externalPort=4326;
  const wire=(path,{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{const req=http.request(url+path,{method,headers:{Host:'localhost:'+externalPort,...headers}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,text}));});req.on('error',reject);req.end(body);});
  const response=await wire('/device/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:'forwarded-test',fileName:'Demo'})});
  assert.equal(response.status,200);const ticket=JSON.parse(response.text);assert.equal(new URL(ticket.approvalUrl).port,String(externalPort));
  const path=new URL(ticket.approvalUrl).pathname,html=(await wire(path)).text;const csrf=html.match(/name="csrf" value="([0-9a-f]+)"/)[1];
  const approved=await wire(path,{method:'POST',headers:{Origin:'http://localhost:'+externalPort,'Content-Type':'application/x-www-form-urlencoded'},body:'csrf='+csrf});assert.equal(approved.status,200);
  const result=JSON.parse((await wire('/device/poll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket:ticket.ticket,pollSecret:ticket.pollSecret})})).text);assert.equal(result.approved,true);assert.equal(result.token,bridge.token);
});
test('upgrade protection uses the recorded dynamic URL and preserves pairing and edited files',async t=>{
  const home=await mkdtemp(join(tmpdir(),'figma upgrade '));t.after(()=>rm(home,{recursive:true,force:true}));const license=join(home,'license');await writeFile(license,'Node.js is licensed test fixture.');
  const options={home,env:{},nodeLicense:license,noStart:true};const installed=await installAgent(options);
  const b=createBridge(),url=await listening(t,b.server),state=join(installed.installDir,'state');await mkdir(state);await writeFile(join(state,'credentials.json'),JSON.stringify({token:b.token}));await writeFile(join(state,'session.json'),JSON.stringify({url,pid:process.pid,token:b.token}));
  const config=await readFile(join(home,'.claude.json'));
  // Changed runtime license creates a legitimate upgrade plan, blocked before writes.
  await writeFile(license,'Node.js is licensed updated test fixture.');await assert.rejects(installAgent(options),/running|recorded process/);assert.deepEqual(await readFile(join(home,'.claude.json')),config);
});
