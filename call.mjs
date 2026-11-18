import { readFile } from 'node:fs/promises';
import { callTool } from './client.mjs';
import { validateTool } from './contracts.mjs';
const name = process.argv[2] || 'figma_status';
const args = process.argv[3] ? JSON.parse(await readFile(process.argv[3],'utf8')) : {};
validateTool(name,args);
const result = await callTool(name,args);
console.log(JSON.stringify(result,null,2));
if (result.ok === false) process.exitCode = 1;
