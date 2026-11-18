import { ensureService } from './runtime.mjs';
import { DATA } from './paths.mjs';
import { saveAsset } from './assets.mjs';
import { editingSchema, resolveEdit } from './contracts.mjs';
import { compatibleHealth } from './connection.mjs';
export async function callTool(name, args = {}) {
  if(name==='figma_schema')return editingSchema(args);
  if(name==='figma_edit')({name,args}=resolveEdit(args));
  const session=await ensureService();
  const request = async (name,args) => {
  if(!await compatibleHealth(session.url,session.token))throw new Error('Companion identity changed; no credentials were sent. Retry a read after reconnecting.');
  const response = await fetch(`${session.url}/call`, { method: 'POST', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, args }), signal: AbortSignal.timeout(65000),redirect:'error' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
  };
  if(name==='figma_asset')return saveAsset(args,request,DATA);
  return request(name,args);
}
