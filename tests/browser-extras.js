return await (async()=>{
  const results=[],check=(name,value)=>results.push({name,pass:Boolean(value)}),originalFetch=window.fetch,cacheKey='daegu-explore-cache-v1',oldCache=localStorage.getItem(cacheKey),record=localStorage.getItem('daegu-daily-real-v2');
  const now=new Date().toISOString(),p=(kind,data)=>({ok:true,kind,fetchedAt:now,timezone:'Asia/Seoul',data});
  const images={type:'images',frames:[{url:'https://www.kma.go.kr/synthetic-1.png',fileName:'synthetic-1.png',observedAt:null},{url:'https://www.kma.go.kr/synthetic-2.png',fileName:'synthetic-2.png',observedAt:null}]};
  const fixtures=Object.fromEntries(['radar','satellite','lightning','chart'].map(k=>[k,p(k,images)]));
  for(const k of ['uv','diffusion','pollen'])fixtures[k]=p(k,{type:'index',issuedAt:now,points:[{time:now,value:2}]});
  for(const k of ['impact','taf','airportBrief'])fixtures[k]=p(k,{type:'empty',message:'합성 시험: 해당 지역 자료 없음'});
  fixtures.typhoon=p('typhoon',{type:'typhoon',rows:[{name:'합성 태풍',issuedAt:now,observedAt:now,location:'합성 지역',note:'합성 시험 · 발표 종료',windSpeed:20,pressure:999}]});
  fixtures.airport=p('airport',{type:'airport',icao:'RKTN',observedAt:now,temperature:23,visibility:'10 km 이상',wind:'합성 바람 3 kt',pressure:1010,report:'합성 시험 <script>alert(1)</script>'});
  fixtures.takeoff=p('takeoff',{type:'takeoff',icao:'RKTN',issuedAt:now,rows:[{time:now,temperature:24,windDirection:180,windSpeed:4,qnhInHg:30.01}]});
  const day='2026-09-22';fixtures.observations=p('observations',{type:'observations',stationId:'143',date:day,observedAt:day+'T23:00:00+09:00',points:[{time:day+'T00:00:00+09:00',temperature:20,humidity:50,windSpeed:3,precipitation:null},{time:day+'T23:00:00+09:00',temperature:22,humidity:60,windSpeed:1,precipitation:0}]});
  const wait=async()=>{for(let i=0;i<650;i++){if(!document.getElementById('explore-refresh').disabled)return;await new Promise(r=>setTimeout(r,50));}throw Error('refresh timeout');};
  const card=k=>document.querySelector(`[data-kind="${k}"]`),calls=[];
  const respond=async url=>{const k=new URL(url,location.href).searchParams.get('kind');calls.push(k);return new Response(JSON.stringify(fixtures[k]));};
  const refresh=async()=>{document.getElementById('explore-refresh').click();await wait();};
  const go=async hash=>{location.hash=hash;await new Promise(r=>setTimeout(r,100));await wait();};
  await wait();
  try{
    window.fetch=respond;await go('images');await refresh();
    check('image-navigation-keeps-original-link',card('radar').querySelector('input[type=range]')?.max==='1'&&card('radar').querySelector('img').src.endsWith('synthetic-2.png'));
    card('radar').querySelector('button[aria-label="이전 영상"]').click();check('previous-frame-control',card('radar').querySelector('img').src.endsWith('synthetic-1.png'));
    const before=calls.length;await go('airport');check('airport-lazy-loads-only-selected-page',calls.slice(before).every(k=>['airport','takeoff','taf','airportBrief'].includes(k)));
    check('airport-observation-and-takeoff-units',card('airport').textContent.includes('23 °C')&&card('takeoff').textContent.includes('기압 (inHg)'));
    check('provider-text-is-not-html',card('airport').querySelectorAll('script').length===0&&card('airport').textContent.includes('<script>'));
    check('empty-data-is-not-no-risk',card('taf').textContent.includes('자료 없음'));
    await go('life');
    window.fetch=async url=>new URL(url,location.href).searchParams.get('kind')==='uv'?new Response(JSON.stringify({ok:false,error:{message:'합성 자외선 실패'}}),{status:503}):respond(url);
    await refresh();check('partial-failure-keeps-other-cards-fresh',card('uv').textContent.includes('이전 수신값')&&card('diffusion').querySelector('.card-state').textContent==='조회 완료');
    await go('airport');
    for(const code of ['timeout','auth','rate','offline','invalid']){window.fetch=async()=>new Response(JSON.stringify({ok:false,error:{message:'합성 시험 '+code}}),{status:503});await refresh();check('retained-value-'+code,card('airport').textContent.includes('23 °C')&&card('airport').textContent.includes('이전 수신값')&&card('airport').textContent.includes(code));}
    window.fetch=respond;await refresh();check('recovery-clears-failure',card('airport').querySelector('.card-state').textContent==='조회 완료'&&!card('airport').textContent.includes('합성 시험 invalid'));
    window.fetch=async url=>new URL(url,location.href).searchParams.get('kind')==='airport'?new Response(JSON.stringify(p('airport',{type:'empty',message:'합성 시험: 새로운 관측 없음'}))):respond(url);await refresh();check('empty-response-keeps-last-observation',card('airport').textContent.includes('23 °C')&&card('airport').textContent.includes('새로운 관측 없음')&&card('airport').textContent.includes('이전 수신값'));
    window.fetch=respond;
    await go('observations');await refresh();check('missing-rain-is-not-zero',card('observations').textContent.includes('자료 없음'));
    check('no-page-horizontal-overflow',document.documentElement.scrollWidth<=innerWidth+1);
    check('coursework-records-unchanged',localStorage.getItem('daegu-daily-real-v2')===record);
  }finally{window.fetch=originalFetch;if(oldCache===null)localStorage.removeItem(cacheKey);else localStorage.setItem(cacheKey,oldCache);}
  return JSON.stringify({checkedAt:now,synthetic:true,viewport:innerWidth,results,passed:results.filter(r=>r.pass).length,total:results.length});
})();
