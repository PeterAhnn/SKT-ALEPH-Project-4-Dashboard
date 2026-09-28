import {normalizeNowcast} from '../lib/weather-extras.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {REGIONS,DEFAULT_REGION} from '../public/regions.mjs';
import {getPublicWeather,normalizeCurrent,normalizeForecast} from '../lib/public-weather.mjs';
import {requestItems} from '../lib/portal-source.mjs';
import {normalizeSurface} from '../lib/hub-weather.mjs';
import {collectAlerts,mergeArchive} from '../public/alert-model.mjs';
import {validExtra} from '../public/explore-client.mjs';
import handler from '../api/weather.js';
const now=new Date('2026-09-28T00:30:00Z');
const json=items=>new Response(JSON.stringify({response:{header:{resultCode:'00'},body:{totalCount:items.length,items:{item:items}}}}));
test('official grid includes nine Daegu districts and 150 towns including Gunwi',()=>{
 assert.equal(new Set(REGIONS.map(r=>r.district)).size,9);assert.equal(REGIONS.filter(r=>r.name!=='전체').length,150);assert.equal(new Set(REGIONS.map(r=>r.id)).size,REGIONS.length);assert.ok(REGIONS.some(r=>r.district==='군위군'&&r.name==='삼국유사면'));assert.ok(REGIONS.find(r=>r.id===DEFAULT_REGION));
});
test('selected region changes upstream grid and rejects cross-region observations',async()=>{
 const region=REGIONS.find(r=>r.district==='군위군'&&r.name==='전체');let query;
 const result=await getPublicWeather('current',{now,key:'synthetic-portal',regionId:region.id,fetchImpl:async u=>{query=u.searchParams;return json([{baseDate:query.get('base_date'),baseTime:query.get('base_time'),nx:region.nx,ny:region.ny,category:'T1H',obsrValue:'20'}]);}});
 assert.equal(+query.get('nx'),region.nx);assert.equal(result.regionId,region.id);assert.equal(result.data.temperature,20);
 assert.throws(()=>normalizeCurrent([{baseDate:'20260928',baseTime:'0800',nx:89,ny:90,category:'T1H',obsrValue:22}],{base_date:'20260928',base_time:'0800'},region));
});
test('portal failure falls back to fixed hub route with a different key',async()=>{
 const calls=[];const items=await requestItems('1360000/VilageFcstInfoService_2.0/getUltraSrtNcst',{nx:89},{key:'synthetic-portal',hubKey:'synthetic-hub',fetchImpl:async u=>{calls.push(u);return calls.length===1?new Response('',{status:403}):json([{value:1}]);}});
 assert.equal(items[0].value,1);assert.equal(calls.length,2);assert.equal(calls[1].hostname,'apihub.kma.go.kr');assert.equal(calls[1].searchParams.get('authKey'),'synthetic-hub');assert.equal(calls[1].searchParams.has('serviceKey'),false);
});
test('AirKorea never receives the hub credential',async()=>{
 let calls=0;await assert.rejects(requestItems('B552584/test',{}, {hubKey:'synthetic-hub',fetchImpl:async()=>{calls++;}}),e=>e.code==='configuration');assert.equal(calls,0);
});
test('hub surface validates station, header, missing values and visibility units',()=>{
 const d=normalizeSurface('# YYMMDDHHMI STN TA TD HM WS VS RN_DAY\n202609280900 143 21.3 -9.9 70 2.1 2000 -9');
 assert.equal(d.observedAt,'2026-09-28T09:00:00+09:00');assert.equal(d.metrics.find(m=>m.label==='시정').value,20);assert.ok(!d.metrics.find(m=>m.label==='오늘 누적 강수'));assert.throws(()=>normalizeSurface('# changed\n123'));
});
test('invalid region and arbitrary proxy query rejected before any fetch',async()=>{
 for(const q of ['kind=current&region=unknown','kind=current&region=2711000000&region=2772000000','kind=current&url=https://example.com']){const res={setHeader(){},end(body){this.body=body;}};await handler({method:'GET',url:'/api/weather?'+q},res);assert.equal(res.statusCode,400);}
});
test('alert IDs survive refresh, changed bulletin creates new ID, no-data is not alert',()=>{
 const p={fetchedAt:now.toISOString(),data:{issuedAt:now.toISOString(),current:'대구 호우주의보',preliminary:'없음'}};
 const a=collectAlerts('warnings',p,{}),b=collectAlerts('warnings',{...p,fetchedAt:new Date(+now+60000).toISOString()},{});
 assert.equal(a[0].id,b[0].id);assert.equal(a[0].popup,true);assert.notEqual(a[0].id,collectAlerts('warnings',{...p,data:{...p.data,current:'대구 호우경보'}},{})[0].id);
 assert.deepEqual(collectAlerts('warnings',{...p,data:{...p.data,current:'없음'}},{}),[]);assert.equal(mergeArchive(a,b).length,1);assert.equal(mergeArchive(a,b)[0].fetchedAt,b[0].fetchedAt);
});
test('ended typhoons remain readable without automatic popup',()=>{
 const rows=[{name:'합성',issuedAt:now.toISOString(),note:'태풍 소멸 · 발표 종료'}];assert.equal(collectAlerts('typhoon',{data:{rows},fetchedAt:now.toISOString()},{} )[0].popup,false);
});
test('new extras reject empty metrics and malformed nowcast',()=>{
 const base={ok:true,timezone:'Asia/Seoul',fetchedAt:now.toISOString()};assert.equal(validExtra({...base,kind:'surface',data:{type:'metrics',observedAt:now.toISOString(),metrics:[]}},'surface',+now),false);
 assert.equal(validExtra({...base,kind:'nowcast',data:{type:'nowcast',issuedAt:now.toISOString(),rows:[{time:now.toISOString(),temperature:'bad',sky:'맑음'}]}},'nowcast',+now),false);
});

test('ultrashort forecast preserves returned issue time and excludes wrong grid/old runs',()=>{
 const row={baseDate:'20260928',baseTime:'0900',fcstDate:'20260928',fcstTime:'1000',nx:89,ny:90,category:'T1H',fcstValue:'23'};
 const d=normalizeNowcast([row,{...row,nx:90,fcstValue:99}],{nx:89,ny:90},new Date('2026-09-28T00:50:00Z'));
 assert.equal(d.issuedAt,'2026-09-28T09:00:00+09:00');assert.equal(d.rows[0].temperature,23);
 assert.throws(()=>normalizeNowcast([{...row,baseTime:'0600'}],{nx:89,ny:90},new Date('2026-09-28T00:50:00Z')));
});
test('provider spaced no-warning marker is not an announcement',()=>{
 assert.deepEqual(collectAlerts('warnings',{fetchedAt:now.toISOString(),data:{issuedAt:now.toISOString(),current:'o 없 음',preliminary:'o 없음'}},{}),[]);
});
