import {requestItems, SourceError, kstParts, instant} from './portal-source.mjs';

export const EXTRA_SOURCES = Object.freeze({
  radar:'https://www.data.go.kr/data/15056924/openapi.do',
  satellite:'https://www.data.go.kr/data/15058167/openapi.do',
  lightning:'https://www.data.go.kr/data/15057256/openapi.do',
  chart:'https://www.data.go.kr/data/15043562/openapi.do',
  uv:'https://www.data.go.kr/data/15085288/openapi.do',
  diffusion:'https://www.data.go.kr/data/15085288/openapi.do',
  pollen:'https://www.data.go.kr/data/15085289/openapi.do',
  impact:'https://www.data.go.kr/data/15095149/openapi.do',
  typhoon:'https://www.data.go.kr/data/15043565/openapi.do',
  observations:'https://www.data.go.kr/data/15057210/openapi.do',
  airport:'https://www.data.go.kr/data/15058804/openapi.do',
  takeoff:'https://www.data.go.kr/data/15095109/openapi.do',
  taf:'https://www.data.go.kr/data/15058804/openapi.do',
  airportBrief:'https://www.data.go.kr/data/15110052/openapi.do',
});
const n=(v,min=-100,max=10000)=>v===null||v===undefined||String(v).trim()===''?null:Number.isFinite(+v)&&+v>=min&&+v<=max?+v:null;
const text=(v,max=2000)=>typeof v==='string'?v.slice(0,max):'';
const invalid=()=>{throw new SourceError('invalid');};
function timestamp(value){
  const v=String(value).replace(/[- :T]/g,'').slice(0,12);
  return /^\d{12}$/.test(v)?instant(v.slice(0,8),v.slice(8)):null;
}
export function safeImageUrl(value) {
  try {
    const u=new URL(value);
    if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port||u.search||u.hash)return null;
    if(!['weather.go.kr','kma.go.kr'].some(host=>u.hostname===host||u.hostname.endsWith('.'+host)))return null;
    if(!/\.(png|gif|jpe?g)$/i.test(u.pathname))return null;
    u.protocol='https:';return u.href;
  }catch{return null;}
}
export function normalizeImages(items,kind) {
  const urls=[];
  const visit=value=>{
    if(Array.isArray(value))value.forEach(visit);
    else if(value&&typeof value==='object')Object.values(value).forEach(visit);
    else if(typeof value==='string')for(const found of value.replaceAll('\\/','/').matchAll(/https?:\/\/[^\s,"'<>\[\]]+/g)){const url=safeImageUrl(found[0]);if(url)urls.push(url);}
  };
  visit(items);
  const frames=[...new Set(urls)].map(url=>{
    const fileName=new URL(url).pathname.split('/').at(-1),stamp=fileName.match(/(20\d{10})(?:\D|$)/)?.[1];
    // Only the satellite API explicitly documents the filename timestamp as UTC.
    const observedAt=kind==='satellite'&&stamp?instant(stamp.slice(0,8),stamp.slice(8)).replace('+09:00','Z'):null;
    return {url,fileName,observedAt,fileTime:stamp||null};
  }).sort((a,b)=>(a.fileTime||a.fileName).localeCompare(b.fileTime||b.fileName)).slice(-12);
  if(!frames.length)invalid();
  return {type:'images',frames,scope:kind==='chart'?'동아시아':'한반도',timeBasis:kind==='satellite'?'UTC 파일시각을 KST로 변환':'영상 안에 표시된 시각·범례 기준'};
}
export function normalizeIndex(items,kind) {
  const row=items.find(r=>String(r.areaNo)==='2700000000')||items.find(r=>String(r.areaNo).startsWith('27'));
  if(!row)return invalid();
  const issuedAt=timestamp(String(row.date).padEnd(12,'0'));
  if(!issuedAt)return invalid();
  const points=[];
  for(const [field,value] of Object.entries(row)) {
    if(!/^h\d+$/.test(field))continue;
    const val=n(value,0,kind==='uv'?30:100);
    if(val!==null)points.push({time:new Date(Date.parse(issuedAt)+Number(field.slice(1))*3600000).toISOString(),value:val});
  }
  // Seasonal pollen APIs provide today/tomorrow rather than 3-hour samples.
  if(!points.length)for(const [field,offset] of [['today',0],['tomorrow',1],['dayaftertomorrow',2],['todaysaftertomorrow',3]]){
    const val=n(row[field],0,3);if(val!==null)points.push({time:new Date(Date.parse(issuedAt.slice(0,10)+'T00:00:00+09:00')+offset*86400000).toISOString(),value:val});
  }
  if(!points.length)throw new SourceError('no_data');
  return {type:'index',issuedAt,area:'대구',areaCode:String(row.areaNo),points:points.sort((a,b)=>a.time.localeCompare(b.time))};
}
export function normalizeObservations(items,day) {
  const points=items.filter(r=>String(r.stnId)==='143').map(r=>({time:timestamp(r.tm),temperature:n(r.ta,-80,60),humidity:n(r.hm,0,100),windSpeed:n(r.ws,0,150),precipitation:n(r.rn,0,1000)})).filter(p=>p.time&&p.time.slice(0,10)===day&&p.temperature!==null).sort((a,b)=>a.time.localeCompare(b.time));
  if(!points.length)invalid();
  return {type:'observations',station:'대구 종관관측소',stationId:'143',date:day,observedAt:points.at(-1).time,points};
}
export function normalizeAirport(items,now) {
  const row=items.find(r=>r.icaoCode==='RKTN');
  if(!row||typeof row.metarMsg!=='string'||!row.metarMsg.includes('RKTN'))throw new SourceError('no_data');
  const report=text(row.metarMsg),stamp=report.match(/\b(\d{2})(\d{2})(\d{2})Z\b/);
  if(!stamp)invalid();
  // METAR uses UTC day-of-month; select the closest non-future month at rollover.
  const candidates=[-1,0,1].map(offset=>new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+offset,+stamp[1],+stamp[2],+stamp[3]))).filter(d=>d.getUTCDate()===+stamp[1]&&+d<=+now+300000).sort((a,b)=>b-a);
  if(!candidates.length)invalid();
  const wind=report.match(/\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)\b/),temp=report.match(/\b(M?\d{2})\/(M?\d{2}|\/\/)\b/),visibility=report.match(/\b(\d{4})\b/),qnh=report.match(/\bQ(\d{4})\b/);
  return {type:'airport',station:'대구공항',icao:'RKTN',observedAt:candidates[0].toISOString(),report,temperature:temp?n(temp[1].replace('M','-'),-80,60):null,wind:wind?`${wind[1]==='VRB'?'방향 변동':wind[1]+'°'} ${+wind[2]} ${wind[4]==='KT'?'kt':'m/s'}${wind[3]?' · 돌풍 '+Number(wind[3]):''}`:null,visibility:report.includes('CAVOK')?'10 km 이상':visibility?(+visibility[1]===9999?'10 km 이상':Number(visibility[1])+' m'):null,pressure:qnh?n(qnh[1],850,1100):null};
}
export function normalizeTakeoff(items,issuedAt) {
  const rows=items.filter(r=>r.icaoCode==='RKTN').map(r=>({time:timestamp(r.tmFc)?.replace('+09:00','Z'),temperature:n(r.ta,-80,60),windDirection:n(r.wd,0,360),windSpeed:n(r.ws,0,200),qnhInHg:n(r.qnh,2500,3500)===null?null:Math.round(Number(r.qnh))/100})).filter(r=>r.time);
  if(!rows.length)throw new SourceError('no_data');
  return {type:'takeoff',icao:'RKTN',issuedAt,rows:rows.sort((a,b)=>a.time.localeCompare(b.time))};
}
export function normalizeTaf(items,now){
  const row=items.find(r=>r.icaoCode==='RKTN');
  if(!row||typeof row.tafMsg!=='string'||!row.tafMsg.includes('RKTN'))throw new SourceError('no_data');
  const parsed=normalizeAirport([{icaoCode:'RKTN',metarMsg:row.tafMsg}],now);
  return {type:'taf',icao:'RKTN',issuedAt:parsed.observedAt,report:text(row.tafMsg,5000)};
}
function normalizeAirportBrief(items,issuedAt){
  const row=items.find(r=>/대구/.test(r.title||''));
  if(!row)throw new SourceError('no_data');
  return {type:'airportBrief',icao:'RKTN',issuedAt,title:text(row.title,200),summary:text(row.summary,6000),outlook:text(row.outlook,6000),forecast:text(row.forecast,6000),warning:text(row.warn,6000)};
}
function normalizeTyphoon(items) {
  const latest=new Map();
  for(const row of items){if(!row.typName||!row.tmFc)continue;const id=String(row.typSeq);if(!latest.has(id)||String(latest.get(id).tmFc)<String(row.tmFc))latest.set(id,row);}
  const rows=[...latest.values()].map(r=>({name:text(r.typName,60),issuedAt:timestamp(r.tmFc),observedAt:timestamp(r.typTm),location:text(r.typLoc,200),direction:text(r.typDir,30),speed:n(r.typSp,0,300),pressure:n(r.typPs,800,1100),windSpeed:n(r.typWs,0,150),note:text(r.rem),image:safeImageUrl(r.img)}));
  if(!rows.length)invalid();
  return {type:'typhoon',rows};
}
function normalizeImpact(items) {
  const rows=items.filter(r=>/대구/.test(r.regName||'')).map(r=>({area:text(r.regName,100),validAt:timestamp(r.tmEf),field:text(String(r.clsfc),100),level:n(r.value,0,4)}));
  if(!rows.length)return {type:'empty',message:'조회한 발표 자료에 대구 대상 영향예보가 없습니다. 특보와 최신 발표도 함께 확인하세요.'};
  return {type:'impact',rows};
}
export async function getExtendedWeather(kind,{now,key,fetchImpl}) {
  const call=(path,params)=>requestItems(path,params,{key,fetchImpl});
  const day=kstParts(now).slice(0,8),yesterday=kstParts(new Date(+now-86400000)).slice(0,8);
  let data;
  try {
    if(['radar','satellite','lightning','chart'].includes(kind)){
      const config={radar:['1360000/RadarImgInfoService/getCmpImg',{data:'CMP_WRC',time:day}],satellite:['1360000/SatlitImgInfoService/getInsightSatlit',{sat:'G2',data:'ir105',area:'ko',time:day}],lightning:['1360000/LgtDistrbInfoService/getLgtDistrb',{time:kstParts(new Date(+now-10*60000)).replace('T','').slice(0,12),ds1:1,ds2:60,map:'E',size:760}],chart:['1360000/WthrChartInfoService/getSurfaceChart',{code:24,time:day}]}[kind];
      data=normalizeImages(await call(config[0],config[1]),kind);
    }else if(['uv','diffusion','pollen'].includes(kind)){
      const issued=kstParts(new Date(+now-30*60000));const hour=Math.floor(Number(issued.slice(9,11))/3)*3;
      const time=issued.slice(0,8)+String(hour).padStart(2,'0');
      const path=kind==='pollen'?'1360000/HealthWthrIdxServiceV3/getWeedsPollenRiskndxV3':`1360000/LivingWthrIdxServiceV5/${kind==='uv'?'getUVIdxV5':'getAirDiffusionIdxV5'}`;
      data=normalizeIndex(await call(path,{areaNo:'2700000000',time}),kind);
    }else if(kind==='observations'){
      data=normalizeObservations(await call('1360000/AsosHourlyInfoService/getWthrDataList',{dataCd:'ASOS',dateCd:'HR',startDt:yesterday,startHh:'00',endDt:yesterday,endHh:'23',stnIds:'143',numOfRows:24}),`${yesterday.slice(0,4)}-${yesterday.slice(4,6)}-${yesterday.slice(6,8)}`);
    }else if(kind==='impact'){
      const cold=[11,12,1,2,3].includes(Number(day.slice(4,6)));
      data=normalizeImpact(await call(`1360000/ImpactInfoServiceV2/get${cold?'CW':'HW'}ImpactValueV2`,{tm:day,efSn:3,numOfRows:1000}));
    }else if(kind==='typhoon')data=normalizeTyphoon(await call('1360000/TyphoonInfoService/getTyphoonInfo',{fromTmFc:yesterday,toTmFc:day,numOfRows:200}));
    else if(kind==='airport')data=normalizeAirport(await call('1360000/AmmService/getMetar',{icao:'RKTN',numOfRows:10}),now);
    else if(kind==='takeoff'){
      const issue=new Date(+now-45*60000);issue.setUTCMinutes(0,0,0);
      const fctm=issue.toISOString().replace(/[-:T]/g,'').slice(0,12);
      data=normalizeTakeoff(await call('1360000/AirInfoService/getAirInfo',{fctm,icaoCode:'RKTN',numOfRows:10}),issue.toISOString());
    }
    else if(kind==='taf')data=normalizeTaf(await call('1360000/AmmService/getTaf',{icao:'RKTN',numOfRows:10}),now);
    else if(kind==='airportBrief'){
      const shifted=new Date(+now-60*60000),local=kstParts(shifted),hour=+local.slice(9,11);
      const base_date=hour<6?kstParts(new Date(+shifted-86400000)).slice(0,8):local.slice(0,8),base_time=hour>=17||hour<6?'1700':'0600';
      data=normalizeAirportBrief(await call('1360000/AirPortService/getAirPort',{base_date,base_time,airPortCd:'RKTN'}),instant(base_date,base_time));
    }
    else invalid();
  }catch(error){
    if(error.code!=='no_data')throw error;
    data={type:'empty',message:['airport','takeoff','taf','airportBrief'].includes(kind)?'현재 응답에 대구공항(RKTN) 자료가 없습니다. 공항 관측·예보와 주변 격자 날씨는 다릅니다.':kind==='pollen'?'해당 지역·발표 시각의 꽃가루 자료가 없습니다. 계절별 제공 기간이 다릅니다.':kind==='impact'?'조회일의 영향예보 자료가 없습니다. 발표 없음과 위험 없음은 다릅니다.':kind==='typhoon'?'최근 이틀 조회 범위의 태풍 발표 자료가 없습니다. 태풍 유무를 단정하지 않습니다.':'조회 범위의 자료가 없습니다. 잠시 후 다시 확인해 주세요.'};
  }
  return {ok:true,kind,sourceUrl:EXTRA_SOURCES[kind],fetchedAt:now.toISOString(),timezone:'Asia/Seoul',data};
}
