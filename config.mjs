import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const entry = fileURLToPath(new URL('./mcp.mjs', import.meta.url));
const config = { mcpServers: { 'figma-local': { command: process.execPath, args: [entry] } } };
await writeFile(new URL('./claude-config.json', import.meta.url), JSON.stringify(config,null,2) + '\n');
await writeFile(new URL('./codex-config.toml', import.meta.url), `[mcp_servers.figma-local]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(entry)}]\ntool_timeout_sec = 70\n`);
console.log('Created claude-config.json and codex-config.toml with absolute paths. Merge these into your client settings. Existing client configuration has not been edited.');
