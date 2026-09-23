import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const findings=[];let worktreeFiles=0,historyBlobs=0;
const signatures=[['GitHub token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/],['AWS access key',/\bAKIA[A-Z0-9]{16}\b/],['Google API key',/\bAIza[0-9A-Za-z_-]{30,}\b/],['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['OpenAI-style key',/\bsk-(?:proj-)?[A-Za-z0-9_-]{35,}\b/]];
let localSecretValues=[];
for(const envName of (await readdir('.')).filter(name=>/^\.env(?:\..+)?\.local$/.test(name)||name==='.env.local')){
try{const env=await readFile(envName,'utf8');localSecretValues.push(...env.split(/\r?\n/).filter(line=>!line.startsWith('#')&&line.includes('=')).map(line=>line.slice(line.indexOf('=')+1).replace(/^["']|["']$/g,'')).filter(value=>value.length>=24));}catch(error){if(error.code!=='ENOENT')throw error;}
}
function scan(label,bytes){const text=bytes.toString('utf8');for(const [kind,pattern]of signatures)if(pattern.test(text))findings.push({location:label,kind});if(localSecretValues.some(value=>text.includes(value)))findings.push({location:label,kind:'local environment secret value'});}
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else{worktreeFiles++;scan(file,await readFile(file));}}}
for(const dir of ['public','docs','api','lib'])await walk(dir);
const objectLines=execFileSync('git',['rev-list','--objects','--all'],{encoding:'utf8'}).trim().split('\n');
const objectPaths=new Map(objectLines.map(line=>{const index=line.indexOf(' ');return[index<0?line:line.slice(0,index),index<0?'':line.slice(index+1)];}));
const data=execFileSync('git',['cat-file','--batch'],{input:[...objectPaths.keys()].join('\n')+'\n',maxBuffer:64*1024*1024});
let cursor=0;while(cursor<data.length){const end=data.indexOf(10,cursor);if(end<0)break;const [sha,type,sizeText]=data.subarray(cursor,end).toString().split(' ');const size=Number(sizeText);if(!Number.isFinite(size))throw new Error('Unexpected Git object response');const body=data.subarray(end+1,end+1+size);if(type==='blob'){historyBlobs++;scan(`git:${sha}:${objectPaths.get(sha)}`,body);}cursor=end+1+size+1;}
const tracked=execFileSync('git',['ls-files'],{encoding:'utf8'}).split('\n');const trackedSensitiveFiles=tracked.filter(file=>/^(?:\.env(?:\.|$)|\.vercel\/|\.gstack\/)/.test(file));
const source=await import('../public/core.mjs');const url=new URL(source.SOURCE.url);const secretQueryParams=[...url.searchParams.keys()].filter(key=>/key|token|secret|password/i.test(key));
const report={checkedAt:new Date().toISOString(),historyHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),worktreeFiles,historyBlobs,signatureKinds:signatures.map(x=>x[0]),localSecretValuesCompared:localSecretValues.length,findings,trackedSensitiveFiles,sourceUrl:source.SOURCE.url,secretQueryParams,note:'Pattern and exact local-secret search; reports no secret values. Network response reviewed separately in browser.'};
await mkdir('docs/verification',{recursive:true});await writeFile('docs/verification/secret-scan.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({worktreeFiles,historyBlobs,findings:findings.length,trackedSensitiveFiles:trackedSensitiveFiles.length,secretQueryParams:secretQueryParams.length}));
if(findings.length||trackedSensitiveFiles.length||secretQueryParams.length)process.exitCode=1;
