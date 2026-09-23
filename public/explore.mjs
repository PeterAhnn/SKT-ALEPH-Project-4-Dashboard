import {CONFIG,PAGES,CACHE_KEY,validExtra,extraOld,fetchExtra,safeImage,indexLevel} from './explore-client.mjs';
const $=id=>document.getElementById(id);
const el=(tag,content='',className='')=>Object.assign(document.createElement(tag),{textContent:content,className});
const parts={},errors={},pending=new Map(),checked=new Set();
let page='images';
const dateTime=value=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value))+' KST':'원천 시각 미제공';
const number=(v,unit='')=>Number.isFinite(v)?`${v}${unit}`:'자료 없음';
function link(label,url){const a=el('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
function button(label,action){const b=el('button',label,'small-button');b.type='button';b.addEventListener('click',action);return b;}
function save(){try{localStorage.setItem(CACHE_KEY,JSON.stringify(parts));}catch{$('explore-storage').textContent='이 브라우저에 값을 저장하지 못했습니다. 새로고침하면 이전 수신값이 사라질 수 있습니다.';}}
try{const stored=JSON.parse(localStorage.getItem(CACHE_KEY)||'{}');for(const kind of Object.keys(CONFIG))if(validExtra(stored[kind],kind))parts[kind]=stored[kind];}catch{}
function metric(label,value){const d=el('div');d.append(el('span',label),el('strong',value));return d;}
function renderImage(d,content,kind){
  let index=d.frames.length-1;
  const image=el('img','','weather-image'),caption=el('p','','image-caption'),error=el('p','영상을 불러오지 못했습니다. 원본 링크를 확인하거나 다시 시도해 주세요.','image-error');
  image.loading='lazy';image.referrerPolicy='no-referrer';error.hidden=true;
  const original=link('영상 원본 크게 보기 ↗',d.frames[index].url);
  const controls=el('div','','image-controls'),range=el('input'),label=el('label','영상 선택'),output=el('output');
  range.type='range';range.min=0;range.max=d.frames.length-1;range.value=index;range.id=`frame-${kind}`;label.htmlFor=range.id;
  const show=()=>{const f=d.frames[index];image.hidden=false;error.hidden=true;image.src=f.url;image.alt=`${CONFIG[kind].title} · ${f.observedAt?dateTime(f.observedAt):'시각은 영상 안에 표시'}`;original.href=f.url;caption.textContent=f.observedAt?`원천 시각 ${dateTime(f.observedAt)}`:'원천 시각·색상·단위는 영상 안의 표기를 확인하세요.';range.value=index;output.value=`${index+1}/${d.frames.length}`;};
  image.addEventListener('error',()=>{error.hidden=false;image.hidden=true;});
  range.addEventListener('input',()=>{index=+range.value;show();});
  controls.append(label,button('‹',()=>{index=Math.max(0,index-1);show();}),range,button('›',()=>{index=Math.min(d.frames.length-1,index+1);show();}),output);
  controls.querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-label',i?'다음 영상':'이전 영상'));
  content.append(image,error,caption,original);if(d.frames.length>1)content.append(controls);show();
}
function renderIndex(d,content,kind){
  const kstDay=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date(v));
  const next=(kind==='pollen'?d.points.find(p=>kstDay(p.time)===kstDay(Date.now())):null)||d.points.find(p=>Date.parse(p.time)>=Date.now())||d.points.at(-1);
  const targetTime=value=>kind==='pollen'?kstDay(value):dateTime(value);
  const headline=el('p',number(next.value),'index-headline');headline.append(el('small',indexLevel(kind,next.value)));
  content.append(headline,el('p',`예보 대상 ${targetTime(next.time)}`,'index-time'));
  const track=el('div','','index-track');track.tabIndex=0;track.setAttribute('aria-label','시간대별 예상 지수, 좌우로 이동');
  for(const point of d.points){const item=el('div','','index-slot');item.append(el('span',targetTime(point.time).replace(' KST','')),el('strong',String(point.value)),el('span',indexLevel(kind,point.value)));track.append(item);}
  content.append(track);
  content.append(el('p',kind==='diffusion'?'예상 지수이며 실제 미세먼지 농도와는 다른 값입니다. 대기질은 오늘 날씨 화면에서 확인하세요.':kind==='pollen'?'잡초류 지수입니다. 참나무·소나무 꽃가루는 이 값에 포함되지 않습니다.':'자외선은 시간대와 구름에 따라 달라집니다. 발표 시각과 예보 대상 시각을 구분해 확인하세요.','forecast-note'));
}
function renderAirport(d,content){
  const metrics=el('div','','airport-metrics');metrics.append(metric('기온',number(d.temperature,' °C')),metric('바람',d.wind||'자료 없음'),metric('시정',d.visibility||'자료 없음'),metric('해면기압 QNH',number(d.pressure,' hPa')));
  const details=el('details');details.append(el('summary','공항 관측 원문 보기'),el('pre',d.report,'raw-report'));
  content.append(metrics,details);
}
function renderTakeoff(d,content){
  const scroll=el('div','','data-scroll'),table=el('table','','observation-table'),head=el('thead'),row=el('tr');
  for(const h of ['예보 대상 (KST)','기온 (°C)','풍향 (°)','풍속 (kt)','기압 (inHg)']){const th=el('th',h);th.scope='col';row.append(th);}head.append(row);table.append(head);
  const body=el('tbody');for(const r of d.rows){const tr=el('tr');for(const v of [dateTime(r.time).replace(' KST',''),number(r.temperature),number(r.windDirection),number(r.windSpeed),number(r.qnhInHg)])tr.append(el('td',v));body.append(tr);}table.append(body);scroll.tabIndex=0;scroll.setAttribute('aria-label','대구공항 이륙 예보 표');scroll.append(table);content.append(scroll,el('p','이륙에 필요한 기상 예보입니다. 항공편 출발 예정 시각이나 운항 상태를 뜻하지 않습니다. 원천의 UTC 시각은 KST로 변환했습니다.','forecast-note'));
}
function spark(points){
  const ns='http://www.w3.org/2000/svg',node=(tag,attrs)=>{const n=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
  const svg=node('svg',{viewBox:'0 0 900 180',class:'spark-chart',role:'img','aria-label':'전날 시간별 기온 변화. 아래 표에서 모든 값을 확인할 수 있습니다.'});
  const min=Math.floor(Math.min(...points.map(p=>p.temperature))-1),max=Math.ceil(Math.max(...points.map(p=>p.temperature))+1),y=v=>145-(v-min)/(max-min)*120;
  for(const v of [min,(min+max)/2,max]){svg.append(node('line',{x1:45,y1:y(v),x2:870,y2:y(v),class:'gridline'}));const t=node('text',{x:0,y:y(v)+4});t.textContent=`${v.toFixed(0)}°`;svg.append(t);}
  const x=p=>45+Number(p.time.slice(11,13))/23*825;
  svg.append(node('polyline',{points:points.map(p=>`${x(p)},${y(p.temperature)}`).join(' ')}));
  for(const h of [0,6,12,18,23]){const t=node('text',{x:45+h/23*825,y:172,'text-anchor':'middle'});t.textContent=`${h}시`;svg.append(t);}
  return svg;
}
function renderObservations(d,content){
  const temperatures=d.points.map(p=>p.temperature),summary=el('div','','observation-summary');
  for(const[label,value]of [['관측 날짜',d.date],['수신한 시간',`${d.points.length}개`],['수신 시간 중 최저',`${Math.min(...temperatures)} °C`],['수신 시간 중 최고',`${Math.max(...temperatures)} °C`]]){const p=el('p',label);p.append(el('strong',value));summary.append(p);}
  content.append(summary,spark(d.points),el('p','전날 시간자료입니다. 시간별 값의 최저·최고이므로 일 최저·최고 관측과 다를 수 있습니다. 빈 강수량은 0으로 바꾸지 않습니다.','forecast-note'));
  const table=el('table','','observation-table'),head=el('thead'),row=el('tr');
  for(const h of ['시각 (KST)','기온 (°C)','습도 (%)','바람 (m/s)','강수량 (mm)']){const th=el('th',h);th.scope='col';row.append(th);}head.append(row);table.append(head);
  const body=el('tbody');for(const p of d.points){const tr=el('tr');for(const v of [p.time.slice(11,16),number(p.temperature),number(p.humidity),number(p.windSpeed),number(p.precipitation)])tr.append(el('td',v));body.append(tr);}table.append(body);
  const details=el('details'),scroll=el('div','','data-scroll');scroll.tabIndex=0;scroll.setAttribute('aria-label','시간별 관측 원자료 표');scroll.append(table);details.append(el('summary','시간별 관측값 모두 보기'),scroll);content.append(details);
}
function renderBulletin(d,content){
  if(d.type==='impact'){for(const r of d.rows)content.append(el('p',`${r.area} · 분야 코드 ${r.field} · 영향 단계 ${number(r.level)} · 대상 ${dateTime(r.validAt)}`,'plain-report'));return;}
  for(const r of d.rows){const box=el('div','','bulletin-row');box.append(el('h3',r.name),el('p',r.location,'plain-report'),el('p',`발표 ${dateTime(r.issuedAt)} · 기준 ${dateTime(r.observedAt)}`,'forecast-note'),el('p',`중심기압 ${number(r.pressure,' hPa')} · 최대풍속 ${number(r.windSpeed,' m/s')}`,'plain-report'),el('p',r.note.replaceAll('|','\n'),'plain-report'));if(r.image&&safeImage(r.image))box.append(link('진로 원본 보기 ↗',r.image));content.append(box);}
}
function renderCard(kind){
  const card=document.querySelector(`[data-kind="${kind}"]`);if(!card)return;
  const c=CONFIG[kind],p=parts[kind],d=p?.data,loading=pending.has(kind),old=Boolean(p&&(errors[kind]||extraOld(p)||!checked.has(kind))),state=card.querySelector('.card-state');
  state.textContent=loading?'확인 중':errors[kind]?p?'이전 수신값':'수신 실패':!p?'수신 대기':old?'이전 수신값':d.type==='empty'?'자료 없음':'조회 완료';state.dataset.stale=old;
  const notice=card.querySelector('.card-notice');notice.dataset.error=Boolean(errors[kind]);notice.textContent=errors[kind]?`${errors[kind]}${p?' 마지막 정상 응답을 보존했습니다.':' 저장된 자료가 아직 없습니다.'}`:old?'이전 수신 자료입니다. 새로고침하여 최신 발표를 확인하세요.':d?.type==='empty'?d.message:'';
  const content=card.querySelector('.card-content');content.replaceChildren();
  if(d&&d.type!=='empty'){
    if(d.type==='images')renderImage(d,content,kind);
    else if(d.type==='index')renderIndex(d,content,kind);
    else if(d.type==='airport')renderAirport(d,content);
    else if(d.type==='takeoff')renderTakeoff(d,content);
    else if(d.type==='taf')content.append(el('pre',d.report,'raw-report'),el('p','전문 안의 Z 시각과 유효 기간은 UTC 표기입니다.','forecast-note'));
    else if(d.type==='airportBrief'){for(const value of [d.title,d.summary,d.outlook,d.forecast,d.warning])if(value)content.append(el('p',value,'plain-report'));}
    else if(d.type==='observations')renderObservations(d,content);
    else renderBulletin(d,content);
  }
  const sourceTime=d?.observedAt||d?.issuedAt;
  card.querySelector('.card-meta').textContent=p?`${sourceTime?'원천 '+dateTime(sourceTime)+' · ':d?.type==='images'?'원천 시각: 영상 표기 기준 · ':''}조회 ${dateTime(p.fetchedAt)}`:'아직 정상 수신한 자료가 없습니다.';
  const retry=card.querySelector('.card-retry');retry.disabled=loading;retry.textContent=loading?'확인 중…':errors[kind]?'다시 시도':'새로고침';
}
function updateRefresh(){const busy=PAGES[page].kinds.some(k=>pending.has(k));$('explore-refresh').disabled=busy;$('explore-refresh').textContent=busy?'확인 중…':'새로고침';}
async function load(kind){
  if(pending.has(kind))return pending.get(kind);
  const task=(async()=>{try{const incoming=await fetchExtra(kind);if(incoming.data.type==='empty'&&parts[kind]&&parts[kind].data.type!=='empty'){errors[kind]=`${incoming.data.message} (조회 ${dateTime(incoming.fetchedAt)})`;}else{parts[kind]=incoming;delete errors[kind];}checked.add(kind);save();}catch(e){errors[kind]=e.message;checked.add(kind);}finally{pending.delete(kind);renderCard(kind);updateRefresh();}})();
  pending.set(kind,task);renderCard(kind);updateRefresh();return task;
}
function showPage(){
  page=Object.hasOwn(PAGES,location.hash.slice(1))?location.hash.slice(1):'images';const p=PAGES[page];
  document.title=`${p.title} · 오늘의 대구`;$('page-title').textContent=p.title;$('page-kicker').textContent=p.kicker;$('page-description').textContent=p.description;
  document.querySelectorAll('[data-page]').forEach(a=>{if(a.dataset.page===page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  const container=$('explore-content');container.replaceChildren();
  for(const kind of p.kinds){const c=CONFIG[kind],card=el('article','',`explore-card${['airport','takeoff','observations','typhoon'].includes(kind)?' wide':''}`);card.dataset.kind=kind;card.setAttribute('aria-labelledby',`title-${kind}`);const top=el('div','','card-top'),title=el('h2',c.title);title.id=`title-${kind}`;top.append(title,el('span','','card-state'));const notice=el('p','','card-notice');notice.setAttribute('role','status');const bottom=el('div','','card-bottom'),retry=button('새로고침',()=>load(kind));retry.classList.add('card-retry');retry.setAttribute('aria-label',`${c.title} 다시 조회`);bottom.append(link('기상청 출처 ↗',`https://www.data.go.kr/data/${c.source}/openapi.do`),retry);card.append(top,el('p',c.hint,'card-hint'),el('div','','card-content'),notice,el('p','','card-meta'),bottom);container.append(card);renderCard(kind);}
  if(page==='airport')container.append(el('p','공항 관측과 도심 날씨는 서로 다를 수 있습니다. 지연·결항 여부는 항공사와 공항의 운항 안내에서 확인하세요. 이 화면은 여행 전 참고용 기상정보입니다.','airport-note'));
  for(const kind of p.kinds)if(!checked.has(kind)||extraOld(parts[kind]))load(kind);
  updateRefresh();
}
let theme;try{theme=localStorage.getItem('daegu-theme');}catch{}
document.documentElement.dataset.theme=theme|| (matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');
$('service-theme').addEventListener('click',()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme;try{localStorage.setItem('daegu-theme',theme);}catch{}});
$('explore-refresh').addEventListener('click',()=>PAGES[page].kinds.forEach(load));
window.addEventListener('hashchange',showPage);window.addEventListener('offline',()=>{for(const kind of Object.keys(parts))errors[kind]='오프라인입니다. 인터넷 연결 후 다시 시도해 주세요.';for(const kind of PAGES[page].kinds)renderCard(kind);});
setInterval(()=>{for(const kind of PAGES[page].kinds)if(extraOld(parts[kind]))renderCard(kind);},60000);
showPage();
