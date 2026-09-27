import {mkdir,rm,copyFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)), relay=path.resolve(root,'..'), out=path.join(root,'dist/assets');
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
async function copyTree(src,dest,accept){await mkdir(dest,{recursive:true});for(const e of await readdir(src,{withFileTypes:true})){if(e.isDirectory())await copyTree(path.join(src,e.name),path.join(dest,e.name),accept);else if(accept(e.name))await copyFile(path.join(src,e.name),path.join(dest,e.name));}}
await copyTree(path.join(relay,'website'),out,n=>/\.(html|css|js|svg|ttf|txt|xml)$/.test(n));
await copyTree(path.join(relay,'public'),path.join(out,'_relay'),n=>['index.html','widget.js','session-transport.js','telemetry.js','sw.js','icon-192.svg','icon-512.svg'].includes(n));
await copyFile(path.join(relay,'public/telemetry.js'),path.join(out,'assets/telemetry.js'));
await copyFile(path.resolve(relay,'../../install.sh'),path.join(out,'install.sh'));
console.log('Built allowlisted public website and relay assets.');
