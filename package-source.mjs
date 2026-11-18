import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DISTRIBUTION_FILES } from './distribution-files.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
export function inspectPublicSource(file, bytes) {
  const text = bytes.toString('utf8');
  const forbidden = [
    /(?:C:[\\/]Users[\\/]|\/Users\/|\/home\/)[a-zA-Z0-9_.~-]+[\\/]/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:ghp_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{30,}|sk-(?:proj-)?[a-zA-Z0-9_-]{30,})\b/,
    /(?:token|password|secret)\s*[=:]\s*['"][0-9a-f]{64}['"]/i,
    /device\/approve\/[0-9a-f]{64}/i,
  ];
  if (forbidden.some(pattern => pattern.test(text))) throw new Error(`Potential credential or personal absolute path in ${file}; review before sharing.`);
  if (file.startsWith('.local/') || file.startsWith('.bootstrap/') || /(?:credentials|session)\.json$/.test(file)) throw new Error(`Private artifact cannot be distributed: ${file}`);
}
export async function packageSource(destination = join(root, '.local', 'distribution', `figma-local-bridge-${Date.now()}`)) {
  destination = resolve(destination);
  const files = [];
  for (const file of DISTRIBUTION_FILES) {
    const bytes = await readFile(join(root, file)); inspectPublicSource(file, bytes);
    files.push({ path: file, bytes, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await mkdir(destination, { recursive: false });
  for (const file of files) {
    const target = join(destination, file.path); await mkdir(resolve(target, '..'), { recursive: true });
    await writeFile(target, file.bytes, { flag: 'wx' });
  }
  const manifest = { product: 'figma-local-bridge', version: JSON.parse((await readFile(join(root, 'package.json'))).toString()).version,
    files: files.map(({ path, sha256 }) => ({ path, sha256 })),
    excluded: ['credentials and session state', 'personal client configurations', 'local design captures', 'proprietary Figma extracts', 'research runtimes', 'Node download cache'] };
  await writeFile(join(destination, 'SOURCE-MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return { destination, fileCount: files.length, manifest: join(destination, 'SOURCE-MANIFEST.json') };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await mkdir(join(root, '.local', 'distribution'), { recursive: true });
  console.log(JSON.stringify(await packageSource(process.argv[2]), null, 2));
}
