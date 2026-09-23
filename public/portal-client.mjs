export const KINDS = ['current','forecast','mid','air','warnings'];
export const TITLES = {current:'현재 날씨',forecast:'단기예보',mid:'중기예보',air:'대기질',warnings:'기상특보'};
export const CACHE_KEY = 'daegu-portal-cache-v1';
const ages = {current:2,forecast:6,mid:18,air:3,warnings:1};
const finite = (v,min,max) => typeof v === 'number' && Number.isFinite(v) && v>=min && v<=max;
const optional = (v,min,max) => v===null || finite(v,min,max);
const date = v => typeof v==='string' && Number.isFinite(Date.parse(v));
const temperature = v => optional(v,-80,60);
const probability = v => optional(v,0,100);
export function validPart(part,kind,now=Date.now()) {
  if(!part||part.ok!==true||part.kind!==kind||!date(part.fetchedAt)||Date.parse(part.fetchedAt)>now+300000||part.timezone!=='Asia/Seoul')return false;
  const d=part.data;
  if(!d||!date(d.observedAt||d.issuedAt))return false;
  if(kind==='current')return finite(d.temperature,-80,60)&&optional(d.relativeHumidity,0,100)&&optional(d.windSpeed,0,150)&&optional(d.precipitation,0,1000)&&optional(d.rainType,0,7);
  if(kind==='forecast')return Array.isArray(d.hourly)&&d.hourly.length>0&&Array.isArray(d.daily)&&d.hourly.every(h=>date(h.time)&&finite(h.temperature,-80,60)&&probability(h.precipitationProbability))&&d.daily.every(day=>date(day.date)&&temperature(day.temperatureMin)&&temperature(day.temperatureMax)&&probability(day.precipitationProbabilityMax));
  if(kind==='mid')return Array.isArray(d.days)&&d.days.length>0&&d.days.every(day=>date(day.date)&&finite(day.temperatureMin,-80,60)&&finite(day.temperatureMax,-80,60)&&typeof day.condition==='string'&&probability(day.precipitationProbabilityMax));
  if(kind==='air')return typeof d.station==='string'&&optional(d.pm10,0,2000)&&optional(d.pm25,0,2000);
  return kind==='warnings'&&typeof d.current==='string'&&typeof d.preliminary==='string';
}
export function isPartOld(part,now=Date.now()) {
  if(!part)return false;
  const source=Date.parse(part.data.observedAt||part.data.issuedAt);
  // A warning bulletin can remain effective for days: freshness is last successful lookup.
  return now-Date.parse(part.fetchedAt)>ages[part.kind]*3600000 || (part.kind!=='warnings'&&now-source>ages[part.kind]*3600000);
}
export function combineWeather(parts) {
  if(!parts.current&&!parts.forecast)return null;
  return {current:parts.current?.data??null,reading:{observedAt:parts.current?.data.observedAt??null},fetchedAt:parts.current?.fetchedAt??null,hourly:parts.forecast?.data.hourly??[],daily:parts.forecast?.data.daily??[],forecast:{message:''}};
}
export async function fetchPart(kind,fetchImpl=fetch) {
  if(typeof navigator!=='undefined'&&navigator.onLine===false)throw new Error('오프라인입니다. 인터넷 연결 후 다시 시도해 주세요.');
  let response,payload;
  try{response=await fetchImpl(`/api/weather?kind=${kind}`,{signal:AbortSignal.timeout(30000)});payload=await response.json();}
  catch(error){throw new Error(['TimeoutError','AbortError'].includes(error.name)?'응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.':'자료를 받지 못했습니다. 연결을 확인하고 다시 시도해 주세요.');}
  if(!response.ok||!validPart(payload,kind))throw new Error(payload?.error?.message||'응답 형식이 달라 새 값으로 저장하지 않았습니다.');
  return payload;
}
