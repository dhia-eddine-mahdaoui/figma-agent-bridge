import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { callTool } from './client.mjs';
const scene = JSON.parse(await readFile(new URL('./demo-scene.json', import.meta.url), 'utf8'));
const status = await callTool('figma_status');
if (!status.connected) throw new Error('Pair the plugin in Figma before running the demo.');
const result = await callTool('figma_create', { requestId: `demo-${randomUUID()}`, scene });
console.log(JSON.stringify(result,null,2));
if (!result.ok) process.exitCode = 1;
else {
  const preview = await callTool('figma_export', { nodeId: result.rootId, scale: 1 });
  if (!preview.ok) throw new Error(preview.error);
  await mkdir(new URL('./.local/', import.meta.url), { recursive: true });
  await writeFile(new URL('./.local/demo.png', import.meta.url), Buffer.from(preview.image,'base64'));
  console.log('Saved actual Figma render to .local/demo.png');
}
