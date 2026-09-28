import {REGIONS,DEFAULT_REGION,regionById} from './regions.mjs';
import {nearestRegion,locationError} from './geolocation.mjs';
const KEY='daegu-region-v1';
export function selectedRegion(){let saved;try{saved=localStorage.getItem(KEY);}catch{}return regionById(new URL(location.href).searchParams.get('region'))||regionById(saved)||regionById(DEFAULT_REGION);}
export function mountLocation(){
 const r=selectedRegion(),box=document.getElementById('region-picker');if(!box)return r;
 const label=(title,id)=>{const l=document.createElement('label');l.textContent=title;const s=document.createElement('select');s.id=id;l.append(s);box.append(l);return s;};
 const district=label('구·군','district-select'),town=label('읍·면·동','town-select');
 for(const name of new Set(REGIONS.map(r=>r.district)))district.add(new Option(name,name));district.value=r.district;
 function towns(){town.replaceChildren();for(const item of REGIONS.filter(x=>x.district===district.value))town.add(new Option(item.name==='전체'?'구·군 대표 지점':item.name,item.id));}
 towns();town.value=r.id;
 function change(){const id=town.value;try{localStorage.setItem(KEY,id);}catch{}const u=new URL(location.href);u.searchParams.set('region',id);location.assign(u);}
 district.addEventListener('change',()=>{towns();change();});town.addEventListener('change',change);
 const locate=document.createElement('button');locate.type='button';locate.id='locate-button';locate.className='small-button locate-button';locate.textContent='◎ 현재 위치';
 const note=document.createElement('p');note.id='location-status';note.className='location-note';note.setAttribute('role','status');note.setAttribute('aria-live','polite');
 note.textContent='현재 위치에서 가장 가까운 대구 읍면동 예보 지점을 선택합니다. 정확한 행정구역과 다를 수 있습니다. 좌표는 저장하거나 서버로 보내지 않습니다.';
 locate.setAttribute('aria-describedby',note.id);box.append(locate,note);
 let locating=false;
 function finish(message){locating=false;locate.disabled=false;district.disabled=false;town.disabled=false;locate.textContent='◎ 현재 위치';note.textContent=message;}
 locate.addEventListener('click',()=>{
  if(locating)return;
  if(!navigator.geolocation){finish('이 브라우저에서는 위치 확인을 사용할 수 없습니다. 지역을 직접 선택해 주세요.');return;}
  locating=true;locate.disabled=true;district.disabled=true;town.disabled=true;locate.textContent='위치 확인 중…';note.textContent='브라우저에서 위치 사용을 허용해 주세요.';
  try{navigator.geolocation.getCurrentPosition(position=>{
   try{const found=nearestRegion(position.coords.latitude,position.coords.longitude,position.coords.accuracy);district.value=found.district;towns();town.value=found.id;finish(`가까운 예보 지점: ${regionLabel(found)}. 정확한 행정구역과 다를 수 있습니다.`);if(found.id!==r.id)change();}
   catch(error){finish(error.message);}
  },error=>finish(locationError(error)),{enableHighAccuracy:true,timeout:12000,maximumAge:60000});}catch{finish(locationError());}
 });
 for(const a of document.querySelectorAll('.service-nav a,.service-brand')){const u=new URL(a.href,location.href);if(u.origin===location.origin){u.searchParams.set('region',r.id);a.href=u.href;}}
 return r;
}
export function regionLabel(r){return `${r.district}${r.name==='전체'?'':` ${r.name}`}`;}
