import test from 'node:test';
import assert from 'node:assert/strict';
import {nearestRegion,locationError} from '../public/geolocation.mjs';
import {REGIONS} from '../public/regions.mjs';
test('nearest forecast location supports all town reference points without district representatives',()=>{
 for(const r of REGIONS.filter(r=>r.name!=='전체')){const result=nearestRegion(r.lat,r.lon,30);assert.equal(result.name==='전체',false);assert.equal(result.lat,r.lat);assert.equal(result.lon,r.lon);}
});
test('invalid, distant and inaccurate positions cannot select a region',()=>{
 for(const coords of [[NaN,128,1],[35,181,1],[37.5665,126.978,20],[35.86,128.6,5001]])assert.throws(()=>nearestRegion(...coords));
});
test('permission and timeout errors explain different next actions',()=>{assert.match(locationError({code:1}),/권한/);assert.match(locationError({code:3}),/시간/);assert.match(locationError({code:2}),/위치 서비스/);});
