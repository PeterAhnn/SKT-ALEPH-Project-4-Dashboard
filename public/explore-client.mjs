export const CONFIG = {
  radar:{title:'강수 레이더',hint:'한반도 합성 영상 · 비구름의 위치와 이동',source:'15056924',type:'images',age:1},
  satellite:{title:'천리안 2A호 위성',hint:'한반도 적외 영상 · 밤에도 볼 수 있는 구름 분포',source:'15058167',type:'images',age:1},
  lightning:{title:'낙뢰 분포',hint:'한반도 · 집계 기간과 색상은 원본 범례 기준',source:'15057256',type:'images',age:1},
  chart:{title:'24시간 예상 일기도',hint:'동아시아 기압과 전선 예측 · 예상 시각은 원본 기준',source:'15043562',type:'images',age:24},
  uv:{title:'자외선지수',hint:'대구 · 시간대별 예상 지수',source:'15085288',type:'index',age:12},
  diffusion:{title:'대기정체지수',hint:'대구 · 대기 확산 여건의 예상 지수',source:'15085288',type:'index',age:12},
  pollen:{title:'잡초류 꽃가루',hint:'대구 · 계절별 꽃가루농도위험지수',source:'15085289',type:'index',age:24},
  impact:{title:'폭염·한파 영향예보',hint:'대구 · 계절에 해당하는 영향예보 발표',source:'15095149',type:'impact',age:12},
  typhoon:{title:'최근 태풍 발표',hint:'최근 이틀의 발표 · 종료된 태풍도 포함',source:'15043565',type:'typhoon',age:6},
  observations:{title:'어제의 시간별 관측',hint:'대구 종관관측소 143 · 전날 공개 자료',source:'15057210',type:'observations',age:24},
  airport:{title:'대구공항 현재 관측',hint:'RKTN · 공항 관측 전문 METAR/SPECI',source:'15058804',type:'airport',age:2},
  takeoff:{title:'앞으로의 이륙 날씨',hint:'대구공항 · 발표 시각부터 3시간까지의 예보',source:'15095109',type:'takeoff',age:2},
  taf:{title:'공항 예보 전문',hint:'대구공항 · TAF 제공 여부 확인',source:'15058804',type:'taf',age:12},
  airportBrief:{title:'공항 날씨 해설',hint:'대구공항 · 국내 공항기상정보 제공 여부 확인',source:'15110052',type:'airportBrief',age:18},
};
export const PAGES = {
  images:{title:'하늘의 흐름',kicker:'WEATHER IMAGERY',description:'비구름과 위성 영상을 원본 범례와 함께 봅니다.',kinds:['radar','satellite','lightning','chart']},
  life:{title:'생활 속 날씨',kicker:'DAILY WEATHER',description:'외출 전 살펴보는 대구의 생활지수와 기상 발표.',kinds:['uv','diffusion','pollen','impact','typhoon']},
  observations:{title:'지나간 날씨',kicker:'OBSERVATIONS',description:'예보와 구분해서 보는 대구의 실제 관측 기록.',kinds:['observations']},
  airport:{title:'대구공항의 날씨',kicker:'TAE · RKTN',description:'공항의 현재 관측과 앞으로의 이륙 예보를 함께 봅니다.',kinds:['airport','takeoff','taf','airportBrief']},
};
export const CACHE_KEY='daegu-explore-cache-v1';
export function indexLevel(kind,value){
  if(kind==='uv')return value>=11?'위험':value>=8?'매우 높음':value>=6?'높음':value>=3?'보통':'낮음';
  if(kind==='diffusion')return ({25:'낮음',50:'보통',75:'높음',100:'매우 높음'})[value]||'단계 미제공';
  if(kind==='pollen')return ['낮음','보통','높음','매우 높음'][value]||'단계 미제공';
  return '예상 지수';
}
const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const num=v=>typeof v==='number'&&Number.isFinite(v);
export function safeImage(value){
  try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&['kma.go.kr','weather.go.kr'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h))&&/\.(png|gif|jpe?g)$/i.test(u.pathname);}catch{return false;}
}
export function validExtra(p,kind,now=Date.now()){
  const c=CONFIG[kind],d=p?.data;
  if(!c||p?.ok!==true||p.kind!==kind||p.timezone!=='Asia/Seoul'||!date(p.fetchedAt)||Date.parse(p.fetchedAt)>now+300000||!d)return false;
  if(d.type==='empty')return typeof d.message==='string'&&d.message.length<1500;
  if(d.type!==c.type)return false;
  if(d.type==='images')return Array.isArray(d.frames)&&d.frames.length>0&&d.frames.length<=12&&d.frames.every(f=>safeImage(f.url)&&typeof f.fileName==='string'&&(f.observedAt===null||date(f.observedAt)));
  if(d.type==='index')return date(d.issuedAt)&&Array.isArray(d.points)&&d.points.length>0&&d.points.every(p=>date(p.time)&&num(p.value)&&p.value>=0&&p.value<=100);
  if(d.type==='observations')return d.stationId==='143'&&date(d.observedAt)&&Array.isArray(d.points)&&d.points.length>0&&d.points.every(p=>date(p.time)&&num(p.temperature)&&p.temperature>=-80&&p.temperature<=60);
  if(d.type==='airport')return d.icao==='RKTN'&&date(d.observedAt)&&typeof d.report==='string'&&(d.temperature===null||num(d.temperature));
  if(d.type==='takeoff')return d.icao==='RKTN'&&date(d.issuedAt)&&Array.isArray(d.rows)&&d.rows.length>0&&d.rows.every(r=>date(r.time)&&(r.temperature===null||num(r.temperature)));
  if(d.type==='taf')return d.icao==='RKTN'&&date(d.issuedAt)&&typeof d.report==='string';
  if(d.type==='airportBrief')return d.icao==='RKTN'&&date(d.issuedAt)&&typeof d.summary==='string'&&typeof d.outlook==='string';
  if(d.type==='typhoon')return Array.isArray(d.rows)&&d.rows.length>0&&d.rows.every(r=>typeof r.name==='string'&&date(r.issuedAt));
  return d.type==='impact'&&Array.isArray(d.rows)&&d.rows.every(r=>typeof r.area==='string'&&typeof r.field==='string'&&(r.level===null||num(r.level)));
}
export function extraOld(p,now=Date.now()){
  if(!p)return false;
  const age=CONFIG[p.kind].age*3600000,d=p.data;
  if(now-Date.parse(p.fetchedAt)>age)return true;
  if(['airport','takeoff','taf','airportBrief','index'].includes(d.type))return now-Date.parse(d.observedAt||d.issuedAt)>age;
  if(d.type==='images'&&d.frames.at(-1).observedAt)return now-Date.parse(d.frames.at(-1).observedAt)>age;
  return false;
}
export async function fetchExtra(kind,fetchImpl=fetch){
  if(typeof navigator!=='undefined'&&navigator.onLine===false)throw Error('오프라인입니다. 인터넷 연결 후 다시 시도해 주세요.');
  let res,p;
  try{res=await fetchImpl(`/api/weather?kind=${encodeURIComponent(kind)}`,{signal:AbortSignal.timeout(30000)});p=await res.json();}
  catch(e){throw Error(['TimeoutError','AbortError'].includes(e.name)?'응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.':'자료를 받지 못했습니다. 연결을 확인하고 다시 시도해 주세요.');}
  if(!res.ok||!validExtra(p,kind))throw Error(p?.error?.message||'자료의 형식이 달라 새 값으로 저장하지 않았습니다.');
  return p;
}
