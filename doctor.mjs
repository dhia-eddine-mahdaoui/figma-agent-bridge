import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const readJson = async path => JSON.parse(await readFile(join(root, path), 'utf8'));
const share = process.argv.includes('--share');
let receipt;
let receiptState = 'unmanaged';
try {
  const saved = await readJson('installation-receipt.json');
  if (saved.product !== 'figma-local-bridge' || !saved.clients || typeof saved.clients !== 'object') {
    throw new Error('Invalid installation receipt');
  }
  receipt = saved;
  receiptState = 'managed';
} catch (error) {
  if (error.code !== 'ENOENT') receiptState = 'unreadable';
}

// Do not start a second companion in .local when run directly from a managed install.
if (receiptState !== 'unmanaged' && !process.env.FIGMA_BRIDGE_DATA_DIR) {
  process.env.FIGMA_BRIDGE_DATA_DIR = join(root, 'state');
}
const { ensureService, health } = await import('./runtime.mjs');
const { readClientEntry } = await import('./install-agent.mjs');
const { DATA } = await import('./paths.mjs');
const { PROTOCOL } = await import('./connection.mjs');
const { version } = await readJson('package.json');
const manifest = await readJson('plugin/manifest.json');

const clients = [];
for (const name of ['codex', 'claude-code', 'claude-desktop']) {
  const record = receipt?.clients[name];
  if (!record) continue;
  let state;
  try {
    const actual = readClientEntry(name, await readFile(record.path, 'utf8'));
    state = !actual ? 'missing' : actual === record.entry ? 'registered' : 'changed';
  } catch (error) {
    state = error.code === 'ENOENT' ? 'missing' : 'unreadable';
  }
  const nextStep = {
    registered: 'Restart the client if it does not list figma-local, then ask it to run figma_status.',
    missing: 'Rerun setup for this client to restore its figma-local registration.',
    changed: 'Review this client’s figma-local entry against the installed command and data directory.',
    unreadable: 'Check that this client’s configuration exists, is readable, and uses valid syntax.',
  }[state];
  clients.push({ name, state, nextStep });
}

let session;
let status;
let issue;
try {
  session = await ensureService();
  status = await health(session);
  if (!status) throw new Error('The companion stopped responding after startup.');
} catch (error) {
  issue = error.message;
  process.exitCode = 1;
}

const connected = Boolean(status?.connected);
const report = {
  version, runtime: process.version, platform: process.platform, arch: process.arch,
  discoveryProtocol: PROTOCOL, receipt: receiptState, clients,
  broker: issue ? 'unavailable' : 'running',
  connected,
  nextStep: issue
    ? 'Run doctor without --share to see the startup error, then inspect broker.log in the data directory.'
    : connected
      ? 'Confirm the active Figma file and page, then ask your AI client to run figma_status.'
      : 'Open a design in Figma Desktop and run Figma Agent Bridge (Local). Use Pair this computer if prompted.',
};
if (receiptState !== 'managed') {
  report.registrationNextStep = receiptState === 'unmanaged'
    ? 'Run doctor from the installed bridge to check setup-managed clients. For manual installs, verify figma-local in your client settings.'
    : 'Check installation-receipt.json or rerun setup if the install record is unreadable.';
}
if (!share) {
  Object.assign(report, {
    installation: root, dataDirectory: DATA, brokerUrl: session?.url ?? null,
    plugin: connected ? status.plugin : null,
    pluginHasPublishingId: Boolean(manifest.id),
    ...(issue ? { issue } : {}),
  });
}
console.log(JSON.stringify(report, null, 2));
