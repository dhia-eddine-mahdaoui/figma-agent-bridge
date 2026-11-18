import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { installAgent, clientConfigPath } from '../install-agent.mjs';
import { inspectPublicSource, packageSource } from '../package-source.mjs';
import { desktopBundleBytes } from '../desktop-bundle.mjs';

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'figma install space '));
  t.after(() => rm(home, { recursive: true, force: true }));
  const license = join(home, 'NODE-LICENSE.txt');
  await writeFile(license, 'Node.js is licensed for test fixture use only.');
  return { home, env: {}, noStart: true, nodeLicense: license };
}
test('fresh install has portable runtime, skill paths and client settings; rerun preserves custom files', async t => {
  const options = await fixture(t);
  await mkdir(join(options.home, '.claude'), { recursive: true });
  const config = join(options.home, '.claude.json');
  await writeFile(config, JSON.stringify({ preference: true, mcpServers: { other: { command: 'existing' } }, projects: { x: {} } }));
  const installed = await installAgent({ ...options, client: 'both' });
  assert.ok(installed.plannedChanges.length > 10);
  const merged = JSON.parse(await readFile(config));
  assert.equal(merged.preference, true); assert.equal(merged.mcpServers.other.command, 'existing'); assert.ok(merged.projects.x);
  const machine = JSON.parse(await readFile(join(options.home, '.claude', 'skills', 'figma-local', 'installation.json')));
  assert.equal(machine.root, installed.installDir);
  assert.equal(merged.mcpServers['figma-local'].command, machine.node);
  assert.equal(merged.mcpServers['figma-local'].env.FIGMA_BRIDGE_DATA_DIR, machine.dataDirectory);
  const state = join(installed.installDir, 'state'); await mkdir(state); await writeFile(join(state, 'credentials.json'), 'saved pairing fixture');
  const custom = join(installed.installDir, 'custom-note.txt'); await writeFile(custom, 'keep me');
  const rerun = await installAgent({ ...options, client: 'both' });
  assert.equal(rerun.plannedChanges.length, 0);
  assert.equal(await readFile(custom, 'utf8'), 'keep me');
  assert.equal(await readFile(join(state, 'credentials.json'), 'utf8'), 'saved pairing fixture');
  assert.ok((await readdir(options.home)).some(file => file.startsWith('.claude.json.figma-bridge-backup-')));
});
test('edited plugin or skill is rejected before any configuration mutation', async t => {
  const options = await fixture(t); const installed = await installAgent(options);
  const config = join(options.home, '.claude.json'); const before = await readFile(config);
  const plugin = join(installed.installDir, 'plugin', 'code.js'); await writeFile(plugin, '// friend custom plugin changes');
  await assert.rejects(installAgent({ ...options, client: 'both' }), /Local changes/);
  assert.equal(await readFile(plugin, 'utf8'), '// friend custom plugin changes');
  assert.deepEqual(await readFile(config), before);
  await assert.rejects(readFile(join(options.home, '.codex', 'config.toml')), /ENOENT/);
});

test('doctor checks managed registrations and its share report excludes local details', async t => {
  const options = await fixture(t);
  const { installDir } = await installAgent({ ...options, client: 'both' });
  const stateDir = join(installDir, 'state');
  await mkdir(stateDir);
  await writeFile(join(stateDir, 'credentials.json'), '{"token":"private-fixture"}');
  const config = join(options.home, '.claude.json');
  await writeFile(config, '{"mcpServers":{"figma-local":{"command":"private-custom-command"}}}');

  const env = { ...process.env };
  delete env.FIGMA_BRIDGE_DATA_DIR;
  delete env.NODE_TEST_CONTEXT;
  const check = (...args) => spawnSync(process.execPath, [join(installDir, 'doctor.mjs'), ...args], { encoding: 'utf8', env });
  const shared = check('--share');
  assert.equal(shared.stderr, '');
  assert.equal(shared.status, 1);
  const report = JSON.parse(shared.stdout);
  assert.equal(report.broker, 'unavailable');
  assert.deepEqual(report.clients.map(({ name, state }) => [name, state]), [
    ['codex', 'registered'], ['claude-code', 'changed'],
  ]);
  for (const field of ['installation', 'dataDirectory', 'brokerUrl', 'issue', 'plugin']) {
    assert.equal(Object.hasOwn(report, field), false);
  }
  assert.doesNotMatch(shared.stdout, /private-fixture|private-custom-command/);
  const local = JSON.parse(check().stdout);
  assert.equal(await realpath(local.dataDirectory), await realpath(stateDir));
  assert.match(local.issue, /Invalid saved credentials/);
});

test('a clean managed source upgrade preserves pairing, unrelated client preferences and custom files',async t=>{
  const options=await fixture(t),previous=await packageSource(join(options.home,'previous-source'));
  const packagePath=join(previous.destination,'package.json'),metadata=JSON.parse(await readFile(packagePath));metadata.version='0.3.2';await writeFile(packagePath,JSON.stringify(metadata));
  const installed=await installAgent({...options,source:previous.destination});
  const state=join(installed.installDir,'state');await mkdir(state);await writeFile(join(state,'credentials.json'),JSON.stringify({token:'saved-user-pairing-fixture'}));
  const note=join(installed.installDir,'custom-note.txt');await writeFile(note,'preserve');
  const configPath=join(options.home,'.claude.json'),config=JSON.parse(await readFile(configPath));config.preference='keep';await writeFile(configPath,JSON.stringify(config));
  const updated=await installAgent(options);assert.ok(updated.plannedChanges.some(file=>file.path.endsWith('package.json')));
  assert.equal(JSON.parse(await readFile(join(installed.installDir,'package.json'))).version,'0.4.0');
  assert.equal(JSON.parse(await readFile(configPath)).preference,'keep');assert.equal(await readFile(note,'utf8'),'preserve');
  assert.equal(JSON.parse(await readFile(join(state,'credentials.json'))).token,'saved-user-pairing-fixture');
  assert.equal((await installAgent(options)).plannedChanges.length,0);
});
test('dry run and malformed/existing client config do not partially install', async t => {
  const options = await fixture(t);
  const planned = await installAgent({ ...options, dryRun: true }); assert.ok(planned.plannedChanges.length);
  await assert.rejects(readFile(join(planned.installDir, 'installation-receipt.json')), /ENOENT/);
  await writeFile(join(options.home, '.claude.json'), '{broken');
  await assert.rejects(installAgent(options), SyntaxError);
  await assert.rejects(readFile(join(planned.installDir, 'plugin', 'code.js')), /ENOENT/);
  await writeFile(join(options.home, '.claude.json'), JSON.stringify({ mcpServers: { 'figma-local': { command: 'custom' } } }));
  await assert.rejects(installAgent(options), /not managed/);
});
test('client platform paths and source sharing boundary', async t => {
  assert.equal(clientConfigPath('claude-desktop', '/example', 'darwin', {}), join('/example', 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'));
  assert.throws(() => clientConfigPath('claude-desktop', '/example', 'linux', {}), /supported/);
  assert.throws(() => inspectPublicSource('safe.mjs', Buffer.from('ghp_' + 'x'.repeat(40))), /credential/);
  assert.throws(() => inspectPublicSource('safe.mjs', Buffer.from(['C:', 'Users', 'Someone', 'private'].join('/'))), /personal/);
  const options = await fixture(t); const output = await packageSource(join(options.home, 'public-source'));
  const manifest = JSON.parse(await readFile(output.manifest));
  assert.ok(manifest.files.some(file => file.path === 'plugin/code.js'));
  assert.ok(!manifest.files.some(file => /\.local|credentials|claude-config\.json|codex-config\.toml/.test(file.path)));
});
test('an SSH-side Linux install warns against inventing a Windows UNC import path',async t=>{
  const options=await fixture(t);
  const result=await installAgent({...options,client:'codex',platform:'linux',env:{SSH_CONNECTION:'synthetic-session'}});
  assert.ok(result.instructions.some(instruction=>instruction.startsWith('SSH session detected:') && instruction.includes('connect-ssh.ps1')));
  assert.equal(result.connectionMode,'ssh-desktop-setup-required');
  assert.ok(result.desktopBundle.endsWith('.zip'));assert.ok((await readFile(result.desktopBundle)).length>10000);
  assert.ok(!result.instructions.some(instruction=>instruction.startsWith('Import this development plugin once in Figma:')));
});
test('desktop ZIP is deterministic and contains only plugin, launcher, tunnel helper and license',async()=>{
  const first=await desktopBundleBytes(),second=await desktopBundleBytes();assert.deepEqual(first,second);
  const names=[];let offset=0;
  while(first.readUInt32LE(offset)===0x04034b50){const size=first.readUInt32LE(offset+18),nameLength=first.readUInt16LE(offset+26),extraLength=first.readUInt16LE(offset+28);names.push(first.subarray(offset+30,offset+30+nameLength).toString());offset+=30+nameLength+extraLength+size;}
  assert.deepEqual(names,['plugin/manifest.json','plugin/code.js','plugin/ui.html','connect-ssh.ps1','Connect.cmd','LICENSE','START-HERE.txt']);
  assert.ok(!names.some(name=>/state|credentials|installation|config/.test(name)));
});
