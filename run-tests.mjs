import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
const tests = (await readdir(new URL('./test/', import.meta.url))).filter(file => file.endsWith('.test.mjs')).sort();
// Isolate suites that bind shared discovery ports and copy portable runtimes.
// Concurrency is still exercised explicitly within the startup/race tests.
const result = spawnSync(process.execPath, ['--test','--test-concurrency=1', ...tests.map(file => `test/${file}`)], { cwd: root, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
