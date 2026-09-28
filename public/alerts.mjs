import {fetchPart} from './portal-client.mjs';
import {fetchExtra} from './explore-client.mjs';
import {collectAlerts,mergeArchive} from './alert-model.mjs';
const STORE='daegu-alerts-v1',SEEN='daegu-alert-seen-v1';
const e=(tag,content='',cls='')=>Object.assign(document.createElement(tag),{textContent:content,className:cls});
const dt=v=>new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})+' KST';
export function initAlerts(region){
 const root=document.getElementById('weather-alerts'),banner=document.getElementById('alert-banner');if(!root||!banner)return;
 let archive=[],seen=[],latest={},errors={},busy=false,lastCheck=0;
 try{const a=JSON.parse(localStorage.getItem(STORE)||'[]');archive=Array.isArray(a)?a.filter(x=>x&&typeof x.id==='string'&&typeof x.body==='string'&&x.body.length<18000&&Number.isFinite(Date.parse(x.issuedAt))&&Number.isFinite(Date.parse(x.fetchedAt))).slice(0,60):[];const b=JSON.parse(localStorage.getItem(SEEN)||'[]');seen=Array.isArray(b)?b.filter(x=>typeof x==='string').slice(-100):[];}catch{}
 const dialog=e('dialog','','alert-dialog');dialog.setAttribute('aria-labelledby','alert-dialog-title');document.body.append(dialog);
 function show(items){if(!items.length||dialog.open)return;dialog.replaceChildren();const title=e('h2','새 기상 소식');title.id='alert-dialog-title';const close=e('button','확인했어요','refresh-button');close.type='button';close.autofocus=true;close.addEventListener('click',()=>dialog.close());dialog.append(title,e('p','원문의 대상 지역과 발효 시각을 확인하세요.','forecast-note'));for(const item of items.slice(0,3))dialog.append(card(item,false));dialog.append(close);seen=[...new Set([...seen,...items.map(i=>i.id)])].slice(-100);try{localStorage.setItem(SEEN,JSON.stringify(seen));}catch{}dialog.showModal();}
 function card(item,old){const a=e('article','','alert-item');a.append(e('p',`${old?'보관된 발표 · ':''}${dt(item.issuedAt)}`,'alert-time'),e('h3',item.title),e('p',item.body,'alert-body'),e('p',`마지막 조회 ${dt(item.fetchedAt)}`,'card-meta'));return a;}
 function render(){
  const live=Object.values(latest).flat(),regional=live.filter(x=>x.popup),failed=Object.keys(errors);
  banner.replaceChildren();banner.hidden=!regional.length&&!failed.length;
  if(regional.length){const wrap=e('div');wrap.append(e('span','소식','news-badge'),e('strong',regional[0].title),e('p',regional[0].body.slice(0,170),'banner-copy'));const btn=e('button','내용 보기','small-button');btn.addEventListener('click',()=>show(regional));banner.append(wrap,btn);}
  else if(failed.length)banner.append(e('span','기상 소식 확인이 지연되고 있습니다. 특보 없음으로 판단하지 마세요.'));
  root.replaceChildren();const head=e('div','','section-heading'),h=e('h2','기상 소식 모아보기');h.id='alerts-title';const refresh=e('button',busy?'확인 중…':'소식 새로고침','small-button');refresh.disabled=busy;refresh.addEventListener('click',load);head.append(h,refresh);root.append(head,e('p','특보·영향예보·태풍 원문을 바로 확인하세요. 이 브라우저에서 확인한 발표를 보관합니다.','forecast-note'));
  if(failed.length)root.append(e('p',Object.values(errors).join(' · '),'card-notice'));
  if(!live.length)root.append(e('p',busy?'새 발표를 확인하고 있습니다.':failed.length?'조회하지 못한 소식이 있습니다. 아래 보관 자료는 현재 유효 상태를 뜻하지 않습니다.':'조회 범위의 새 발표가 없습니다. 기상청 최신 발표도 함께 확인하세요.','forecast-note'));
  for(const item of live)root.append(card(item,false));
  const old=archive.filter(x=>!live.some(y=>y.id===x.id));if(old.length){const details=e('details','','source-details');details.append(e('summary',`지난 발표 ${old.length}건`));for(const item of old)details.append(card(item,true));root.append(details);}
  const source=e('a','기상청 공식 특보 확인 ↗');source.href='https://www.weather.go.kr/w/weather/warning/status.do';source.target='_blank';source.rel='noopener noreferrer';root.append(source);
 }
 async function load(){if(busy)return;busy=true;render();const news=[];
  await Promise.allSettled(['warnings','impact','typhoon'].map(async kind=>{try{const p=kind==='warnings'?await fetchPart(kind,fetch,region.id):await fetchExtra(kind,fetch,region.id);const items=collectAlerts(kind,p,region);latest[kind]=items;delete errors[kind];archive=mergeArchive(archive,items);news.push(...items.filter(x=>x.popup&&!seen.includes(x.id)));}catch(err){errors[kind]=err.message;delete latest[kind];}}));
  try{localStorage.setItem(STORE,JSON.stringify(archive));}catch{}
  busy=false;lastCheck=Date.now();render();show(news);
 }
 render();load();setInterval(()=>{if(!document.hidden)load();},300000);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastCheck>300000)load();});
}
