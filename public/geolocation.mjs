import {REGIONS} from './regions.mjs';

// Match public forecast reference points, not administrative polygons.
export function nearestRegion(latitude,longitude,accuracy=0){
 if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)throw Error('위치 좌표를 확인하지 못했습니다. 다시 시도해 주세요.');
 if(!Number.isFinite(accuracy)||accuracy<0||accuracy>5000)throw Error('위치 오차가 커서 지역을 선택하지 않았습니다. 위치 서비스를 확인하거나 직접 선택해 주세요.');
 const rad=x=>x*Math.PI/180;
 let match=null,distance=Infinity;
 for(const r of REGIONS.filter(r=>r.name!=='전체')){
  const a=Math.sin(rad(r.lat-latitude)/2)**2+Math.cos(rad(latitude))*Math.cos(rad(r.lat))*Math.sin(rad(r.lon-longitude)/2)**2;
  const km=6371*2*Math.asin(Math.sqrt(Math.min(1,a)));
  if(km<distance){match=r;distance=km;}
 }
 if(distance>20)throw Error('가까운 대구 예보 지점을 찾지 못했습니다. 대구 지역을 직접 선택해 주세요.');
 return match;
}
export function locationError(error){
 return error?.code===1?'위치 권한이 꺼져 있습니다. 브라우저의 사이트 설정에서 허용하거나 지역을 직접 선택해 주세요.':error?.code===3?'위치 확인 시간이 초과됐습니다. 다시 시도하거나 지역을 직접 선택해 주세요.':'현재 위치를 확인하지 못했습니다. 기기의 위치 서비스를 확인하거나 지역을 직접 선택해 주세요.';
}
