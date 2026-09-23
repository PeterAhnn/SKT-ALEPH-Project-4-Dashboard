return await (async()=>{
  const $=id=>document.getElementById(id),results=[],native=window.fetch;
  const check=(name,condition)=>results.push({name,pass:Boolean(condition)});
  const wait=async()=>{for(let n=0;n<400;n++){if(!$('service-refresh').disabled)return;await new Promise(r=>setTimeout(r,50));}throw Error('refresh timeout');};
  const refresh=async()=>{$('service-refresh').click();await wait();};
  await wait();
  const now=new Date().toISOString(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date());
  const envelope=(kind,data)=>({ok:true,kind,fetchedAt:now,timezone:'Asia/Seoul',data});
  const fixtures={
    current:envelope('current',{observedAt:now,temperature:23.4,relativeHumidity:50,windSpeed:2.1,precipitation:0,precipitationText:'0',rainType:0,weatherCode:null}),
    forecast:envelope('forecast',{issuedAt:now,hourly:Array.from({length:24},(_,i)=>({time:new Date(Date.now()+(i+1)*3600000).toISOString(),temperature:20,precipitationProbability:30,weatherCode:3})),daily:[{date:today,temperatureMin:null,temperatureMax:26,precipitationProbabilityMax:30,weatherCode:3}]}),
    mid:envelope('mid',{issuedAt:now,days:[{date:today,temperatureMin:18,temperatureMax:27,condition:'흐림',precipitationProbabilityMax:30}]}),
    air:envelope('air',{observedAt:now,station:'합성 시험 측정소',pm10:15,pm25:null}),
    warnings:envelope('warnings',{issuedAt:now,current:'합성 시험: 대구 호우주의보',preliminary:'합성 시험: 없음'}),
  };
  const respond=async url=>new Response(JSON.stringify(fixtures[new URL(url,location.href).searchParams.get('kind')]));
  const oldCache=localStorage.getItem('daegu-portal-cache-v1');
  const record=localStorage.getItem('daegu-daily-real-v2');
  try {
    window.fetch=respond;await refresh();
    check('synthetic-normal-current',$('service-temperature').textContent==='23.4'&&$('service-badge').dataset.state==='fresh');
    check('synthetic-hourly-render',document.querySelectorAll('.hour-item').length===24);
    check('missing-air-is-not-zero',$('air-values').textContent.includes('측정값 없음'));
    check('warning-content-is-text',$('warnings-content').textContent.includes('합성 시험: 대구'));
    for(const code of ['timeout','auth','rate','network','invalid']) {
      window.fetch=async()=>new Response(JSON.stringify({ok:false,error:{code,message:'합성 시험 '+code}}),{status:503});
      await refresh();
      check('retains-current-'+code,$('service-temperature').textContent==='23.4'&&$('service-badge').dataset.state==='stale'&&$('service-status').textContent.includes(code));
      check('retains-auxiliary-'+code,$('air-values').textContent.includes('15')&&$('air-status').textContent.includes('이전 수신값'));
    }
    window.fetch=respond;await refresh();
    check('synthetic-recovery',$('service-badge').dataset.state==='fresh'&&!$('air-status').textContent.includes('이전 수신값'));
    const theme=document.documentElement.dataset.theme;$('service-theme').click();check('theme-toggle',theme!==document.documentElement.dataset.theme);$('service-theme').click();
    check('no-horizontal-overflow',document.documentElement.scrollWidth<=innerWidth+1);
    check('review-records-untouched',localStorage.getItem('daegu-daily-real-v2')===record);
  }finally {window.fetch=native;if(oldCache===null)localStorage.removeItem('daegu-portal-cache-v1');else localStorage.setItem('daegu-portal-cache-v1',oldCache);}
  return JSON.stringify({checkedAt:now,url:location.href,synthetic:true,results,passed:results.filter(r=>r.pass).length,total:results.length});
})();
