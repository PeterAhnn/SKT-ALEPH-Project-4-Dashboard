import {regionById,DEFAULT_REGION} from '../public/regions.mjs';
import { getPublicWeather, SourceError, SOURCES, MESSAGES } from '../lib/public-weather.mjs';
const cache = new Map(), pending = new Map();
export default async function handler(req,res) {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET') { res.setHeader('Allow','GET'); res.statusCode=405; return res.end(JSON.stringify({ok:false,error:{code:'method',message:'GET 요청만 지원합니다.'}})); }
  const query=new URL(req.url,'https://localhost').searchParams,kind=query.get('kind'),regionId=query.get('region')||DEFAULT_REGION,cacheId=kind+':'+regionId;
  if(!Object.hasOwn(SOURCES,kind)||[...query.keys()].some(k=>!['kind','region'].includes(k))||query.getAll('kind').length!==1||query.getAll('region').length>1||!regionById(regionId)){res.statusCode=400;return res.end(JSON.stringify({ok:false,error:{code:'invalid',message:'올바른 조회 항목을 선택해 주세요.'}}));}
  const ttl=({air:30,mid:60,radar:5,satellite:5,lightning:5,chart:60,uv:60,diffusion:60,pollen:120,observations:360,impact:60,typhoon:30,airport:5,takeoff:10}[kind]||10)*60000;
  try {
    let result=cache.get(cacheId);
    if(!result||Date.now()-Date.parse(result.fetchedAt)>=ttl){
      if(!pending.has(cacheId)) pending.set(cacheId,getPublicWeather(kind,{regionId}).then(value=>{if(cache.size>=500)cache.delete(cache.keys().next().value);cache.set(cacheId,value);return value;}).finally(()=>pending.delete(cacheId)));
      result=await pending.get(cacheId);
    }
    // TTL in the browser uses original fetchedAt, never the cache delivery time.
    res.setHeader('Cache-Control','public, max-age=0, s-maxage=300');
    const body=JSON.stringify(result),keys=[process.env.DATA_GO_KR_SERVICE_KEY,process.env.KMA_APIHUB_KEY].map(k=>k?.trim()).filter(Boolean);
    if(keys.some(key=>[key,encodeURIComponent(key)].some(secret=>body.includes(secret)))) throw new SourceError('invalid');
    res.statusCode=200;res.end(body);
  }catch(error){
    res.setHeader('Cache-Control','no-store');res.statusCode=503;
    const code=error instanceof SourceError?error.code:'network';
    res.end(JSON.stringify({ok:false,kind,error:{code,message:MESSAGES[code]||MESSAGES.network}}));
  }
}
