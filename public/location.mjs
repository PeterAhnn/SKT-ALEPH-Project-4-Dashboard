import {REGIONS,DEFAULT_REGION,regionById} from './regions.mjs';
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
 for(const a of document.querySelectorAll('.service-nav a,.service-brand')){const u=new URL(a.href,location.href);if(u.origin===location.origin){u.searchParams.set('region',r.id);a.href=u.href;}}
 return r;
}
export function regionLabel(r){return `${r.district}${r.name==='전체'?'':` ${r.name}`}`;}
