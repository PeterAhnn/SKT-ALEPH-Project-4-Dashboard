import {mkdir,readFile,writeFile,rename,open,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {SOURCE,emptyState,validateState,validatePayload,normalizeWeatherPayload,applyReading,AppError} from '../public/core.mjs';

// Only the real system clock and the fixed public API are used here. No date overrides or fixture modes.
const base=new URL('../',import.meta.url),recordFile=new URL('public/data/observations.json',base),reviewFile=new URL('public/data/review-evidence.json',base),lockFile=new URL('public/data/collect.lock',base);
async function atomicJson(url,data){const temp=new URL(url.href+'.tmp');await writeFile(temp,JSON.stringify(data,null,2)+'\n');await rename(temp,url);}
await mkdir(new URL('public/data/',base),{recursive:true});
let lock;
try{lock=await open(lockFile,'wx');}catch{throw new Error('Another collection is running, or collect.lock needs review. No records changed.');}
try{
 let state;try{state=validateState(JSON.parse(await readFile(recordFile,'utf8')),{now:new Date().toISOString()});}catch(error){if(error.code==='ENOENT')state=emptyState();else throw error;}
 let review;try{review=JSON.parse(await readFile(reviewFile,'utf8'));if(review.version!==1||review.sourceId!==SOURCE.id||!Array.isArray(review.records)||review.records.length>2)throw new Error('Invalid review evidence');if(review.records.length)validateState({version:2,lastGood:review.records.at(-1).reading,days:review.records.map(record=>record.reading)},{now:new Date().toISOString()});}catch(error){if(error.code==='ENOENT')review={version:1,sourceId:SOURCE.id,records:[]};else throw error;}
 const response=await fetch(SOURCE.url,{signal:AbortSignal.timeout(8000),cache:'no-store'});
 if(!response.ok)throw new AppError('http',`HTTP ${response.status}`);
 const raw=await response.text(),fetchedAt=new Date().toISOString();let payload;try{payload=JSON.parse(raw);}catch{throw new AppError('invalid','Response is not JSON');}
 const reading=validatePayload(payload,fetchedAt),next=applyReading(state,reading),weather=normalizeWeatherPayload(payload,fetchedAt);
 const sha256=createHash('sha256').update(raw).digest('hex'),stamp=fetchedAt.replaceAll(':','-');
 const evidenceDir=new URL('public/data/evidence/',base);await mkdir(evidenceDir,{recursive:true});
 const evidence={kind:'real-public-fetch',sourceUrl:SOURCE.url,fetchedAt,reading,responseSha256:sha256,responseText:raw};
 await writeFile(new URL(`${stamp}.json`,evidenceDir),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
 if(review.records.length<2&&!review.records.some(record=>record.reading.kstDate===reading.kstDate))review.records.push({reading,evidencePath:`data/evidence/${stamp}.json`});
 await atomicJson(recordFile,next);await atomicJson(reviewFile,review);await atomicJson(new URL('public/data/weather.json',base),{fetchedAt,payload});
 console.log(JSON.stringify({collected:true,sourceId:SOURCE.id,kstDate:reading.kstDate,value:reading.value,unit:reading.unit,fetchedAt,observedAt:reading.observedAt,publicDays:next.days.length,reviewDays:review.records.length,hourly:weather.hourly.length,daily:weather.daily.length,forecastStatus:weather.forecast.status,responseSha256:sha256},null,2));
}finally{await lock.close();await unlink(lockFile);}
