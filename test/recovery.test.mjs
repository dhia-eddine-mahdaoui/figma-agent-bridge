import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createBridge} from '../server.mjs';
import {fixture} from './figma-fixture.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function setup(t){
 const b=createBridge({timeoutMs:1000,staleMs:60});b.server.listen(0,'127.0.0.1');await once(b.server,'listening');
 t.after(()=>{b.server.closeAllConnections();b.server.close();});
 const url='http://127.0.0.1:'+b.server.address().port;
 const req=async(route,data)=>{const r=await fetch(url+route,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+b.token,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return{status:r.status,body:await r.json()};};
 await req('/pair',{session:'old',fileName:'Test',pageId:'0:1'});
 return req;
}
async function delivered(req){
 const pending=req('/call',{name:'figma_create',args:{requestId:'long',scene:{type:'FRAME'}}});
 let cmd;for(let i=0;i<20&&!cmd;i++){cmd=(await req('/poll',{session:'old'})).body.command;if(!cmd)await wait(2);}
 assert.ok(cmd);return{pending,cmd};
}
test('heartbeat keeps a long command online and excludes a second live session',async t=>{
 t.mock.timers.enable({apis:['Date']});
 const req=await setup(t);const{pending,cmd}=await delivered(req);
 for(let i=0;i<5;i++){t.mock.timers.tick(20);assert.equal((await req('/heartbeat',{session:'old'})).body.alive,true);}
 assert.equal((await req('/call',{name:'figma_status'})).body.connected,true);
 assert.equal((await req('/pair',{session:'new',pageId:'0:1'})).status,409);
 await req('/result',{session:'old',id:cmd.id,result:{ok:true}});
 assert.equal((await pending).body.ok,true);
 assert.equal((await req('/result',{session:'old',id:cmd.id,result:{ok:true}})).body.duplicate,true);
});
test('a stale interrupted session can reconnect without losing unknown-write status',async t=>{
 t.mock.timers.enable({apis:['Date']});
 const req=await setup(t);const{pending,cmd}=await delivered(req);t.mock.timers.tick(90);
 const paired=await req('/pair',{session:'new',fileName:'Test',pageId:'0:1'});
 assert.equal(paired.status,200);assert.equal(paired.body.recovery.execution,'unknown');
 assert.equal((await pending).body.safeToRetry,false);
 assert.equal((await req('/result',{session:'old',id:cmd.id,result:{ok:true}})).body.discarded,true);
 assert.equal((await req('/poll',{session:'new'})).body.command,null);
 assert.equal((await req('/call',{name:'figma_status'})).body.connected,true);
});
test('late acknowledgments after companion restart terminate rather than retry forever',async t=>{
 const req=await setup(t);
 assert.equal((await req('/result',{session:'old',id:'orphan',result:{ok:true}})).body.discarded,true);
});
test('paragraph replacement preserves old content on failure and leaves two text layers on success',async()=>{
 const f=await fixture();const call=(id,name,args)=>f.execute({id,pageId:'0:1',name,args});
 const initial=await call('initial','figma_create',{scene:{type:'FRAME',layout:'NONE',children:Array.from({length:30},(_,i)=>({type:'TEXT',text:'word '+i}))}});
 const parent=f.nodes.get(initial.rootId);const old=parent.children.map(n=>n.id);
 const failed=await call('fail','figma_replace_children',{nodeId:parent.id,children:[{type:'TEXT',text:'paragraph'},{type:'RECTANGLE',sizingHorizontal:'HUG'}]});
 assert.equal(failed.ok,false);assert.deepEqual(parent.children.map(n=>n.id),old);
 const done=await call('success','figma_replace_children',{nodeId:parent.id,children:[{type:'TEXT',text:'Full right column'},{type:'TEXT',text:'Full left column'}]});
 assert.equal(done.ok,true);assert.equal(parent.children.length,2);assert.equal(done.removedNodeIds.length,30);
});
