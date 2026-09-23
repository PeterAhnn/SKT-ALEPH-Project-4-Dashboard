import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {loadEnvFile} from 'node:process';
try { loadEnvFile('.env.kma.local'); } catch(error) { if(error.code!=='ENOENT') throw error; }
const {default:weatherHandler}=await import('./api/weather.js');
const root=path.resolve('public');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(pathname==='/api/weather')return await weatherHandler(req,res);const file=path.resolve(root,`.${pathname==='/'?'/index.html':pathname}`);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}const content=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(content);}catch{res.writeHead(404).end('Not found');}}).listen(Number(process.env.PORT)||8004,'127.0.0.1',()=>console.log('Dashboard server ready'));
