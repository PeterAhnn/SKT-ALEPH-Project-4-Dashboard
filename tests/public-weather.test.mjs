import test from 'node:test';
import assert from 'node:assert/strict';
import {publication,requestItems,normalizeCurrent,normalizeAir,normalizeMid,normalizeWarnings,getPublicWeather} from '../lib/public-weather.mjs';
import {validPart,isPartOld,combineWeather} from '../public/portal-client.mjs';
import handler from '../api/weather.js';
const now=new Date('2026-09-23T00:10:00Z');
const issued={base_date:'20260923',base_time:'0800'};
const rows=[{baseDate:'20260923',baseTime:'0800',nx:89,ny:90,category:'T1H',obsrValue:'21.2'}];
const json=items=>new Response(JSON.stringify({response:{header:{resultCode:'00'},body:{totalCount:items.length,items:{item:items}}}}));
test('KST publication selection crosses midnight and respects publication delay',()=>{
  assert.deepEqual(publication(new Date('2026-09-22T15:10:00Z'),'current'),{base_date:'20260922',base_time:'2300'});
  assert.deepEqual(publication(new Date('2026-09-22T15:10:00Z'),'forecast'),{base_date:'20260922',base_time:'2300'});
  assert.deepEqual(publication(new Date('2026-09-22T21:10:00Z'),'mid'),{tmFc:'202609221800'});
});
test('key is encoded once and not included in normalized output',async()=>{
  const key='synthetic+a/b=';
  const result=await getPublicWeather('current',{now,key,fetchImpl:async url=>{assert.equal(url.searchParams.get('serviceKey'),key);assert.equal(url.hostname,'apis.data.go.kr');return json(rows);}});
  assert.equal(result.data.temperature,21.2);assert.equal(JSON.stringify(result).includes(key),false);
  assert.equal(validPart(result,'current',+now),true);
});
test('five external failures remain distinct without returning upstream errors',async()=>{
  for(const [fetchImpl,code] of [
    [async()=>{throw new DOMException('synthetic-secret','TimeoutError');},'timeout'],
    [async()=>new Response('synthetic-secret',{status:403}),'auth'],
    [async()=>new Response('synthetic-secret',{status:429}),'rate'],
    [async()=>{throw new Error('synthetic-secret');},'network'],
    [async()=>new Response('{"token":"synthetic-secret"}'),'invalid'],
  ]) await assert.rejects(requestItems('test',{}, {key:'synthetic-secret',fetchImpl}),e=>e.code===code&&!e.message.includes('synthetic-secret'));
});
test('HTTP 200 gateway XML error still becomes auth failure',async()=>{
  await assert.rejects(requestItems('test',{}, {key:'synthetic',fetchImpl:async()=>new Response('<returnReasonCode>30</returnReasonCode>')}),e=>e.code==='auth');
});
test('wrong grid, missing temperature and impossible values reject observations',()=>{
  for(const changed of [{nx:60},{obsrValue:'-'},{obsrValue:'999'}])assert.throws(()=>normalizeCurrent([{...rows[0],...changed}],issued));
  assert.equal(normalizeCurrent(rows,issued).relativeHumidity,null);
});
test('air missing and flagged values never become zero',()=>{
  const data=normalizeAir([{sidoName:'대구',stationName:'수창동',dataTime:'2026-09-23 09:00',pm10Value:'-',pm25Value:'15',pm25Flag:'점검및교정'}]);
  assert.equal(data.pm10,null);assert.equal(data.pm25,null);
});
test('mid forecast uses days after publication and preserves regional scope',()=>{
  const data=normalizeMid([{regId:'11H10000',wf5Am:'흐림',wf5Pm:'맑음',rnSt5Am:40,rnSt5Pm:10}],[{regId:'11H10701',taMin5:15,taMax5:24}],{tmFc:'202609230600'});
  assert.equal(data.days[0].date,'2026-09-28');assert.equal(data.days[0].precipitationProbabilityMax,40);
});
test('empty or malformed warning response never means no warnings',()=>{
  assert.throws(()=>normalizeWarnings([]));assert.throws(()=>normalizeWarnings([{tmFc:'202609230600'}]));
  assert.equal(normalizeWarnings([{tmFc:'202609230600',t6:'없음',t7:'없음'}]).current,'없음');
});
test('old caches remain identifiable and Open-Meteo snapshots are rejected',()=>{
  const part={ok:true,kind:'current',fetchedAt:now.toISOString(),timezone:'Asia/Seoul',data:normalizeCurrent(rows,issued)};
  assert.equal(isPartOld(part,+now+3*3600000),true);
  assert.equal(validPart({payload:{current:20}},'current'),false);
  assert.equal(combineWeather({current:part}).current.temperature,21.2);
});
test('endpoint rejects arbitrary proxy destinations and unsupported methods',async()=>{
  for(const [method,url,status] of [['POST','/api/weather?kind=current',405],['GET','/api/weather?kind=current&url=https://other.example',400],['GET','/api/weather?kind=__proto__',400]]){
    const res={setHeader(){},end(body){this.body=body;}};await handler({method,url},res);assert.equal(res.statusCode,status);
  }
});
