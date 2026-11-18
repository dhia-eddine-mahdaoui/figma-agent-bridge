import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureService } from './runtime.mjs';

export function mergeCodex(text,block) {
  const lines=text.split(/\r?\n/), kept=[]; let dropping=false;
  for(const line of lines) {
    if(/^\s*\[/.test(line)) dropping=/^\s*\[mcp_servers\.(?:figma-local|"figma-local")(?:\.[^\]]+)?\]\s*(?:#.*)?$/.test(line);
    if(!dropping) kept.push(line);
  }
  return kept.join('\n').trimEnd()+'\n\n'+block;
}
export function mergeClaude(text,entry) {
  const value=JSON.parse(text||'{}');
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Invalid Claude configuration');
  if(value.mcpServers && (typeof value.mcpServers!=='object'||Array.isArray(value.mcpServers))) throw new Error('Invalid mcpServers object');
  value.mcpServers={...(value.mcpServers||{}),'figma-local':entry};
  return JSON.stringify(value,null,2)+'\n';
}
async function update(path,transform) {
  let before=''; try {before=await readFile(path,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  const after=transform(before); if(after===before) return;
  await mkdir(dirname(path),{recursive:true});
  if(before) await copyFile(path,`${path}.figma-bridge-backup-${Date.now()}`);
  await writeFile(path,after,{mode:0o600}); console.log(`Configured ${path}`);
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const index=process.argv.indexOf('--client'),client=index>=0?process.argv[index+1]:'config-only';
  if(!['codex','claude-desktop','both','config-only'].includes(client)) throw new Error('Choose --client codex, claude-desktop, both or config-only');
  const entry={command:process.execPath,args:[fileURLToPath(new URL('./mcp.mjs',import.meta.url))]};
  const block=`[mcp_servers.figma-local]\ncommand = ${JSON.stringify(entry.command)}\nargs = [${JSON.stringify(entry.args[0])}]\ntool_timeout_sec = 70\n`;
  if(client==='codex'||client==='both') await update(join(process.env.CODEX_HOME||join(homedir(),'.codex'),'config.toml'),text=>mergeCodex(text,block));
  if(client==='claude-desktop'||client==='both') {
    if(process.platform!=='win32') throw new Error('This installer currently targets Claude Desktop on Windows. Use generated JSON on other platforms.');
    await update(join(process.env.APPDATA||join(homedir(),'AppData','Roaming'),'Claude','claude_desktop_config.json'),text=>mergeClaude(text,entry));
  }
  await writeFile(new URL('./claude-config.json',import.meta.url),JSON.stringify({mcpServers:{'figma-local':entry}},null,2)+'\n');
  await writeFile(new URL('./codex-config.toml',import.meta.url),block);
  await ensureService();
  console.log(`Local bridge ready. Restart the configured AI client. Import this plugin once:\n${fileURLToPath(new URL('./plugin/manifest.json',import.meta.url))}\nRun the plugin, choose Pair this computer and approve the local browser page. No key copying.`);
}
