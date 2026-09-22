return JSON.stringify(await Promise.all(['index.html','app.mjs','core.mjs','weather-view.mjs','fixture-adapter.mjs','style.css','data/observations.json','data/review-evidence.json','data/weather.json'].map(async path=>{
  const response=await fetch('/'+path,{cache:'no-store'});
  const digest=await crypto.subtle.digest('SHA-256',await response.arrayBuffer());
  return {path,status:response.status,sha256:Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('')};
})));
