import {readFile} from 'node:fs/promises';
import {PRODUCT,PROTOCOL} from './connection.mjs';
// An SSH command does not inherit the MCP entry's data-directory environment.
if(!process.env.FIGMA_BRIDGE_DATA_DIR){try{const machine=JSON.parse(await readFile(new URL('./installation.json',import.meta.url),'utf8'));if(typeof machine.dataDirectory==='string')process.env.FIGMA_BRIDGE_DATA_DIR=machine.dataDirectory;}catch(error){if(error.code!=='ENOENT')throw error;}}
const {ensureService,health}=await import('./runtime.mjs');
const session=await ensureService();
if(!await health(session))throw new Error('The owned remote companion could not be verified');
// This is consumed over authenticated SSH. No credential ever leaves the remote host.
console.log(JSON.stringify({product:PRODUCT,protocol:PROTOCOL,remotePort:Number(new URL(session.url).port)}));
