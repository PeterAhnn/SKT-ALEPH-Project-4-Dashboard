// Server-only: never return request URLs, upstream error text, or credentials.
import {EXTRA_SOURCES,getExtendedWeather} from './weather-extras.mjs';
import {MESSAGES,SourceError,kstParts,instant,publication,requestItems,num,str,fail} from './portal-source.mjs';
export {MESSAGES,SourceError,kstParts,instant,publication,requestItems} from './portal-source.mjs';
export const SOURCES = {
  current: 'https://www.data.go.kr/data/15084084/openapi.do',
  forecast: 'https://www.data.go.kr/data/15084084/openapi.do',
  mid: 'https://www.data.go.kr/data/15059468/openapi.do',
  warnings: 'https://www.data.go.kr/data/15000415/openapi.do',
  air: 'https://www.data.go.kr/data/15073861/openapi.do',
  ...EXTRA_SOURCES,
};
function weatherCode(sky, rain) { return +rain === 0 ? ({1:0,3:2,4:3}[sky] ?? null) : [3,7].includes(+rain) ? 73 : [1,2,4,5,6].includes(+rain) ? 61 : null; }
export function normalizeCurrent(items, issued) {
  const rows = items.filter(r => String(r.baseDate) === issued.base_date && String(r.baseTime).padStart(4,'0') === issued.base_time && +r.nx === 89 && +r.ny === 90);
  const values = Object.fromEntries(rows.map(r => [r.category, r.obsrValue]));
  const temperature = num(values.T1H,-80,60);
  if (temperature === null) return fail();
  return { observedAt: instant(issued.base_date, issued.base_time), temperature, relativeHumidity: num(values.REH,0,100), windSpeed: num(values.WSD,0,150), precipitation: num(values.RN1,0,1000), precipitationText: str(values.RN1,40), rainType: num(values.PTY,0,7), weatherCode: +values.PTY > 0 ? weatherCode(null,values.PTY) : null };
}
export function normalizeForecast(items, issued) {
  const groups = new Map();
  for (const row of items) {
    if (+row.nx !== 89 || +row.ny !== 90 || String(row.baseDate) !== issued.base_date || String(row.baseTime).padStart(4,'0') !== issued.base_time) continue;
    const at = instant(row.fcstDate, row.fcstTime);
    if (!groups.has(at)) groups.set(at, {});
    groups.get(at)[row.category] = row.fcstValue;
  }
  const hourly = [], days = new Map();
  for (const [time,v] of [...groups].sort(([a],[b]) => a.localeCompare(b))) {
    const date = time.slice(0,10);
    if (!days.has(date)) days.set(date,{date,temperatureMin:null,temperatureMax:null,precipitationProbabilityMax:null,weatherCode:null});
    const day = days.get(date), temp = num(v.TMP,-80,60), probability = num(v.POP,0,100), code = weatherCode(v.SKY,v.PTY);
    if (num(v.TMN,-80,60) !== null) day.temperatureMin = num(v.TMN,-80,60);
    if (num(v.TMX,-80,60) !== null) day.temperatureMax = num(v.TMX,-80,60);
    if (probability !== null) day.precipitationProbabilityMax = Math.max(day.precipitationProbabilityMax ?? 0,probability);
    if (code !== null) day.weatherCode = Math.max(day.weatherCode ?? 0,code);
    if (temp !== null) hourly.push({time,temperature:temp,precipitationProbability:probability,weatherCode:code});
  }
  if (!hourly.length) return fail();
  return { issuedAt: instant(issued.base_date,issued.base_time), hourly, daily:[...days.values()] };
}
export function normalizeMid(land, temperatures, issued) {
  const l = land.find(r=>r.regId === '11H10000'), t = temperatures.find(r=>r.regId === '11H10701');
  if (!l || !t) return fail();
  const days = [];
  for (let n=3;n<=11;n++) {
    const temperatureMin=num(t[`taMin${n}`],-80,60),temperatureMax=num(t[`taMax${n}`],-80,60);
    if (temperatureMin === null || temperatureMax === null) continue;
    const date=kstParts(new Date(Date.parse(instant(issued.tmFc.slice(0,8),'0000'))+n*86400000)).slice(0,8);
    const conditions=[l[`wf${n}Am`],l[`wf${n}Pm`],l[`wf${n}`]].filter(x=>typeof x==='string');
    const probabilities=[l[`rnSt${n}Am`],l[`rnSt${n}Pm`],l[`rnSt${n}`]].map(v=>num(v,0,100)).filter(v=>v!==null);
    days.push({date:`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`,temperatureMin,temperatureMax,condition:[...new Set(conditions)].join(' / '),precipitationProbabilityMax:probabilities.length?Math.max(...probabilities):null});
  }
  if (!days.length) return fail();
  return {issuedAt:instant(issued.tmFc.slice(0,8),issued.tmFc.slice(8)),days};
}
export function normalizeAir(items) {
  const rows=items.filter(r=>r.sidoName==='대구' && typeof r.stationName==='string');
  const row=rows.find(r=>r.stationName==='수창동') || rows.find(r=>r.stationName==='이곡동') || rows[0];
  if (!row || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(row.dataTime)) return fail();
  const observedAt = row.dataTime.replace(' ','T') + ':00+09:00';
  if (!Number.isFinite(Date.parse(observedAt))) return fail();
  // Invalid/missing measurements must not turn into zero or "good" air quality.
  return {station:str(row.stationName,60),observedAt,pm10:row.pm10Flag?null:num(row.pm10Value,0,2000),pm25:row.pm25Flag?null:num(row.pm25Value,0,2000),pm10Grade:num(row.pm10Grade1h,1,4),pm25Grade:num(row.pm25Grade1h,1,4)};
}
export function normalizeWarnings(items) {
  const row=[...items].sort((a,b)=>String(b.tmFc).localeCompare(String(a.tmFc)))[0];
  if (!row || !/^\d{12}$/.test(String(row.tmFc)) || typeof row.t6 !== 'string' || typeof row.t7 !== 'string') return fail();
  return {issuedAt:instant(String(row.tmFc).slice(0,8),String(row.tmFc).slice(8)),effectiveAt:row.tmEf?instant(String(row.tmEf).slice(0,8),String(row.tmEf).slice(8)):null,current:str(row.t6),preliminary:str(row.t7)};
}
export async function getPublicWeather(kind, {now=new Date(),key=process.env.DATA_GO_KR_SERVICE_KEY,fetchImpl=fetch}={}) {
  if (!Object.hasOwn(SOURCES,kind)) return fail('invalid');
  if (Object.hasOwn(EXTRA_SOURCES,kind)) return getExtendedWeather(kind,{now,key,fetchImpl});
  const call=(path,params)=>requestItems(path,params,{key,fetchImpl});
  let data;
  if (kind==='current' || kind==='forecast') {
    let issued=publication(now,kind), items;
    try { items=await call(`1360000/VilageFcstInfoService_2.0/${kind==='current'?'getUltraSrtNcst':'getVilageFcst'}`,{...issued,nx:89,ny:90,numOfRows:2000}); }
    catch(error) {
      if(error.code!=='no_data') throw error;
      issued=publication(new Date(+now-(kind==='current'?1:3)*3600000),kind);
      items=await call(`1360000/VilageFcstInfoService_2.0/${kind==='current'?'getUltraSrtNcst':'getVilageFcst'}`,{...issued,nx:89,ny:90,numOfRows:2000});
    }
    data=kind==='current'?normalizeCurrent(items,issued):normalizeForecast(items,issued);
  } else if(kind==='mid') {
    const issued=publication(now,'mid');
    const [land,ta]=await Promise.all([call('1360000/MidFcstInfoService/getMidLandFcst',{...issued,regId:'11H10000'}),call('1360000/MidFcstInfoService/getMidTa',{...issued,regId:'11H10701'})]);
    data=normalizeMid(land,ta,issued);
  } else if(kind==='air') data=normalizeAir(await call('B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty',{returnType:'json',sidoName:'대구',ver:'1.3',numOfRows:100}));
  else data=normalizeWarnings(await call('1360000/WthrWrnInfoService/getPwnStatus',{numOfRows:10}));
  return {ok:true,kind,sourceUrl:SOURCES[kind],fetchedAt:now.toISOString(),timezone:'Asia/Seoul',data};
}
