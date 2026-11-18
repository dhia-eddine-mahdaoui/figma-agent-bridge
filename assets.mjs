import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

// Binary transport never reaches model context. request() is also the HTTP test seam.
export async function saveAsset(args, request, dataDirectory) {
  let response = await request('figma_asset', args);
  if (response.ok === false) return response;
  const initial = response, chunks = []; let offset = 0;
  const ceiling = args.maxBytes || 16777216;
  if (!Number.isInteger(initial.byteLength) || initial.byteLength <= 0 || initial.byteLength > ceiling) throw new Error('Invalid asset size');
  const extensions = {'image/svg+xml':'svg','image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','application/octet-stream':'bin'};
  const extension = extensions[initial.mimeType];
  if (!extension || typeof initial.transferId !== 'string' || initial.nodeId !== args.nodeId) throw new Error('Invalid asset metadata');
  for (let part=0;part<65;part++) {
    if (response.ok === false) throw new Error(response.error || 'Asset transfer failed');
    for (const key of ['nodeId','pageId','format','mimeType','byteLength','transferId','imageHash']) if (response[key] !== initial[key]) throw new Error('Asset snapshot changed during transfer');
    if (response.offset !== offset || typeof response.data !== 'string' || response.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(response.data) || response.data.length > 700000) throw new Error('Invalid asset chunk');
    const bytes = Buffer.from(response.data,'base64');
    if (bytes.length > 524288 || offset + bytes.length > initial.byteLength || (!bytes.length && initial.byteLength)) throw new Error('Invalid asset chunk length');
    chunks.push(bytes); offset += bytes.length;
    if (response.nextOffset === null) {
      if (offset !== initial.byteLength) throw new Error('Incomplete asset transfer');
      const content = Buffer.concat(chunks,offset), sha256 = createHash('sha256').update(content).digest('hex');
      const directory = join(dataDirectory,'assets'); await mkdir(directory,{recursive:true,mode:0o700});
      const filePath = join(directory,`${sha256}.${extension}`);
      try { await writeFile(filePath,content,{flag:'wx',mode:0o600}); }
      catch(error) { if(error.code!=='EEXIST') throw error; if(hashBytes(await readFile(filePath))!==sha256)throw new Error('The cached asset file was modified; it has not been overwritten'); }
      return {ok:true,nodeId:initial.nodeId,pageId:initial.pageId,format:initial.format,mimeType:initial.mimeType,
        imageHash:initial.imageHash,byteLength:offset,sha256,filePath};
    }
    if (response.nextOffset !== offset) throw new Error('Invalid asset continuation');
    response = await request('figma_asset',{...args,transferId:initial.transferId,offset});
  }
  throw new Error('Asset transfer exceeded its chunk budget');
}
function hashBytes(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
