import {cp,mkdir,rm,lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('.',import.meta.url))),output=path.resolve(root,'dist');
if(path.dirname(output)!==root||path.basename(output)!=='dist')throw new Error('Build output must be this project’s dist directory.');
try{if((await lstat(output)).isSymbolicLink())throw new Error('Refusing to replace a linked output directory.');}catch(error){if(error.code!=='ENOENT')throw error;}
await rm(output,{recursive:true,force:true});await mkdir(output);await cp(path.join(root,'public'),output,{recursive:true});console.log('Built a clean public/ snapshot into dist/');
