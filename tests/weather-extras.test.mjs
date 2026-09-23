import test from 'node:test';
import assert from 'node:assert/strict';
import {safeImageUrl,normalizeImages,normalizeIndex,normalizeAirport,normalizeObservations,normalizeTakeoff,normalizeTaf} from '../lib/weather-extras.mjs';
import {getPublicWeather} from '../lib/public-weather.mjs';
import {validExtra,extraOld,fetchExtra,safeImage,indexLevel} from '../public/explore-client.mjs';
const now=new Date('2026-09-23T08:30:00Z');
const envelope=(kind,data)=>({ok:true,kind,fetchedAt:now.toISOString(),timezone:'Asia/Seoul',data});
const image='https://www.weather.go.kr/w/sat_202609230820.png';
test('weather image URLs cannot carry credentials, tracking queries or foreign hosts',()=>{
  for(const bad of ['https://kma.go.kr.evil.test/image.png','http://localhost/a.png','https://secret@www.kma.go.kr/a.png','https://www.kma.go.kr/a.png?serviceKey=synthetic','javascript:alert(1)','https://www.kma.go.kr/a.svg','https://www.kma.go.kr:444/a.png']){assert.equal(safeImageUrl(bad),null);assert.equal(safeImage(bad),false);}
  assert.equal(safeImageUrl('http://www.kma.go.kr/a.png'),'https://www.kma.go.kr/a.png');
});
test('satellite file UTC becomes 17:20 KST without guessing other image clocks',()=>{
  const sat=normalizeImages([{'satImgC-file':`["${image}"]`}],'satellite');
  assert.equal(sat.frames[0].observedAt,'2026-09-23T08:20:00Z');
  assert.equal(normalizeImages([image],'radar').frames[0].observedAt,null);
  assert.equal(validExtra(envelope('satellite',sat),'satellite',+now),true);
  assert.throws(()=>normalizeImages([{url:'https://evil.test/a.png'}],'radar'));
});
test('indices preserve missing values and forecast offset rather than use receipt time',()=>{
  const d=normalizeIndex([{areaNo:'2700000000',date:'2026092312',h0:'6',h3:'',h6:'0',h9:'-1'}],'uv');
  assert.deepEqual(d.points,[{time:'2026-09-23T03:00:00.000Z',value:6},{time:'2026-09-23T09:00:00.000Z',value:0}]);
  assert.throws(()=>normalizeIndex([{areaNo:'1100000000',date:'2026092312',h0:6}],'uv'));
});
test('METAR month boundary uses UTC and never substitutes another airport',()=>{
  const d=normalizeAirport([{icaoCode:'RKTN',metarMsg:'METAR RKTN 302300Z VRB03KT 9999 FEW040 M02/M03 Q1016='}],new Date('2026-10-01T00:00:00Z'));
  assert.equal(d.observedAt,'2026-09-30T23:00:00.000Z');assert.equal(d.temperature,-2);assert.equal(d.visibility,'10 km 이상');
  assert.throws(()=>normalizeAirport([{icaoCode:'RKSI',metarMsg:'METAR RKSI 230800Z 9999'}],now),e=>e.code==='no_data');
});
test('pollen day offsets and provider index scales remain distinct',()=>{
  const d=normalizeIndex([{areaNo:'2700000000',date:'2026092318',today:'',tomorrow:'0',dayaftertomorrow:'1',todaysaftertomorrow:'3'}],'pollen');
  assert.equal(d.points.length,3);assert.equal(d.points[0].time,'2026-09-23T15:00:00.000Z');
  assert.equal(indexLevel('pollen',0),'낮음');assert.equal(indexLevel('pollen',1),'보통');assert.equal(indexLevel('diffusion',75),'높음');assert.equal(indexLevel('uv',6),'높음');
});
test('takeoff pressure uses hundredths of inHg and forecast times are UTC',()=>{
  const d=normalizeTakeoff([{icaoCode:'RKTN',tmFc:'202609230900',ta:'28',ws:'5',wd:'320',qnh:'2993'}],now.toISOString());
  assert.equal(d.rows[0].qnhInHg,29.93);assert.equal(d.rows[0].time,'2026-09-23T09:00:00Z');
  const taf=normalizeTaf([{icaoCode:'RKTN',tafMsg:'TAF RKTN 230500Z 2306/2412 32005KT CAVOK='}],now);
  assert.equal(taf.issuedAt,'2026-09-23T05:00:00.000Z');
});
test('historical observations are restricted to Daegu and requested KST date',()=>{
  const d=normalizeObservations([{stnId:'143',tm:'2026-09-22 23:00',ta:'21',hm:'60',ws:'2',rn:''},{stnId:'108',tm:'2026-09-22 23:00',ta:35},{stnId:'143',tm:'2026-09-23 00:00',ta:25}],'2026-09-22');
  assert.equal(d.points.length,1);assert.equal(d.points[0].precipitation,null);
  assert.equal(extraOld(envelope('observations',d),+now),false);
});
test('empty upstream data is explicit and never translated to no risk',async()=>{
  const p=await getPublicWeather('impact',{now,key:'synthetic',fetchImpl:async()=>new Response(JSON.stringify({response:{header:{resultCode:'03'},body:{totalCount:0}}}))});
  assert.equal(p.data.type,'empty');assert.match(p.data.message,/위험 없음은 다릅니다/);
});
test('malformed browser caches and error responses reject without becoming fresh',async()=>{
  const p=envelope('airport',normalizeAirport([{icaoCode:'RKTN',metarMsg:'METAR RKTN 230800Z 32004KT 9999 FEW040 27/13 Q1016='}],now));
  assert.equal(validExtra(p,'airport',+now),true);
  assert.equal(extraOld(p,+now+3*3600000),true);
  assert.equal(validExtra({...p,kind:'radar'},'airport',+now),false);
  const bad=envelope('radar',{type:'images',frames:[{url:'https://evil.test/a.png',fileName:'a.png',observedAt:null}]});
  assert.equal(validExtra(bad,'radar',+now),false);
  await assert.rejects(fetchExtra('airport',async()=>new Response(JSON.stringify({ok:false,error:{message:'합성 호출 제한'}}),{status:503})),/합성 호출 제한/);
});
