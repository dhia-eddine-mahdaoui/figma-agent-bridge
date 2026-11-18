import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createBridge } from '../server.mjs';
import { validateTool, mcpTools } from '../contracts.mjs';
import { fixture } from './figma-fixture.mjs';

async function bridge(t, timeoutMs = 2000) {
  const { server, token } = createBridge({ timeoutMs });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.closeAllConnections(); server.close(); });
  async function request(path, data, authorization = token) {
    const response = await fetch(url + path,{ method: data === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${authorization}`, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  }
  async function pair() { return request('/pair',{ session: 'plugin-1', fileName: 'Test', pageId: '0:1', pageName: 'Designs' }); }
  return { request, pair, url, token };
}

test('unauthenticated requests are rejected and pairing cannot switch files',async t => {
  const b = await bridge(t);
  assert.equal((await b.request('/status',undefined,'wrong')).status,401);
  assert.equal((await b.pair()).status,200);
  assert.equal((await b.request('/pair',{ session: 'another' })).status,409);
});
test('Figma localhost Host is accepted while foreign Host is rejected', async t => {
  const b = await bridge(t);
  const port = new URL(b.url).port;
  for (const [host, status] of [[`localhost:${port}`, 200], [`attacker.example:${port}`, 403]]) {
    const actual = await new Promise((resolve, reject) => {
      const req = http.get(b.url + '/status', { headers: { Host: host, Authorization: `Bearer ${b.token}` } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject);
    });
    assert.equal(actual, status);
  }
});
test('real HTTP boundary dispatches scene through plugin provider; retries do not duplicate',async t => {
  const b = await bridge(t); await b.pair(); const f = await fixture();
  const scene = { type: 'FRAME', name: 'Hero', width: 500, children: [{ type: 'TEXT', text: 'Hello' }] };
  const pending = b.request('/call',{ name: 'figma_edit', args: { operation:'create',requestId: 'hero-1', scene } });
  let command;
  for (let i=0;i<30;i++) { command = (await b.request('/poll',{ session: 'plugin-1' })).body.command; if (command) break; await new Promise(r => setTimeout(r,5)); }
  assert.ok(command);
  const result = await f.execute(command);
  assert.equal(result.ok,true); assert.equal(result.createdNodeIds.length,2);
  assert.equal(f.page.children.length,1);
  await b.request('/result',{ session: 'plugin-1', id: command.id, result });
  assert.deepEqual((await pending).body,result);
  const repeated = await b.request('/call',{ name: 'figma_create', args: { requestId: 'hero-1', scene } });
  assert.deepEqual(repeated.body,result);
  assert.equal((await b.request('/poll',{ session: 'plugin-1' })).body.command,null);
  assert.equal((await b.request('/call',{ name: 'figma_create', args: { requestId: 'hero-1', scene: { type: 'RECTANGLE' } } })).status,409);
});
test('delivered timeout reports unknown execution and blocks overlapping work',async t => {
  const b = await bridge(t,100); await b.pair();
  const pending = b.request('/call',{ name: 'figma_create', args: { requestId: 'timeout-1', scene: { type: 'FRAME' } } });
  let command;
  for (let i=0;i<20;i++) { command = (await b.request('/poll',{ session: 'plugin-1' })).body.command; if (command) break; await new Promise(r => setTimeout(r,2)); }
  assert.ok(command);
  const result = (await pending).body;
  assert.equal(result.execution,'unknown'); assert.equal(result.safeToRetry,false);
  assert.equal((await b.request('/poll',{ session: 'plugin-1' })).body.command,null);
  await b.request('/result',{ session: 'plugin-1', id: command.id, result: { ok: true, rootId: '1:1' } });
  const retry = await b.request('/call',{ name: 'figma_create', args: { requestId: 'timeout-1', scene: { type: 'FRAME' } } });
  assert.equal(retry.body.ok,true); assert.equal(retry.body.rootId,'1:1');
});
test('undelivered timeout removes command from queue',async t => {
  const b = await bridge(t,30); await b.pair();
  const result = await b.request('/call',{ name: 'figma_create', args: { requestId: 'timeout-2', scene: { type: 'FRAME' } } });
  assert.equal(result.body.execution,'not_executed'); assert.equal(result.body.safeToRetry,true);
  assert.equal((await b.request('/poll',{ session: 'plugin-1' })).body.command,null);
});
test('validation rejects arbitrary execution, unknown fields and invalid numbers',() => {
  assert.throws(() => validateTool('eval',{ code: 'anything' }));
  assert.throws(() => validateTool('figma_create',{ requestId: 'x', scene: { type: 'FRAME', code: 'anything' } }));
  assert.throws(() => validateTool('figma_update',{ requestId: 'x', nodeId: '1:1', props: { width: 0 } }));
  assert.throws(() => validateTool('figma_export',{ nodeId: '1:1', scale: NaN }));
});
test('on-demand editing schemas work without an active Figma connection',async t=>{
  const b=await bridge(t);
  const response=await b.request('/call',{name:'figma_schema',args:{operation:'update',fields:['fill','width']}});
  assert.equal(response.status,200);assert.deepEqual(Object.keys(response.body.properties),['fill','width']);
  assert.equal((await b.request('/status')).body.queued,0);
});
test('plugin loads fonts, preserves auto-layout sizing and bounds context reads',async () => {
  const f = await fixture();
  const result = await f.execute({ id: 'create-1', pageId: '0:1', name: 'figma_create', args: { scene: { type: 'FRAME', width: 500, children: [{ type: 'TEXT', text: 'Hello', width: 300, sizingHorizontal: 'FILL' }] } } });
  assert.equal(result.ok,true);
  const text = f.nodes.get(result.createdNodeIds[1]);
  assert.equal(text.textAutoResize,'HEIGHT'); assert.equal(text.width,300); assert.equal(text.layoutSizingHorizontal,'FILL');
  const context = await f.execute({ id: 'read-1', pageId: '0:1', name: 'figma_context', args: { limit: 1, depth: 3 } });
  assert.equal(context.nodeCount,1); assert.equal(context.truncated,true);
});
test('create failure cleans up every new node and page mismatch cannot mutate',async () => {
  const f = await fixture();
  const result = await f.execute({ id: 'bad-1', pageId: '0:1', name: 'figma_create', args: { scene: { type: 'FRAME', children: [{ type: 'RECTANGLE', sizingHorizontal: 'HUG' }] } } });
  assert.equal(result.ok,false); assert.equal(result.safeToRetry,true); assert.equal(f.page.children.length,0);
  const changed = await f.execute({ id: 'bad-2', pageId: 'other', name: 'figma_create', args: { scene: { type: 'FRAME' } } });
  assert.equal(changed.ok,false); assert.equal(f.page.children.length,0);
});
test('missing fonts fail before mutation; color variable binding is retained',async () => {
  const f = await fixture();
  const bad = await f.execute({ id: 'font-1', pageId: '0:1', name: 'figma_create', args: { scene: { type: 'TEXT', text: 'Hi', fontFamily: 'Missing' } } });
  assert.equal(bad.ok,false); assert.equal(f.page.children.length,0);
  const good = await f.execute({ id: 'color-1', pageId: '0:1', name: 'figma_create', args: { scene: { type: 'RECTANGLE', fillVariableId: 'color:1' } } });
  assert.equal(good.ok,true); assert.equal(f.nodes.get(good.rootId).fills[0].boundVariables.color.id,'color:1');
});
test('demo scene creates editable native nodes in one operation',async () => {
  const scene = JSON.parse(await readFile(new URL('../demo-scene.json',import.meta.url),'utf8'));
  validateTool('figma_create',{ requestId: 'demo', scene });
  const f = await fixture();
  const result = await f.execute({ id: 'demo', pageId: '0:1', name: 'figma_create', args: { scene } });
  assert.equal(result.ok,true); assert.ok(result.createdNodeIds.length > 30);
});
test('stdio MCP initializes, enumerates tools, handles notifications and errors',async t => {
  const child = spawn(process.execPath,[fileURLToPath(new URL('../mcp.mjs',import.meta.url))],{ stdio: ['pipe','pipe','pipe'] });
  t.after(() => child.kill());
  let output = '';
  child.stdout.on('data',chunk => { output += chunk; });
  child.stdin.end([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'eval', arguments: {} } },
    { jsonrpc: '2.0', id: 4, method: 'missing' },
  ].map(x => JSON.stringify(x)).join('\n') + '\n');
  await once(child,'exit');
  const messages = output.trim().split('\n').map(x => JSON.parse(x));
  assert.equal(messages.length,4);
  assert.equal(messages.find(m => m.id === 1).result.protocolVersion,'2025-06-18');
  assert.deepEqual(messages.find(m => m.id === 2).result.tools.map(tool=>tool.name),mcpTools().map(tool=>tool.name));
  assert.equal(messages.find(m => m.id === 3).result.isError,true);
  assert.equal(messages.find(m => m.id === 4).error.code,-32601);
});
