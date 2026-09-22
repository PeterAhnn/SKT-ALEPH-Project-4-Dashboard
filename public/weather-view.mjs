import {SOURCE,validatePayload,validateState,kstDate,previousKstDate} from './core.mjs';
const $=id=>document.getElementById(id);
const fmt=n=>Number.isFinite(n)?n.toFixed(1):'—';
const clock=iso=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso));
const node=(tag,text,cls='')=>Object.assign(document.createElement(tag),{textContent:text,className:cls});
export function describeWeather(code,isDay=true){
 if(code===0)return [isDay?'☀':'☾',isDay?'맑음':'맑은 밤'];
 if([1,2].includes(code))return [isDay?'☀':'☁','구름 조금'];if(code===3)return ['☁','흐림'];
 if([45,48].includes(code))return ['≋','안개'];if([51,53,55,56,57].includes(code))return ['☂','이슬비'];
 if([61,63,65,66,67,80,81,82].includes(code))return ['☂','비'];
 if([71,73,75,77,85,86].includes(code))return ['❄','눈'];
 if([95,96,99].includes(code))return ['ϟ','뇌우'];return ['—','날씨 정보 없음'];
}
export function renderForecast(weather,failed=false){
 $('current-details').replaceChildren();$('hourly-list').replaceChildren();$('daily-list').replaceChildren();
 if(!weather){$('forecast-time').textContent='예보 수신 기록 없음';$('forecast-notice').textContent='예보를 아직 받지 못했습니다. 현재 날씨 다시 확인으로 재시도할 수 있습니다.';$('hourly-list').append(node('p','저장된 예보가 없습니다.','muted small'));return;}
 const c=weather.current,stale=failed||Date.now()-Date.parse(weather.fetchedAt)>7200000;
 const [icon,label]=describeWeather(c.weatherCode,c.isDay!==false&&c.isDay!==0);
 $('forecast-time').textContent=`${stale?'보관 예보 · ':''}조회 ${clock(weather.fetchedAt)} KST`;
 $('forecast-notice').textContent=`${stale?'새 예보를 받지 못해 마지막 정상 예보를 표시합니다. ':''}예보는 앞으로의 예상이며 바뀔 수 있습니다. ${weather.forecast.message??''}`;
 const summary=[['현재 하늘',`${icon} ${label}`],['체감 기온',`${fmt(c.apparentTemperature)} °C`],['습도',Number.isFinite(c.relativeHumidity)?`${c.relativeHumidity} %`:'—'],['바람',`${fmt(c.windSpeed)} km/h`],['현재 강수량',`${fmt(c.precipitation)} mm`]];
 for(const [name,value]of summary){const card=node('div','','detail-item');card.append(node('span',name),node('strong',value));$('current-details').append(card);}
 const currentHour=Math.ceil(Date.now()/3600000)*3600000;
 const hours=weather.hourly.filter(h=>Date.parse(h.time)>=currentHour).slice(0,24);
 if(!hours.length)$('hourly-list').append(node('p','현재 이후의 시간별 예보를 받을 수 없습니다. 다시 확인해 주세요.','muted small'));
 for(const h of hours){const day=weather.daily.find(d=>d.date===h.time.slice(0,10));const isDay=day?Date.parse(h.time)>=Date.parse(day.sunrise)&&Date.parse(h.time)<Date.parse(day.sunset):true;const [symbol,description]=describeWeather(h.weatherCode,isDay),card=node('div','','hour-card');const hour=new Date(h.time).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',hour12:false});card.append(node('span',`${h.time.slice(5,10).replace('-','.')} · ${hour}`,'hour-time'),node('span',symbol,'weather-symbol'),node('strong',`${fmt(h.temperature)}°`),node('span',description,'hour-condition'),node('small',`강수 ${h.precipitationProbability}%`));$('hourly-list').append(card);}
 const today=kstDate(new Date().toISOString());const days=weather.daily.filter(d=>d.date>=today).slice(0,7);
 if(!days.length)$('daily-list').append(node('p','7일 예보가 없습니다. 현재 기온은 별도로 유지합니다.','muted small'));
 for(const d of days){const [symbol,description]=describeWeather(d.weatherCode),card=node('article','','day-card');const weekday=new Date(`${d.date}T12:00:00+09:00`).toLocaleDateString('ko-KR',{weekday:'short',timeZone:'Asia/Seoul'});card.append(node('h3',d.date===today?'오늘':`${d.date.slice(5).replace('-','.')} (${weekday})`),node('span',symbol,'weather-symbol'),node('p',description),node('strong',`${fmt(d.temperatureMin)}° / ${fmt(d.temperatureMax)}°`),node('small',`최저 / 최고 · 강수 ${d.precipitationProbabilityMax}%`));$('daily-list').append(card);}
}
export async function loadReviewEvidence(){
 const box=$('evidence-rows');box.replaceChildren();
 try{
  const response=await fetch('./data/review-evidence.json',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error('기록 응답 실패');
  const evidence=await response.json();if(evidence.version!==1||evidence.sourceId!==SOURCE.id||!Array.isArray(evidence.records)||evidence.records.length>2)throw new Error('기록 구조 불일치');
  const records=evidence.records;const dates=new Set();
  if(records.length)validateState({version:2,lastGood:records.at(-1).reading,days:records.map(record=>record.reading)},{now:new Date().toISOString()});
  for(const record of records){
   const r=record.reading;if(!r||r.sourceId!==SOURCE.id||r.sourceUrl!==SOURCE.url||r.kind!=='real'||r.kstDate!==kstDate(r.fetchedAt)||dates.has(r.kstDate)||Date.parse(r.fetchedAt)>Date.now()+300000||!/^data\/evidence\/[0-9TZ.\-]+\.json$/.test(record.evidencePath))throw new Error('원천·날짜 정보 불일치');dates.add(r.kstDate);
   const rawResponse=await fetch(`./${record.evidencePath}`,{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!rawResponse.ok)throw new Error('원자료 조회 실패');const original=await rawResponse.json();const raw=JSON.parse(original.responseText);const normalized=validatePayload(raw,original.fetchedAt);
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(original.responseText)))).map(value=>value.toString(16).padStart(2,'0')).join('');
   const same=digest===original.responseSha256&&original.kind==='real-public-fetch'&&original.sourceUrl===r.sourceUrl&&normalized.value===r.value&&normalized.observedAt===r.observedAt&&normalized.unit===r.unit&&normalized.fetchedAt===r.fetchedAt&&JSON.stringify(original.reading)===JSON.stringify(r);
   if(!same)throw new Error('원자료·보관값·SHA-256 불일치');
   const card=node('article','','evidence-row');card.dataset.date=r.kstDate;card.dataset.matched=String(same);
   card.append(node('h3',`${r.kstDate} · 실제 조회 기록`));
   const grid=node('div','','evidence-values');for(const [name,value]of [['원자료',raw.current.temperature_2m],['저장값',r.value],['화면값',r.value]]){const cell=node('div');cell.append(node('span',name),node('strong',`${fmt(value)} ${r.unit}`));grid.append(cell);}card.append(grid,node('p',`${same?'일치 확인':'불일치 · 확인 필요'} · 원천 ${clock(r.observedAt)} · 조회 ${clock(r.fetchedAt)} · Asia/Seoul`,'small'));
   const source=node('a','Open-Meteo 원천 URL ↗');source.href=r.sourceUrl;source.target='_blank';source.rel='noopener noreferrer';card.append(source,document.createTextNode(' · '));const link=node('a','이 기록의 응답 원문 ↗');link.href=`./${record.evidencePath}`;link.target='_blank';link.rel='noopener noreferrer';card.append(link);box.append(card);
  }
  $('review-count').textContent=`${records.length} / 2일`;
  if(records.length===2){const [a,b]=[...records].sort((a,b)=>a.reading.fetchedAt.localeCompare(b.reading.fetchedAt)).map(x=>x.reading);const delta=Math.round((b.value-a.value)*10)/10;const consecutive=previousKstDate(b.kstDate)===a.kstDate;$('evidence-delta').textContent=`${consecutive?'어제 대비':'두 기록 사이'} 변화: ${fmt(b.value)} − ${fmt(a.value)} = ${delta>0?'+':''}${fmt(delta)} ${b.unit}${consecutive?'':' · 연속 날짜가 아니므로 어제 대비로 표시하지 않습니다.'}`;}else $('evidence-delta').textContent='둘째 실제 KST 날짜 기록이 없어 변화값을 계산하지 않습니다.';
  return records;
 }catch(error){box.replaceChildren(node('p',`실제 기록 대조를 완료하지 못했습니다. ${error.message}. 페이지를 다시 열어 확인하세요.`,'forecast-notice'));$('review-count').textContent='확인 필요';$('evidence-delta').textContent='기록 대조가 완료되지 않아 변화값을 계산하지 않습니다.';return [];}
}
