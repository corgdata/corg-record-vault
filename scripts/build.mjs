import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(path.join(root, 'dist'), { recursive: true });
await build({entryPoints:[path.join(root,'client/main.js')],bundle:true,format:'esm',target:['es2022'],outfile:path.join(root,'dist/app.js'),minify:true,sourcemap:false,legalComments:'eof'});
await copyFile(path.join(root,'client/index.html'),path.join(root,'dist/index.html'));
await copyFile(path.join(root,'client/styles.css'),path.join(root,'dist/styles.css'));
console.log('Built Record Vault browser client.');

await mkdir(path.join(root,'dist/downloads'),{recursive:true});
try { await copyFile(path.join(root,'downloads/CORG_Record_Vault.zip'),path.join(root,'dist/downloads/CORG_Record_Vault.zip')); } catch(error) { if(error.code!=='ENOENT')throw error; }
