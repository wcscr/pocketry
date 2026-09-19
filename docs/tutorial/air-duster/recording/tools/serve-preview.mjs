import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const REPO='/Users/willcobb/Code.local/pocketry';
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'};
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1:5187');let file=url.pathname.startsWith('/tutorial-assets/')?REPO+'/docs/tutorial/air-duster/'+decodeURIComponent(url.pathname.slice(17)):'/private/tmp/pocketry-headless-tutorial-20260915/app'+decodeURIComponent(url.pathname); if(!path.extname(file)) file='/private/tmp/pocketry-headless-tutorial-20260915/app/index.html';const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(bytes);}catch{res.writeHead(404);res.end('Not found');}});
await new Promise(resolve=>server.listen(5187,'127.0.0.1',resolve));
console.log('Headless tutorial preview ready on http://127.0.0.1:5187/');
