// Pure alert model: never interpret a failed lookup as an all-clear.
export function alertId(kind,issuedAt,body){let h=2166136261;for(const c of body){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return `${kind}:${issuedAt}:${h>>>0}`;}
export function collectAlerts(kind,p,region){
 const d=p.data,base={kind,fetchedAt:p.fetchedAt,sourceUrl:p.sourceUrl};
 const item=(title,body,issuedAt,popup)=>({...base,title,body,issuedAt,popup,id:alertId(kind,issuedAt,body)});
 if(kind==='warnings'){
  const current=d.current?.trim()||'',pre=d.preliminary?.trim()||'';
  const none=v=>!v||/^(없음|해당없음|특보없음)[.]*$/.test(v.replace(/^[oO○•·-]\s*/, '').replace(/\s/g,''));
  if(none(current)&&none(pre))return [];
  const body=`특보 현황\n${current||'원천 내용 없음'}\n\n예비특보\n${pre||'원천 내용 없음'}`;
  return [item('기상청 특보 발표 · 전국 원문',body,d.issuedAt,/대구|군위/.test(body))];
 }
 if(d.type==='empty')return [];
 if(kind==='typhoon')return d.rows.map(r=>item(`태풍 ${r.name} · 최근 발표`,[r.location,r.note,`중심기압 ${r.pressure??'미제공'} hPa · 최대풍속 ${r.windSpeed??'미제공'} m/s`].filter(Boolean).join('\n'),r.issuedAt,!/종료|소멸|해제/.test(r.note||'')));
 if(kind==='impact')return d.rows.map(r=>item('대구 폭염·한파 영향예보',`${r.area} · 분야 코드 ${r.field} · 영향 단계 ${r.level??'미제공'}\n대상 시각 ${r.validAt||'원천 미제공'}`,r.validAt||p.fetchedAt,true));
 return [];
}
export function mergeArchive(previous,items){return [...new Map([...previous,...items].map(x=>[x.id,x])).values()].sort((a,b)=>Date.parse(b.issuedAt)-Date.parse(a.issuedAt)).slice(0,60);}
