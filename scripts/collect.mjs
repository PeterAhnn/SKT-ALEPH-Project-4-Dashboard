import {mkdir,readFile,writeFile,rename,open,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {SOURCE,emptyState,validateState,validatePayload,applyReading,AppError} from '../public/core.mjs';

// Only the real system clock and the fixed public API are used here. No date overrides or fixture modes.
const base=new URL('../',import.meta.url),recordFile=new URL('public/data/observations.json',base),lockFile=new URL('public/data/collect.lock',base);
await mkdir(new URL('public/data/',base),{recursive:true});
let lock;
try{lock=await open(lockFile,'wx');}catch{throw new Error('Another collection is running, or collect.lock needs review. No records changed.');}
try{
 let state;try{state=validateState(JSON.parse(await readFile(recordFile,'utf8')));}catch(error){if(error.code==='ENOENT')state=emptyState();else throw error;}
 const response=await fetch(SOURCE.url,{signal:AbortSignal.timeout(8000),cache:'no-store'});
 if(!response.ok)throw new AppError('http',`HTTP ${response.status}`);
 const raw=await response.text(),fetchedAt=new Date().toISOString();let payload;try{payload=JSON.parse(raw);}catch{throw new AppError('invalid','Response is not JSON');}
 const reading=validatePayload(payload,fetchedAt),next=applyReading(state,reading);
 const sha256=createHash('sha256').update(raw).digest('hex'),stamp=fetchedAt.replaceAll(':','-');
 const evidenceDir=new URL('public/data/evidence/',base);await mkdir(evidenceDir,{recursive:true});
 const evidence={kind:'real-public-fetch',sourceUrl:SOURCE.url,fetchedAt,reading,responseSha256:sha256,responseText:raw};
 await writeFile(new URL(`${stamp}.json`,evidenceDir),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
 const temp=new URL('public/data/observations.json.tmp',base);await writeFile(temp,JSON.stringify(next,null,2)+'\n');await rename(temp,recordFile);
 console.log(JSON.stringify({collected:true,kstDate:reading.kstDate,value:reading.value,unit:reading.unit,fetchedAt,observedAt:reading.observedAt,publicDays:next.days.length,responseSha256:sha256},null,2));
}finally{await lock.close();await unlink(lockFile);}
