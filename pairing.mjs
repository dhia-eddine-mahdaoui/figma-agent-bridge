import { randomBytes, timingSafeEqual } from 'node:crypto';
const secret = () => randomBytes(32).toString('hex');
const equal = (a,b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function devicePairing(token) {
  const tickets=new Map();
  return async function handle(req,res,url,body,json,port) {
    if (!url.pathname.startsWith('/device/')) return false;
    const now=Date.now(); for (const [id,ticket] of tickets) if (ticket.expires < now) tickets.delete(id);
    if (req.method==='POST' && url.pathname==='/device/request') {
      if (tickets.size>=16) { json(res,429,{error:'Too many pending approvals. Try again in three minutes.'}); return true; }
      const input=await body(req);
      if (typeof input.session!=='string' || input.session.length>100) throw new Error('Invalid plugin session');
      const id=secret(), pollSecret=secret(), approvalId=secret(), csrf=secret();
      tickets.set(id,{pollSecret,approvalId,csrf,approved:false,expires:now+180000,fileName:String(input.fileName||'Figma file').slice(0,500),pageName:String(input.pageName||'').slice(0,500)});
      json(res,200,{ticket:id,pollSecret,approvalUrl:`http://localhost:${port}/device/approve/${approvalId}`}); return true;
    }
    if (req.method==='POST' && url.pathname==='/device/poll') {
      const input=await body(req), ticket=tickets.get(input.ticket);
      if (!ticket || !equal(ticket.pollSecret,input.pollSecret)) { json(res,410,{error:'Approval expired. Start pairing again.'}); return true; }
      json(res,200,ticket.approved?{approved:true,token}:{approved:false}); return true;
    }
    const match=url.pathname.match(/^\/device\/approve\/([0-9a-f]{64})$/);
    if (match) {
      // Approval pages must be top-level navigations, never cross-origin readable
      // or embeddable. A local-user form click authorizes token delivery.
      res.removeHeader('Access-Control-Allow-Origin'); res.removeHeader('Access-Control-Allow-Headers');
      res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
      // no-referrer makes Chromium's form-navigation Origin opaque (null).
      // same-origin still prevents disclosure to another site and preserves
      // the same-origin POST needed for approval verification.
      res.setHeader('X-Frame-Options','DENY'); res.setHeader('Referrer-Policy','same-origin');
      res.setHeader('X-Content-Type-Options','nosniff');
      const ticket=[...tickets.values()].find(t=>t.approvalId===match[1]);
      if (!ticket) { json(res,410,{error:'Approval expired. Start pairing again in Figma.'}); return true; }
      if (req.method==='POST') {
        if (req.headers.origin!==`http://localhost:${port}`) { json(res,403,{error:'Approval must come from the local approval page.'}); return true; }
        let data=''; for await(const chunk of req) { data+=chunk; if(data.length>2000) throw new Error('Approval too large'); }
        if (!equal(new URLSearchParams(data).get('csrf'),ticket.csrf)) { json(res,403,{error:'Invalid approval form'}); return true; }
        ticket.approved=true;
      } else if(req.method!=='GET') { json(res,405,{error:'Unsupported method'}); return true; }
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Figma local connection</title><style>body{font:16px/1.6 system-ui;background:#f4f6fb;color:#172036;margin:0;display:grid;place-items:center;min-height:100vh}main{background:white;padding:40px;border-radius:20px;max-width:460px;box-shadow:0 12px 50px #17203612}h1{line-height:1.2}small{color:#667085}button{background:#5555e8;color:white;font:inherit;border:0;border-radius:8px;padding:12px 22px;cursor:pointer}</style><main><small>LOCAL CONNECTION · THIS COMPUTER ONLY</small><h1>${ticket.approved?'Device connected':'Connect Figma to your AI tools'}</h1><p>${ticket.approved?'You can close this tab. Future sessions reconnect automatically.':`Allow your local AI clients to read and edit <strong>${escape(ticket.fileName)}</strong> while the bridge plugin is running?`}</p>${ticket.approved?'':`<form method="post"><input type="hidden" name="csrf" value="${ticket.csrf}"><button>Allow local connection</button></form><p><small>No cloud relay. No key copying. Only approve a request you started in Figma.</small></p>`}</main></html>`);
      return true;
    }
    json(res,404,{error:'Unknown pairing route'}); return true;
  };
}
