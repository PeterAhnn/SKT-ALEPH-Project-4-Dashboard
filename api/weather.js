import { getPublicWeather, SourceError, SOURCES, MESSAGES } from '../lib/public-weather.mjs';
const cache = new Map(), pending = new Map();
export default async function handler(req,res) {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET') { res.setHeader('Allow','GET'); res.statusCode=405; return res.end(JSON.stringify({ok:false,error:{code:'method',message:'GET 요청만 지원합니다.'}})); }
  const query=new URL(req.url,'https://localhost').searchParams,kind=query.get('kind');
  if(!Object.hasOwn(SOURCES,kind)||[...query.keys()].some(k=>k!=='kind')||query.getAll('kind').length!==1){res.statusCode=400;return res.end(JSON.stringify({ok:false,error:{code:'invalid',message:'올바른 조회 항목을 선택해 주세요.'}}));}
  const ttl=(kind==='air'?30:kind==='mid'?60:10)*60000;
  try {
    let result=cache.get(kind);
    if(!result||Date.now()-Date.parse(result.fetchedAt)>=ttl){
      if(!pending.has(kind)) pending.set(kind,getPublicWeather(kind).then(value=>{cache.set(kind,value);return value;}).finally(()=>pending.delete(kind)));
      result=await pending.get(kind);
    }
    // TTL in the browser uses original fetchedAt, never the cache delivery time.
    res.setHeader('Cache-Control','public, max-age=0, s-maxage=300');
    const body=JSON.stringify(result),key=process.env.DATA_GO_KR_SERVICE_KEY?.trim();
    if(key&&[key,encodeURIComponent(key)].some(secret=>body.includes(secret))) throw new SourceError('invalid');
    res.statusCode=200;res.end(body);
  }catch(error){
    res.setHeader('Cache-Control','no-store');res.statusCode=503;
    const code=error instanceof SourceError?error.code:'network';
    res.end(JSON.stringify({ok:false,kind,error:{code,message:MESSAGES[code]||MESSAGES.network}}));
  }
}
