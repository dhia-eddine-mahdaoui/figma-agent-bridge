import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {packageSource} from './package-source.mjs';
import {desktopBundleBytes} from './desktop-bundle.mjs';
const output=resolve(process.argv[2]||'.local/verified-package');await mkdir(output,{recursive:true});
const packaged=await packageSource(join(output,'source'));
const manifest=JSON.parse(await readFile(packaged.manifest,'utf8'));
for(const entry of manifest.files){const bytes=await readFile(join(packaged.destination,entry.path));if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('Packaged source hash mismatch: '+entry.path);}
const zip=await desktopBundleBytes(packaged.destination);await writeFile(join(output,'figma-local-bridge-windows.zip'),zip,{flag:'wx'});
for(const script of ['verify-syntax.mjs','run-tests.mjs']){const child=spawnSync(process.execPath,[script],{cwd:packaged.destination,stdio:'inherit',windowsHide:true});if(child.status!==0)throw new Error('Clean-package check failed: '+script);}
console.log(JSON.stringify({verified:true,source:packaged.destination,sourceFiles:manifest.files.length,desktopBundle:join(output,'figma-local-bridge-windows.zip')}));
