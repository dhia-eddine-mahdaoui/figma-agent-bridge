import http from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile, unlink, readFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SESSION_FILE, DATA, PORT, URL_BASE } from './paths.mjs';
import { credentials } from './runtime.mjs';
import { devicePairing } from './pairing.mjs';
import { TOOLS, validateTool, resolveEdit, editingSchema } from './contracts.mjs';
import {BRIDGE_PORTS,PRODUCT,PROTOCOL,healthProof,listenAvailable,bridgeUrl} from './connection.mjs';

export { SESSION_FILE } from './paths.mjs';
const MAX_BODY = 6 * 1024 * 1024;
export function createBridge({ token = randomBytes(32).toString('hex'), timeoutMs = 60000, staleMs = 15000 } = {}) {
  let plugin = null, active = null;
  const queue = [], requests = new Map();
  const handlePairing=devicePairing(token);
  const online = () => plugin && Date.now() - plugin.seen < staleMs;
  const results = new Map();
  let recovery = null;
  function abandon(entry) {
    clearTimeout(entry.timer);
    entry.state=entry.delivered?'unknown':'not_executed';
    entry.result={ok:false,error:'Plugin session was replaced after its heartbeat expired',execution:entry.state,commandId:entry.id,safeToRetry:!entry.delivered,recovery:'Read the affected canvas before retrying an uncertain write.'};
    entry.resolve(entry.result);
    return entry.result;
  }
  const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  async function body(req) {
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw new Error('Request too large'); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
  }
  const server = http.createServer(async (req, res) => {
    // Figma plugin iframes have opaque origins. Bearer authentication remains mandatory,
    // including for pairing; cross-origin pages cannot discover the key.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    const port = server.address().port;
    const host=String(req.headers.host||'').match(/^(localhost|127\.0\.0\.1):(\d+)$/);
    if(!host || (!BRIDGE_PORTS.includes(Number(host[2])) && Number(host[2])!==port))return json(res,403,{error:'Invalid host'});
    const externalPort=Number(host[2]);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, 'http://127.0.0.1');
    if(req.method==='GET' && url.pathname==='/health'){
      const challenge=url.searchParams.get('challenge');
      return json(res,200,{product:PRODUCT,protocol:PROTOCOL,...(/^[0-9a-f]{64}$/.test(challenge||'')?{proof:healthProof(token,challenge)}:{})});
    }
    try { if(await handlePairing(req,res,url,body,json,externalPort)) return; }
    catch(error) { return json(res,400,{error:error.message}); }
    const supplied = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
    const expected = Buffer.from(token);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return json(res, 401, { error: 'Pairing key required' });
    try {
      if (req.method === 'GET' && url.pathname === '/status') return json(res, 200, { connected: Boolean(online()), plugin: plugin ? { ...plugin, session: undefined } : null, queued: queue.length, active: active?.id || null, tools: TOOLS.map(t => t.name) });
      if (req.method === 'POST' && url.pathname === '/pair') {
        const input = await body(req);
        if (!input.session || typeof input.session !== 'string' || input.session.length > 100) throw new Error('Invalid plugin session');
        if (plugin && plugin.session !== input.session) {
          if (online()) return json(res, 409, { error: 'Another plugin is still active. Close it and wait 15 seconds before reconnecting.' });
          recovery=active?abandon(active):null; active=null;
          for(const entry of queue.splice(0))abandon(entry);
          requests.clear(); // A reopened plugin begins a new idempotency scope.
          results.clear();
        }
        plugin = { session: input.session, fileName: String(input.fileName || '').slice(0,500), pageId: String(input.pageId || ''), pageName: String(input.pageName || '').slice(0,500), seen: Date.now() };
        return json(res, 200, { paired: true, recovery });
      }
      if (req.method === 'POST' && url.pathname === '/heartbeat') {
        const input=await body(req);
        if(!plugin || input.session!==plugin.session)return json(res,409,{error:'Pair first'});
        plugin.seen=Date.now();
        return json(res,200,{alive:true,active:active?.id||null});
      }
      if (req.method === 'POST' && url.pathname === '/poll') {
        const input = await body(req);
        if (!plugin || input.session !== plugin.session) return json(res, 409, { error: 'Pair first' });
        plugin.seen = Date.now();
        if (typeof input.pageId === 'string') plugin.pageId = input.pageId;
        if (typeof input.pageName === 'string') plugin.pageName = input.pageName.slice(0,500);
        if (active) return json(res, 200, { command: null });
        const next = queue.shift();
        if (next) { active = next; next.delivered = true; }
        return json(res, 200, { command: next ? { id: next.id, name: next.name, args: next.args, pageId: next.pageId } : null });
      }
      if (req.method === 'POST' && url.pathname === '/result') {
        const input = await body(req);
        if (!plugin || input.session !== plugin.session) return json(res,200,{accepted:false,discarded:true,recovery:'Session changed; inspect the canvas before retrying.'});
        if (results.has(input.id))return json(res,200,{accepted:true,duplicate:true});
        // A late result after a companion restart must not trap the UI in retries.
        if (!active || active.id !== input.id) return json(res,200,{accepted:false,discarded:true,recovery:'Read the canvas before retrying this command.'});
        if (!input.result || typeof input.result !== 'object' || Array.isArray(input.result)) throw new Error('Invalid plugin result');
        const entry = active; active = null; plugin.seen = Date.now(); clearTimeout(entry.timer);
        entry.result = input.result; entry.state = 'completed'; entry.resolve(input.result);
        results.set(entry.id,true);if(results.size>1000)results.delete(results.keys().next().value);
        return json(res, 200, { accepted: true });
      }
      if (req.method === 'POST' && url.pathname === '/call') {
        let { name, args = {} } = await body(req); validateTool(name, args);
        if(name==='figma_schema')return json(res,200,editingSchema(args));
        if(name==='figma_edit')({name,args}=resolveEdit(args));
        if (name === 'figma_status') return json(res, 200, { connected: Boolean(online()), plugin: plugin ? { fileName: plugin.fileName, pageId: plugin.pageId, pageName: plugin.pageName } : null, active:active?.name||null, recovery });
        if (!online()) return json(res, 409, { error: 'Figma is disconnected. Open the plugin and pair it.' });
        const fingerprint = JSON.stringify({ name, args, pageId: plugin.pageId });
        const key = args.requestId;
        let entry = key && requests.get(key);
        if (entry) {
          if (entry.fingerprint !== fingerprint) return json(res, 409, { error: 'requestId already used for different arguments or page' });
          return json(res, 200, entry.state === 'completed' ? entry.result : await entry.promise);
        }
        if (requests.size >= 1000) return json(res, 409, { error: 'Session request capacity reached. Restart and re-pair the bridge.' });
        if (queue.length >= 50) return json(res, 429, { error: 'Queue is full' });
        entry = { id: randomUUID(), name, args, fingerprint, pageId: plugin.pageId, state: 'pending' };
        entry.promise = new Promise(resolve => { entry.resolve = resolve; });
        if (key) requests.set(key, entry);
        queue.push(entry);
        entry.timer = setTimeout(() => {
          const index = queue.indexOf(entry); if (index !== -1) queue.splice(index, 1);
          entry.state = entry.delivered ? 'unknown' : 'not_executed';
          // A delivered timeout retains the execution lock until the plugin returns.
          entry.result = { ok: false, error: 'Command timed out', execution: entry.state, commandId: entry.id, safeToRetry: !entry.delivered };
          entry.resolve(entry.result);
        }, timeoutMs);
        return json(res, 200, await entry.promise);
      }
      return json(res, 404, { error: 'Unknown route' });
    } catch (error) { if (!res.headersSent) json(res, 400, { error: error.message }); }
  });
  server.on('close', () => {
    for (const entry of [...queue, ...(active ? [active] : [])]) {
      clearTimeout(entry.timer); entry.resolve({ ok: false, error: 'Bridge closed', execution: entry.delivered ? 'unknown' : 'not_executed' });
    }
  });
  return { server, token };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const saved=await credentials();
  const bridge = createBridge({ token:saved.token });
  try {
      const selectedPort=await listenAvailable(bridge.server,process.env.FIGMA_BRIDGE_PORT?[PORT]:BRIDGE_PORTS);
      await mkdir(DATA, { recursive: true, mode: 0o700 });
      const selectedUrl=bridgeUrl(selectedPort),temporary=SESSION_FILE+'.'+process.pid+'.tmp';
      await writeFile(temporary, JSON.stringify({url:selectedUrl,token:bridge.token,pid:process.pid}), { mode: 0o600 });await rename(temporary,SESSION_FILE);
      console.log(`Figma Agent Bridge on ${selectedUrl}\nOpen the plugin and choose Pair this computer. Credentials persist across restarts.`);
  } catch (error) { console.error(error.message);process.exitCode=1;bridge.server.close(); }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {try{if(JSON.parse(await readFile(SESSION_FILE,'utf8')).pid===process.pid)await unlink(SESSION_FILE);}catch{} bridge.server.close(); bridge.server.closeAllConnections(); });
}
