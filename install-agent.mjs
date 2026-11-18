import { readFile, writeFile, mkdir, rename, copyFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DISTRIBUTION_FILES } from './distribution-files.mjs';
import { mergeCodex, mergeClaude } from './setup.mjs';
import { desktopBundleBytes } from './desktop-bundle.mjs';
import {loopbackUrl,BRIDGE_PORTS,PROTOCOL} from './connection.mjs';
import {health} from './runtime.mjs';

const SOURCE = fileURLToPath(new URL('.', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function optionalRead(path) {
  try { return await readFile(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function inside(root, path) {
  const rel = relative(root, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}
export function clientConfigPath(client, home, platform = process.platform, env = process.env) {
  if (client === 'codex') return join(env.CODEX_HOME || join(home, '.codex'), 'config.toml');
  if (client === 'claude-code') return join(env.CLAUDE_CONFIG_DIR || home, '.claude.json');
  if (client === 'claude-desktop') {
    if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
    if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    throw new Error('Claude Desktop configuration is supported on Windows and macOS. Use claude-code or codex on Linux.');
  }
  throw new Error(`Unknown client: ${client}`);
}
function codexEntry(text) {
  const lines = text.split(/\r?\n/); let active = false; const selected = [];
  for (const line of lines) {
    if (/^\s*\[/.test(line)) active = /^\s*\[mcp_servers\.(?:figma-local|"figma-local")(?:\.[^\]]+)?\]\s*(?:#.*)?$/.test(line);
    if (active) selected.push(line);
  }
  return selected.join('\n').trim();
}
export function readClientEntry(client, config) {
  const text = config.replace(/^\uFEFF/, '');
  if (client === 'codex') return codexEntry(text);
  const json = JSON.parse(text || '{}');
  if (json.mcpServers && (typeof json.mcpServers !== 'object' || Array.isArray(json.mcpServers))) {
    throw new Error('Invalid mcpServers');
  }
  return json.mcpServers?.['figma-local'] ? JSON.stringify(json.mcpServers['figma-local']) : '';
}
async function atomicWrite(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.figma-bridge-${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { mode: 0o600 });
  await rename(temporary, path);
}

// This is also the test seam: home/source/platform overrides isolate real user settings.
export async function installAgent({ client = 'claude-code', home = homedir(), source = SOURCE,
  installDir = join(home, '.figma-local-bridge'), node = process.execPath, nodeLicense,
  platform = process.platform, env = process.env, noStart = false, dryRun = false } = {}) {
  if (!['claude-code', 'claude-desktop', 'codex', 'both'].includes(client)) throw new Error('Choose claude-code, claude-desktop, codex, or both (Codex + Claude Code).');
  const runtimeVersion = spawnSync(node, ['--version'], { encoding: 'utf8', windowsHide: true });
  if (runtimeVersion.status !== 0 || Number(runtimeVersion.stdout.trim().slice(1).split('.')[0]) < 20) throw new Error('A working Node 20+ runtime is required. Use bootstrap.ps1 or bootstrap.sh.');
  source = resolve(source); installDir = resolve(installDir);
  if (source === installDir || inside(source, installDir)) throw new Error('Install outside the source checkout; source files and local modifications must remain untouched.');
  const receiptPath = join(installDir, 'installation-receipt.json');
  const priorBytes = await optionalRead(receiptPath);
  const prior = priorBytes ? JSON.parse(priorBytes) : { files: {}, clients: {} };
  if (priorBytes && (prior.product !== 'figma-local-bridge' || !prior.files || !prior.clients)) throw new Error('Invalid installation receipt. Refusing to overwrite this folder.');
  const clients = client === 'both' ? ['codex', 'claude-code'] : [client];
  const runtimePath = join(installDir, 'runtime', platform === 'win32' ? 'node.exe' : 'node');
  const dataPath = join(installDir, 'state');
  const entry = { command: runtimePath, args: [join(installDir, 'mcp.mjs')], env: { FIGMA_BRIDGE_DATA_DIR: dataPath } };
  const block = `[mcp_servers.figma-local]\ncommand = ${JSON.stringify(entry.command)}\nargs = [${JSON.stringify(entry.args[0])}]\ntool_timeout_sec = 70\n\n[mcp_servers.figma-local.env]\nFIGMA_BRIDGE_DATA_DIR = ${JSON.stringify(dataPath)}\n`;
  const operations = []; const tracked = { ...prior.files }; const clientRecords = { ...prior.clients };
  async function managed(path, bytes) {
    const before = await optionalRead(path), nextHash = hash(bytes);
    if (before && hash(before) !== nextHash && prior.files[path] !== hash(before)) {
      throw new Error(`Local changes or an unmanaged file would be overwritten: ${path}\nNothing has been changed. Preserve or merge those edits first.`);
    }
    if (!before || hash(before) !== nextHash) operations.push({ path, before, bytes, kind: 'managed' });
    tracked[path] = nextHash;
  }
  for (const file of DISTRIBUTION_FILES) await managed(join(installDir, file), await readFile(join(source, file)));
  await managed(runtimePath, await readFile(node));
  if (nodeLicense) await managed(join(installDir, 'runtime', 'NODE-LICENSE.txt'), await readFile(nodeLicense));
  else {
    throw new Error('Supply --node-license PATH with the matching official Node LICENSE, or run the bootstrap which does this automatically.');
  }
  const machine = Buffer.from(JSON.stringify({ product: 'figma-local-bridge', root: installDir, node: runtimePath,
    dataDirectory: dataPath, manifest: join(installDir, 'plugin', 'manifest.json'), ports: BRIDGE_PORTS, discoveryProtocol: PROTOCOL }, null, 2) + '\n');
  for (const selected of clients) {
    const configPath = clientConfigPath(selected, home, platform, env);
    const before = await optionalRead(configPath); const text = before?.toString('utf8').replace(/^\uFEFF/, '') || '';
    const existing = readClientEntry(selected, text);
    const expected = selected === 'codex' ? block.trim() : JSON.stringify(entry);
    if (existing && existing !== expected && existing !== prior.clients[selected]?.entry) throw new Error(`An existing figma-local MCP entry is not managed by this installer: ${configPath}\nOther servers will not be touched. Review this entry before installing.`);
    const after = Buffer.from(selected === 'codex' ? mergeCodex(text, block) : mergeClaude(text, entry));
    if (!before || !before.equals(after)) operations.push({ path: configPath, before, bytes: after, kind: 'configuration' });
    clientRecords[selected] = { path: configPath, entry: expected };
    // Claude Desktop has MCP but does not load Claude Code's filesystem skills.
    if (selected !== 'claude-desktop') {
      const skillRoot = selected === 'codex' ? join(env.CODEX_HOME || join(home, '.codex'), 'skills', 'figma-local') : join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'skills', 'figma-local');
      for (const file of ['SKILL.md', 'agents/openai.yaml']) await managed(join(skillRoot, file), await readFile(join(source, 'skills', 'figma-local', file)));
      await managed(join(skillRoot, 'installation.json'), machine);
    }
  }
  await managed(join(installDir, 'installation.json'), machine);
  const remoteSession=platform==='linux' && Boolean(env.SSH_CONNECTION || env.SSH_CLIENT);
  const desktopBundle=remoteSession ? join(installDir,'desktop','figma-local-bridge-windows.zip') : null;
  if(desktopBundle)await managed(desktopBundle,await desktopBundleBytes(source));
  // An upgrade must not replace plugin/runtime code beneath an active companion.
  const changesRuntime = operations.some(op => inside(installDir, op.path) && op.before && op.kind === 'managed');
  if (changesRuntime) {
    const credentials = await optionalRead(join(dataPath, 'credentials.json'));
    const sessionBytes=await optionalRead(join(dataPath,'session.json'));
    if(credentials && sessionBytes){
      const token=JSON.parse(credentials.toString()).token,session=JSON.parse(sessionBytes.toString());
      let livePid=false;if(Number.isInteger(session.pid)&&session.pid>0){try{process.kill(session.pid,0);livePid=true;}catch(error){livePid=error.code==='EPERM';}}
      const running=loopbackUrl(session.url)?await health({url:session.url,token}):null;
      if(running || livePid)throw new Error('The installed companion is running or its recorded process is still alive. Verify and stop only that companion before upgrading. No files have been changed.');
    }
  }
  const result = { client: clients, installDir, manifest: join(installDir, 'plugin', 'manifest.json'),
    plannedChanges: operations.map(({ path, kind }) => ({ path, kind })), dryRun, connected: null,
    connectionMode:remoteSession?'ssh-desktop-setup-required':'same-host',desktopBundle };
  if (dryRun) return result;
  // Preflight the entire plan before any mutation, then detect external edits during installation.
  for (const operation of operations) {
    const now = await optionalRead(operation.path);
    if ((!now) !== (!operation.before) || (now && !now.equals(operation.before))) throw new Error(`File changed during setup: ${operation.path}. Rerun; it has not been overwritten.`);
    if (operation.before) await copyFile(operation.path, `${operation.path}.figma-bridge-backup-${randomUUID()}`);
    await atomicWrite(operation.path, operation.bytes);
  }
  if (platform !== 'win32') { const { chmod } = await import('node:fs/promises'); await chmod(runtimePath, 0o755); }
  await atomicWrite(receiptPath, Buffer.from(JSON.stringify({ product: 'figma-local-bridge', schema: 1,
    sourceFingerprint: hash(Buffer.from(JSON.stringify(DISTRIBUTION_FILES.map(file => [file, tracked[join(installDir, file)]])))),
    files: tracked, clients: clientRecords }, null, 2) + '\n'));
  if (!noStart) {
    const diagnostic = spawnSync(runtimePath, [join(installDir, 'doctor.mjs')], { encoding: 'utf8', windowsHide: true,
      timeout: 20000, env: { ...process.env, FIGMA_BRIDGE_DATA_DIR: dataPath } });
    if (diagnostic.status !== 0) throw new Error(`Files and configuration installed, but companion check failed. Settings backups were retained.\n${diagnostic.stderr || diagnostic.error?.message || diagnostic.stdout}`);
    const status = JSON.parse(diagnostic.stdout); result.connected = status.connected;
  }
  result.instructions = [
    ...(remoteSession ? ['SSH session detected: confirm where Figma runs. Do not invent a Windows UNC import path. The desktopBundle is ready for download to the Windows Figma PC; extract it and double-click Connect.cmd, which uses connect-ssh.ps1. See INSTALL.md.'] : []),
    'Reload/restart your AI client to discover the local MCP tools.',
    remoteSession ? 'On the Windows Figma PC, import plugin/manifest.json from the EXTRACTED desktop bundle. The Linux manifest path is not a local Windows import path.' : `Import this development plugin once in Figma: ${result.manifest}`,
    'Run Figma Agent Bridge (Local), click Pair this computer, and approve the local browser page once.',
    'For each design session, open the target file and run the plugin. The companion starts automatically.',
    ...(clients.includes('claude-code') ? ['In Claude Code: /figma-local followed by your design request.'] : []),
    ...(clients.includes('codex') ? ['In Codex: use $figma-local followed by your design request.'] : []),
    ...(clients.includes('claude-desktop') ? ['Claude Desktop: ask it to use the figma-local MCP tools. Filesystem skill installation applies to Claude Code, not Desktop chat.'] : []),
  ];
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = {};
    const flags = { '--client': 'client', '--install-dir': 'installDir', '--home': 'home', '--node-license': 'nodeLicense' };
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--no-start') options.noStart = true;
      else if (args[i] === '--dry-run') options.dryRun = true;
      else if (flags[args[i]] && args[i + 1] && !args[i + 1].startsWith('--')) options[flags[args[i]]] = args[++i];
      else throw new Error(`Unknown or incomplete option: ${args[i]}`);
    }
    if (options.home) options.env = {}; // Isolated test installations must not inherit real client directories.
    console.log(JSON.stringify(await installAgent(options), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
