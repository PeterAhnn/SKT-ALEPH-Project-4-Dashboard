import {SourceError,instant,num} from './portal-source.mjs';
export async function hubText(path,params,{key=process.env.KMA_APIHUB_KEY,fetchImpl=fetch}={}) {
  if(!key?.trim())throw new SourceError('configuration');
  const url=new URL(path,'https://apihub.kma.go.kr/api/typ01/');
  for(const [k,v]of Object.entries({...params,authKey:key.trim()}))url.searchParams.set(k,String(v));
  try {
    const r=await fetchImpl(url,{signal:AbortSignal.timeout(12000),redirect:'error'});
    if([401,403].includes(r.status))throw new SourceError('auth');
    if(r.status===429)throw new SourceError('rate');
    if(!r.ok)throw new SourceError('network');
    const raw=new TextDecoder('euc-kr').decode(await r.arrayBuffer());
    if(/ERROR|<html|SERVICE_KEY/i.test(raw)||raw.includes(key))throw new SourceError('invalid');
    return raw;
  }catch(e){if(e instanceof SourceError)throw e;throw new SourceError(['TimeoutError','AbortError'].includes(e.name)?'timeout':'network');}
}
export function parseTable(raw) {
  const lines=raw.split(/\r?\n/),header=lines.find(l=>/^#\s*(?:YYMMDDHHMI|TM)\s+STN(?:_ID)?\b/.test(l));
  if(!header)throw new SourceError('invalid');
  const keys=header.replace(/^#\s*/,'').trim().split(/\s+/);
  const rows=lines.filter(l=>/^\d{12}\s/.test(l.trim())).map(l=>{
    const cells=l.trim().split(/\s+/);if(cells.length!==keys.length)throw new SourceError('invalid');
    return Object.fromEntries(keys.map((k,i)=>[k,cells[i]]));
  });
  return rows;
}
export function normalizeSurface(raw) {
  const r=parseTable(raw).filter(r=>r.STN==='143').at(-1);if(!r)throw new SourceError('no_data');
  const stamp=r.YYMMDDHHMI||r.TM,observedAt=instant(stamp.slice(0,8),stamp.slice(8));
  const fields=[['TA','기온','°C',-80,60],['TD','이슬점','°C',-80,60],['HM','습도','%',0,100],['WS','바람','m/s',0,150],['PS','해면기압','hPa',800,1100],['RN_DAY','오늘 누적 강수','mm',0,2000],['SD_TOT','적설','cm',0,1000],['CA_TOT','구름량','/10',0,10],['VS','시정','km',0,100000],['TS','지면온도','°C',-80,100],['SS','일조','시간',0,24],['SI','일사','MJ/m²',0,100]];
  const metrics=fields.map(([key,label,unit,min,max])=>({label,unit,value:num(r[key],min,max)})).filter(m=>m.value!==null).map(m=>m.label==='시정'?{...m,value:Math.round(m.value/100*100)/100}:m);
  if(!metrics.length)throw new SourceError('no_data');
  return {type:'metrics',station:'대구 종관관측소 143',observedAt,metrics};
}
export async function getHubSurface(options={}) {return normalizeSurface(await hubText('url/kma_sfctm2.php',{tm:0,stn:143,help:0},options));}

export async function getHubMetric(kind,options={}) {
 const raw=await hubText(kind==='dust'?'url/kma_pm10.php':'url/kma_sfctm_uv.php',kind==='dust'?{stn:143}:{tm:0,stn:143,help:0},options);
 const r=parseTable(raw).filter(r=>(r.STN||r.STN_ID)==='143').at(-1);if(!r)throw new SourceError('no_data');
 const stamp=r.YYMMDDHHMI||r.TM,value=num(kind==='dust'?r.PM10:r['UV-B']??r.UVB,0,kind==='dust'?2000:30);
 if(value===null)throw new SourceError('no_data');
 // Provider quality flags must be explicitly normal if present.
 if(kind==='dust'&&[r.FLAG,r.MQC].some(v=>v!==undefined&&!['0','00'].includes(v)))throw new SourceError('no_data');
 return {type:'metrics',station:'대구 관측지점 143',observedAt:instant(stamp.slice(0,8),stamp.slice(8)),metrics:[{label:kind==='dust'?'황사 관측 PM10':'관측 자외선지수',value,unit:kind==='dust'?'µg/m³':'지수'}]};
}
