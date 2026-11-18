import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('.',import.meta.url));
const files=['plugin/manifest.json','plugin/code.js','plugin/ui.html','connect-ssh.ps1','Connect.cmd','LICENSE'];
const guide=`Figma on Windows + AI on remote WSL/SSH

This bundle is for the Windows PC running Figma. It contains no credentials,
Node runtime, SSH configuration, or personal machine addresses.

1. Extract this entire ZIP into a permanent Windows folder.
2. Double-click Connect.cmd. Enter the SSH alias or user@host you normally use.
   Working Windows OpenSSH key/agent authentication is required. The helper
   creates only a loopback SSH tunnel and keeps it alive in the background.
3. Import plugin/manifest.json from THIS Windows folder in Figma Desktop,
   if a matching development plugin is not already imported.
4. Run Figma Agent Bridge (Local), choose Pair this computer, then approve
   the localhost browser page once. Ask the remote agent to verify connected:true.

For later sessions, run Connect.cmd if the tunnel stopped, then run the plugin.
It remembers the SSH host; the plugin remembers the remote pairing.
Closing the launcher window does not close the background tunnel.
Use powershell -File .\\connect-ssh.ps1 -Stop to stop only this managed tunnel.

The remote agent/companion remain on WSL. A path under \\\\wsl.localhost only
reaches WSL on the Windows PC opening that path, not another SSH computer.
The helper discovers the remote installed companion and selects an available
Windows IPv4 port from 4318-4327. It never stops unrelated services or local
companions. If several companions match, choose its printed port under Advanced
connection in the plugin. Upgrade the remote companion and this bundle together.
For a custom remote install use -RemoteInstallation /absolute/install/path;
RemotePort is optional and must match the discovered remote session.
No firewall/global SSH configuration/startup settings are modified.
`;
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
// Small deterministic ZIP writer (stored entries); no npm/archive dependency.
export async function desktopBundleBytes(source=root){
  const entries=await Promise.all(files.map(async path=>({path,bytes:await readFile(resolve(source,path))})));
  entries.push({path:'START-HERE.txt',bytes:Buffer.from(guide)});
  const locals=[],central=[];let offset=0;
  for(const entry of entries){
    const name=Buffer.from(entry.path),size=entry.bytes.length,crc=crc32(entry.bytes);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(0x21,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(size,18);header.writeUInt32LE(size,22);header.writeUInt16LE(name.length,26);
    locals.push(header,name,entry.bytes);
    const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);directory.writeUInt16LE(0x21,14);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(size,20);directory.writeUInt32LE(size,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(offset,42);central.push(directory,name);
    offset+=header.length+name.length+size;
  }
  const centralBytes=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(centralBytes.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,centralBytes,end]);
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const target=resolve(process.argv[2]||'.local/desktop/figma-local-bridge-windows.zip');await mkdir(dirname(target),{recursive:true});await writeFile(target,await desktopBundleBytes(),{flag:'wx'});console.log(JSON.stringify({filePath:target,containsCredentials:false}));
}
