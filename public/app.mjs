import {SOURCE,emptyState,validateState,fetchReading,applyReading,kstDate,previousKstDate,compareDays,FAILURE_CASES,replayFailure} from './core.mjs';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY='seoul-daily-real-v1';
let archive=emptyState(), device=emptyState(), scope='public', status='loading', busy=true, labBusy=false;
let statusTitle='공개 기록을 불러오는 중입니다', statusDetail='새 값을 받을 때까지 저장한 기록을 보존합니다.';
let storageWarning='', archiveWarning='';
const fmt=(value)=>Number(value).toFixed(1);
const dateTime=(iso)=>iso?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso)):'아직 없음';
const timeOnly=(iso)=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso));
const signed=(n)=>`${n>0?'+':''}${fmt(n)}`;
const setText=(id,text)=>{$(id).textContent=text;};
function latest(){return [archive.lastGood,device.lastGood].filter(Boolean).sort((a,b)=>Date.parse(b.fetchedAt)-Date.parse(a.fetchedAt))[0]??null;}
function notifyStorage(){const notices=[archiveWarning,storageWarning].filter(Boolean);$('storage-notice').hidden=!notices.length;setText('storage-notice',notices.join(' '));}
function validateLoadedState(data){const state=validateState(data);if(state.lastGood&&Date.parse(state.lastGood.fetchedAt)>Date.now()+300000)throw new Error('Future collection timestamp');return state;}
function readDevice(){try{const raw=localStorage.getItem(STORAGE_KEY);if(raw) device=validateLoadedState(JSON.parse(raw));}catch{storageWarning='이 브라우저의 기록을 읽을 수 없습니다. 기존 저장 원문은 덮어쓰지 않으며 공개 기록은 계속 볼 수 있습니다.';}}
async function persistDevice(reading){
 const save=()=>{if(storageWarning){device=applyReading(device,reading);return;}
   try{const raw=localStorage.getItem(STORAGE_KEY);const stored=raw?validateLoadedState(JSON.parse(raw)):device;const next=applyReading(stored,reading);localStorage.setItem(STORAGE_KEY,JSON.stringify(next));device=next;}
   catch{device=applyReading(device,reading);storageWarning='브라우저 저장 공간을 사용할 수 없거나 저장 자료가 손상되어 새 값은 화면에만 유지됩니다. 기존 원문은 덮어쓰지 않습니다. 기록 내려받기로 보관하세요.';}
 };
 if(navigator.locks)await navigator.locks.request(STORAGE_KEY,save);else save();
}
window.addEventListener('storage',event=>{if(event.key!==STORAGE_KEY||!event.newValue)return;try{device=validateLoadedState(JSON.parse(event.newValue));render();}catch{storageWarning='다른 탭의 저장 자료가 올바르지 않아 현재 정상값을 유지합니다.';notifyStorage();}});
function render(){
 const today=kstDate(new Date().toISOString()),last=latest(),days=(scope==='public'?archive:device).days;
 setText('today-label',`${today.replaceAll('-','.')} · KST`);
 setText('temperature',last?fmt(last.value):'—');setText('observed-at',dateTime(last?.observedAt));setText('fetched-at',dateTime(last?.fetchedAt));
 const age=last?Math.max(0,Math.floor((Date.now()-Date.parse(last.fetchedAt))/60000)):0;
 const stale=last&&Date.now()-Date.parse(last.observedAt)>2*60*60*1000;
 setText('value-caption',last?`${status==='success'&&!stale?'마지막 정상 수신값':'보관한 마지막 정상값'} · 수신 후 ${age<60?`${age}분`:`${Math.floor(age/60)}시간 ${age%60}분`}`:'아직 정상값이 없습니다. 임의의 값을 표시하지 않습니다.');
 setText('status-pill',status==='loading'?'조회 중':status==='error'?'새 값 수신 실패':stale?'오래된 보관값':status==='success'?'정상 수신':'보관 기록');
 $('status-bar').dataset.state=status==='error'||stale?'error':status;
 setText('status-title',stale&&status==='success'?'기준 시각이 오래된 보관값입니다':statusTitle);
 setText('status-detail',stale&&status==='success'?'현재 값 새로 확인을 눌러 갱신하세요. 기존 기록은 유지합니다.':statusDetail);
 $('refresh').disabled=busy||labBusy;$('refresh').firstChild.textContent=busy?'현재 값 확인 중… ':'현재 값 새로 확인 ';
 document.querySelectorAll('#failure-buttons button, #run-all').forEach(button=>button.disabled=busy||labBusy);
 const comparison=compareDays(archive.days,today);
 $('delta').replaceChildren(document.createTextNode(comparison.available?signed(comparison.delta):'—'),Object.assign(document.createElement('span'),{textContent:'°C'}));
 setText('comparison-reason',comparison.available?'공개 기록에서 계산한 두 시점의 기온 차이입니다.':archive.days.some(x=>x.kstDate===today)?'어제 기록 없음 · 다음 실제 날짜의 기록을 기다립니다.':'오늘의 공개 기록이 없어 비교할 수 없습니다.');
 setText('previous-day',`${previousKstDate(today).slice(5).replace('-','.')} 어제`);setText('current-day',`${today.slice(5).replace('-','.')} 오늘`);
 const prev=archive.days.find(x=>x.kstDate===previousKstDate(today)),curr=archive.days.find(x=>x.kstDate===today);
 setText('previous-value',prev?`${fmt(prev.value)}°`:'—');setText('current-value',curr?`${fmt(curr.value)}°`:'—');
 setText('record-count',`${days.length}일 기록`);setText('history-note',scope==='public'?'실제 수집 후 공개 보관한 기록입니다. 시크릿 창에서도 같습니다.':'이 브라우저에서 받은 값입니다. 공개 관찰 증거와 별도로 저장됩니다.');
 $('public-tab').classList.toggle('selected',scope==='public');$('device-tab').classList.toggle('selected',scope==='device');$('public-tab').setAttribute('aria-pressed',scope==='public');$('device-tab').setAttribute('aria-pressed',scope==='device');
 $('history-body').replaceChildren();for(const day of [...days].reverse()){
   const tr=document.createElement('tr'), c=compareDays(days,day.kstDate);
   [day.kstDate,`${fmt(day.value)} °C`,timeOnly(day.fetchedAt),c.available?`${signed(c.delta)} °C`:'전날 없음'].forEach(text=>{const td=document.createElement('td');td.textContent=text;tr.append(td);});$('history-body').append(tr);
 }
 $('empty-history').hidden=days.length>0;setText('evidence-progress',`실제 날짜 관찰 ${Math.min(archive.days.length,2)} / 2일${archive.days.length<2?' · 수집 중':''}`);renderChart(days);notifyStorage();
}
function renderChart(days){
 const container=$('chart');container.replaceChildren();const shown=days.slice(-7);
 if(!shown.length){const text=document.createElement('p');text.className='chart-placeholder';text.textContent='기록이 쌓이면 실제 값만 표시합니다.';container.append(text);return;}
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 500 125');svg.setAttribute('role','img');svg.setAttribute('aria-label',shown.map(x=>`${x.kstDate} ${fmt(x.value)}도`).join(', '));
 const min=Math.min(...shown.map(x=>x.value))-2,max=Math.max(...shown.map(x=>x.value))+2;
 const points=shown.map((d,i)=>({d,x:shown.length===1?250:32+i*436/(shown.length-1),y:80-(d.value-min)/(max-min)*57}));
 for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];if(previousKstDate(b.d.kstDate)!==a.d.kstDate)continue;const line=document.createElementNS(ns,'line');for(const [k,v]of Object.entries({x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:'#92b95b','stroke-width':2}))line.setAttribute(k,v);svg.append(line);}
 for(const {d,x,y}of points){const circle=document.createElementNS(ns,'circle');circle.setAttribute('cx',x);circle.setAttribute('cy',y);circle.setAttribute('r',5);circle.setAttribute('class','dot');svg.append(circle);for(const [text,ty]of [[`${fmt(d.value)}°`,y-13],[d.kstDate.slice(5).replace('-','.'),115]]){const label=document.createElementNS(ns,'text');label.setAttribute('x',x);label.setAttribute('y',ty);label.setAttribute('text-anchor','middle');label.textContent=text;svg.append(label);}}
 container.append(svg);
}
async function refresh(){if(busy||labBusy)return;busy=true;status='loading';statusTitle='공개 원천에서 새 값을 확인하고 있습니다';statusDetail='최대 8초 기다립니다. 저장한 정상값과 일별 기록은 유지합니다.';render();try{const reading=await fetchReading();await persistDevice(reading);status='success';statusTitle='새 값을 정상적으로 받았습니다';statusDetail='현재 값은 이 브라우저에 저장됩니다. 공개 관찰 기록은 별도 수집·배포 시 갱신됩니다.';}catch(error){status='error';statusTitle=`현재 값을 받지 못했습니다 · ${error.code??'network'}`;statusDetail=`${error.message} ${latest()?'마지막 정상값과 기록을 유지합니다.':'아직 저장한 정상값이 없습니다.'} 현재 값 새로 확인으로 다시 시도하세요.`;}finally{busy=false;render();}}
function setLab(title,message,label='합성 실패 재생',state='pass'){const box=$('lab-result');box.dataset.state=state;box.replaceChildren();for(const [tag,cls,text]of [['span','lab-result-label',label],['strong','',title],['p','',message]]){const e=document.createElement(tag);e.className=cls;e.textContent=text;box.append(e);}$('clear-lab').hidden=false;}
async function runLab(ids){if(labBusy||busy)return;labBusy=true;const before=JSON.stringify({archive,device});const controls=[...document.querySelectorAll('#failure-buttons button'),$('run-all')];controls.forEach(x=>x.disabled=true);$('refresh').disabled=true;const results=[];try{for(const id of ids){const item=FAILURE_CASES.find(x=>x.id===id);setLab(`${item.title} 확인 중…`,'실제 저장 공간을 변경하지 않는 합성 응답입니다.','합성 재생 중','running');const result=await replayFailure(id,validateState(device.lastGood?device:archive));results.push({...result,title:item.title});}const preserved=before===JSON.stringify({archive,device})&&results.every(x=>x.preserved);const passed=preserved&&results.every((r,i)=>r.code===ids[i]);setLab(passed?(ids.length===1?`${results[0].title} · 정상값과 기록 보존`:'5 / 5 실패 재생 · 정상값과 기록 보존'):'재생 검사에서 확인이 필요한 결과가 있습니다',ids.length===1?`${results[0].message} 실제 기록 ${archive.days.length}일은 변경하지 않았습니다. ${latest()?'보관한 값을 계속 표시합니다.':'첫 정상값이 없어 빈 상태를 유지합니다.'}`:results.map(r=>`${r.title}: ${r.code}`).join(' · '),`자체 합성 검사 · ${passed?'통과':'확인 필요'}`,passed?'pass':'error');}catch(error){setLab('합성 검사 실행 실패',error.message,'실제 기록 유지','error');}finally{labBusy=false;controls.forEach(x=>x.disabled=false);$('refresh').disabled=false;}}
for(const [index,item]of FAILURE_CASES.entries()){const button=document.createElement('button');button.textContent=`0${index+1} ${item.title}`;button.dataset.failure=item.id;button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>{document.querySelectorAll('#failure-buttons button').forEach(x=>x.setAttribute('aria-pressed',x===button));runLab([item.id]);});$('failure-buttons').append(button);}
$('refresh').addEventListener('click',refresh);$('run-all').addEventListener('click',()=>runLab(FAILURE_CASES.map(x=>x.id)));
$('clear-lab').addEventListener('click',()=>{if(labBusy)return;setLab('실패해도, 기록은 남아야 하니까.','실제 원천 조회와 기록은 합성 검사와 별도로 유지합니다.','재생 대기','idle');$('clear-lab').hidden=true;document.querySelectorAll('#failure-buttons button').forEach(x=>x.setAttribute('aria-pressed','false'));});
$('public-tab').addEventListener('click',()=>{scope='public';render();});$('device-tab').addEventListener('click',()=>{scope='device';render();});
$('export').addEventListener('click',()=>{const data=scope==='public'?archive:device;const blob=new Blob([JSON.stringify({scope:scope==='public'?'published-real-observations':'browser-local-not-published-evidence',exportedAt:new Date().toISOString(),source:SOURCE,...data},null,2)],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`seoul-${scope}-${kstDate(new Date().toISOString())}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
const scheme=matchMedia('(prefers-color-scheme: dark)');let theme;try{theme=localStorage.getItem('seoul-theme');}catch{}function setTheme(value){document.documentElement.dataset.theme=value;$('theme').setAttribute('aria-label',value==='dark'?'밝은 화면으로 변경':'어두운 화면으로 변경');}setTheme(theme==='light'||theme==='dark'?theme:scheme.matches?'dark':'light');$('theme').addEventListener('click',()=>{theme=document.documentElement.dataset.theme==='dark'?'light':'dark';setTheme(theme);try{localStorage.setItem('seoul-theme',theme);}catch{}});scheme.addEventListener('change',()=>{if(!theme)setTheme(scheme.matches?'dark':'light');});
$('source-link').href=SOURCE.url;readDevice();render();
try{const response=await fetch('./data/observations.json',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error('archive');archive=validateLoadedState(await response.json());}catch{archiveWarning='공개 관찰 기록을 불러오지 못했습니다. 일별 기록을 확인하려면 페이지를 다시 여세요. 브라우저의 기존 기록은 유지합니다.';}
busy=false;render();await refresh();setInterval(render,60000);
