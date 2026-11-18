import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import {webcrypto,createHmac} from 'node:crypto';

function healthResponse(url,token='a'.repeat(64)){
  const parsed=new URL(url);if(parsed.port!=='4318')return {ok:false,json:async()=>({})};
  const challenge=parsed.searchParams.get('challenge');
  return {ok:true,json:async()=>({product:'figma-local-bridge',protocol:2,proof:createHmac('sha256',token).update('figma-local-bridge/v2/'+challenge).digest('hex')})};
}

test('Figma sandbox relay replies unblock pairing even when source differs from parent', async () => {
  const html = await readFile(new URL('../plugin/ui.html',import.meta.url),'utf8');
  const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const elements = new Map(['key','connect','pair','disconnect','status','endpoint-choice'].map(id => [id,{ value: id==='key'?'a'.repeat(64):'', disabled: false, textContent: '' }]));
  const window = {}, requests = [];
  const parent = { postMessage({ pluginMessage }) {
    if(pluginMessage.type==='settings-read') queueMicrotask(()=>window.onmessage({source:{},data:{pluginMessage:{type:'settings'}}}));
    if (pluginMessage.type === 'identity') queueMicrotask(() => window.onmessage({ source: {}, data: { pluginMessage: { type: 'identity', pageId: '0:1', pageName: 'Page 1', fileName: 'Demo' } } }));
  } };
  vm.runInNewContext(source, { window, parent, document: { getElementById(id) { return elements.get(id); } },
    crypto: {subtle:webcrypto.subtle, getRandomValues(bytes) { bytes.fill(1); } }, TextEncoder,Uint8Array, AbortSignal, setTimeout, clearTimeout,
    fetch: async (url) => { requests.push(url); if(url.includes('/health'))return healthResponse(url);return { ok: true, async json() { return url.endsWith('/poll') ? { command: null } : { paired: true }; } }; }
  });
  await new Promise(resolve=>setImmediate(resolve));
  await elements.get('connect').onclick();
  assert.ok(requests.some(url => url.endsWith('/pair')));
  assert.equal(elements.get('status').textContent,'Connected · Page 1');
  elements.get('disconnect').onclick();
});

test('saved pairing waits for a later companion startup without another user click',async()=>{
  const html=await readFile(new URL('../plugin/ui.html',import.meta.url),'utf8');
  const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const elements=new Map(['key','connect','pair','disconnect','status','endpoint-choice'].map(id=>[id,{value:'',disabled:false,textContent:''}]));
  const window={};let attempts=0;
  const parent={postMessage({pluginMessage}){
    if(pluginMessage.type==='settings-read')queueMicrotask(()=>window.onmessage({data:{pluginMessage:{type:'settings',token:'a'.repeat(64)}}}));
    if(pluginMessage.type==='identity')queueMicrotask(()=>window.onmessage({data:{pluginMessage:{type:'identity',pageId:'0:1',pageName:'Demo'}}}));
  }};
  vm.runInNewContext(source,{window,parent,document:{getElementById:id=>elements.get(id)},crypto:{subtle:webcrypto.subtle,getRandomValues:bytes=>bytes.fill(1)},TextEncoder,Uint8Array,AbortSignal,
    setTimeout:(callback,ms)=>setTimeout(callback,Math.min(ms,5)),clearTimeout,
    fetch:async url=>{if(url.includes('/health'))return healthResponse(url);if(url.endsWith('/pair')&&++attempts<3)throw new Error('Companion not started');return{ok:true,json:async()=>url.endsWith('/poll')?{command:null}:{paired:true}};}
  });
  try {
    for(let i=0;i<100&&!elements.get('status').textContent.startsWith('Connected');i++)await new Promise(r=>setTimeout(r,5));
    assert.ok(attempts>=3);assert.equal(elements.get('status').textContent,'Connected · Demo');
  } finally {elements.get('disconnect').onclick();}
});
async function harness({savedToken,fetcher,cryptoApi=webcrypto}){
  const html=await readFile(new URL('../plugin/ui.html',import.meta.url),'utf8'),source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const elements=new Map(['key','connect','pair','disconnect','status','endpoint-choice'].map(id=>[id,{value:id==='key'?'a'.repeat(64):'',disabled:false,textContent:''}]));
  const window={},messages=[],requests=[];
  const parent={postMessage({pluginMessage}){messages.push(pluginMessage);if(pluginMessage.type==='settings-read')queueMicrotask(()=>window.onmessage({data:{pluginMessage:{type:'settings',token:savedToken}}}));if(pluginMessage.type==='identity')queueMicrotask(()=>window.onmessage({data:{pluginMessage:{type:'identity',pageId:'0:1',pageName:'Test'}}}));}};
  vm.runInNewContext(source,{window,parent,document:{getElementById:id=>elements.get(id)},crypto:cryptoApi,TextEncoder,Uint8Array,AbortSignal,setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,20)),clearTimeout,fetch:async(url,options)=>{requests.push({url,options});return fetcher(url,options);}});
  await new Promise(resolve=>setImmediate(resolve));return {elements,messages,requests,close(){elements.get('disconnect').onclick();}};
}
function identified(url,key){const nonce=new URL(url).searchParams.get('challenge');return {ok:true,json:async()=>({product:'figma-local-bridge',protocol:2,proof:createHmac('sha256',key).update('figma-local-bridge/v2/'+nonce).digest('hex')})};}
test('discovery sends no credentials to unrelated or wrong-key companions and selects the owned port',async()=>{
  const ui=await harness({fetcher:async(url)=>{const port=new URL(url).port;if(url.includes('/health'))return port==='4319'?identified(url,'a'.repeat(64)):port==='4318'?identified(url,'b'.repeat(64)):{ok:true,json:async()=>({product:'unrelated',protocol:2})};return{ok:true,json:async()=>url.endsWith('/poll')?{command:null}:{paired:true}};}});
  try{await ui.elements.get('connect').onclick();assert.equal(ui.elements.get('status').textContent,'Connected · Test');const authenticated=ui.requests.filter(req=>req.options?.headers?.Authorization);assert.ok(authenticated.length);assert.ok(authenticated.every(req=>new URL(req.url).port==='4319'));}finally{ui.close();}
});
test('ambiguous discovery rejects pairing until an explicit endpoint is selected',async()=>{
  const ui=await harness({fetcher:async(url)=>url.includes('/health')?identified(url,'a'.repeat(64)):{ok:true,json:async()=>url.endsWith('/poll')?{command:null}:{paired:true}}});
  try{await ui.elements.get('connect').onclick();assert.match(ui.elements.get('status').textContent,/More than one/);assert.ok(!ui.requests.some(req=>req.options?.headers?.Authorization));ui.elements.get('endpoint-choice').value='4323';await ui.elements.get('connect').onclick();assert.equal(ui.elements.get('status').textContent,'Connected · Test');}finally{ui.close();}
});
test('expired saved pairing returns actionable UI without disclosing or erasing the saved key',async()=>{
  const ui=await harness({savedToken:'a'.repeat(64),fetcher:async(url)=>new URL(url).port==='4318'?identified(url,'b'.repeat(64)):{ok:false,json:async()=>({})}});
  try{for(let i=0;i<50&&!ui.elements.get('status').textContent.includes('no longer valid');i++)await new Promise(resolve=>setTimeout(resolve,5));assert.match(ui.elements.get('status').textContent,/Pair this computer again/);assert.ok(!ui.requests.some(req=>req.options?.headers?.Authorization));assert.ok(!ui.messages.some(message=>message.type==='settings-forget'));}finally{ui.close();}
});
test('saved pairing is verified when the Figma iframe has no WebCrypto subtle API',async()=>{
  const cryptoApi={getRandomValues(bytes){webcrypto.getRandomValues(bytes);return bytes;}};
  const ui=await harness({savedToken:'a'.repeat(64),cryptoApi,fetcher:async(url)=>url.includes('/health')?(new URL(url).port==='4318'?identified(url,'a'.repeat(64)):{ok:false,json:async()=>({})}):{ok:true,json:async()=>url.endsWith('/poll')?{command:null}:{paired:true}}});
  try{for(let i=0;i<50&&!ui.elements.get('status').textContent.startsWith('Connected');i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(ui.elements.get('status').textContent,'Connected · Test');assert.ok(ui.requests.some(req=>req.options?.headers?.Authorization));}finally{ui.close();}
});
