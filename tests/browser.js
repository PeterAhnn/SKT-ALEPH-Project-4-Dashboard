return await (async()=>{
 const $=s=>document.querySelector(s),results=[];
 const check=(name,pass)=>{results.push({name,pass:!!pass});if(!pass)throw new Error(name);};
 const wait=async fn=>{const start=Date.now();while(!fn()){if(Date.now()-start>12000)throw new Error('UI timeout');await new Promise(r=>setTimeout(r,30));}};
 await wait(()=>!$('#refresh').disabled);
 const nativeFetch=window.fetch;
 const key='seoul-daily-real-v1',initial=localStorage.getItem(key);
 check('actual-source-success',$('#status-title').textContent.includes('정상적으로'));
 check('public-one-real-day',$('#record-count').textContent==='1일 기록');
 check('no-invented-yesterday',$('#delta').textContent.includes('—'));
 check('no-horizontal-overflow',document.documentElement.scrollWidth<=innerWidth);
 const temp=$('#temperature').textContent,table=$('#history-body').textContent;
 try{
  for(const button of document.querySelectorAll('#failure-buttons button')){button.click();await wait(()=>!$('#run-all').disabled);check('synthetic-'+button.dataset.failure,$('#lab-result').textContent.includes('통과')&&localStorage.getItem(key)===initial&&$('#temperature').textContent===temp&&$('#history-body').textContent===table);}
  for(const [code,response] of [
    ['network',async()=>{throw new TypeError('QA connection failure');}],
    ['http',async()=>new Response('{}',{status:503})],
    ['invalid',async()=>new Response('{bad JSON',{status:200})],
    ['stale',async()=>new Response(JSON.stringify({timezone:'Asia/Seoul',utc_offset_seconds:32400,current_units:{temperature_2m:'°C'},current:{time:new Date(Date.now()+6*3600000).toISOString().slice(0,16),temperature_2m:20}}))],
    ['timeout',async()=>new Promise(()=>{})]
  ]){window.fetch=response;$('#refresh').click();await wait(()=>!$('#refresh').disabled);check('real-ui-error-path-'+code,$('#status-title').textContent.includes(code)&&$('#temperature').textContent===temp&&localStorage.getItem(key)===initial);}
  window.fetch=nativeFetch;$('#refresh').click();await wait(()=>!$('#refresh').disabled);check('real-source-recovery',$('#status-title').textContent.includes('정상적으로'));
  const stored=JSON.parse(localStorage.getItem(key));check('first-day-preserved',JSON.stringify(stored.days)===JSON.stringify(JSON.parse(initial).days));
  $('#device-tab').click();check('browser-scope-label',$('#history-note').textContent.includes('별도로'));$('#public-tab').click();
  $('#theme').click();check('theme-toggle',document.documentElement.dataset.theme==='dark');$('#theme').click();
  $('#clear-lab').click();window.scrollTo(0,0);
  return JSON.stringify({at:new Date().toISOString(),url:location.href,automated:true,results,passed:results.filter(x=>x.pass).length});
 }finally{window.fetch=nativeFetch;}
})();
