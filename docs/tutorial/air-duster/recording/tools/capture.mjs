import { chromium } from '/Users/willcobb/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const ROOT='/private/tmp/pocketry-tutorial-revision-20260915';
const REPO='/Users/willcobb/Code.local/pocketry';
const OUT=ROOT+'/final-take';
await fs.mkdir(OUT,{recursive:true}); await fs.mkdir(ROOT+'/jobs',{recursive:true});
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'};
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1:5187');let file=url.pathname.startsWith('/tutorial-assets/')?REPO+'/docs/tutorial/air-duster/'+decodeURIComponent(url.pathname.slice(17)):'/private/tmp/pocketry-headless-tutorial-20260915/app'+decodeURIComponent(url.pathname); if(!path.extname(file)) file='/private/tmp/pocketry-headless-tutorial-20260915/app/index.html';const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(bytes);}catch{res.writeHead(404);res.end('Not found');}});
// The dedicated rehearsal server owns port 5187 and serves the verified build.
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
let context, page, video, zero, marks=[], downloads=[], position={x:720,y:440};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function setup(folder=OUT){await fs.mkdir(folder,{recursive:true});context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:folder,size:{width:1440,height:900}},acceptDownloads:true,colorScheme:'light'});page=await context.newPage();video=page.video();page.setDefaultTimeout(12000); const cdp=await context.newCDPSession(page);const ti=await cdp.send('Target.getTargetInfo');await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',browserContextId:ti.targetInfo.browserContextId,downloadPath:folder,eventsEnabled:true});page.on('download',async d=>{const p=folder+'/'+d.suggestedFilename();for(let i=0;i<180;i++){try{const st=await fs.stat(p);if(st.size>0){downloads.push(p);console.log('DOWNLOAD '+p);return;}}catch{}await pause(500);}throw Error('Download incomplete '+p);}); zero=Date.now();await page.goto('http://127.0.0.1:5187/');await page.waitForLoadState('networkidle'); await overlay();}
async function overlay(){await page.addStyleTag({content:'.h-dvh{height:810px!important} #tutorial-caption{position:fixed;bottom:0;left:0;width:100%;height:90px;background:#101a2c;color:#fff;display:flex;align-items:center;justify-content:center;padding:14px 70px;font:500 23px/1.35 system-ui;text-align:center;z-index:2147483645;pointer-events:none} #tutorial-pointer{position:fixed;left:0;top:0;width:25px;height:32px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 1px 2px #0008);transform:translate(720px,440px)} #tutorial-focus{position:fixed;border:3px solid #f59e0b;border-radius:7px;box-shadow:0 0 0 4px #f59e0b25;pointer-events:none;z-index:2147483646;opacity:0;transition:opacity .15s}'}); await page.evaluate(()=>{const caption=document.createElement('div');caption.id='tutorial-caption';document.body.append(caption);const pointer=document.createElement('div');pointer.id='tutorial-pointer';const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 25 32');const arrow=document.createElementNS(svg.namespaceURI,'path');for(const [k,v] of Object.entries({d:'M2 1L2 26L8 20L13 30L18 27L13 18L23 17Z',fill:'white',stroke:'#142438','stroke-width':'1.5'}))arrow.setAttribute(k,v);svg.append(arrow);pointer.append(svg);document.body.append(pointer);const focus=document.createElement('div');focus.id='tutorial-focus';document.body.append(focus);document.addEventListener('pointermove',e=>{pointer.style.transform=`translate(${e.clientX}px,${e.clientY}px)`;});document.addEventListener('pointerdown',()=>pointer.style.filter='drop-shadow(0 0 8px #f59e0b)');document.addEventListener('pointerup',()=>pointer.style.filter='drop-shadow(0 1px 2px #0008)');});}
async function caption(text,hold=1000){marks.push({type:'caption',time:(Date.now()-zero)/1000,text});await page.locator('#tutorial-caption').evaluate((el,t)=>el.textContent=t,text);await pause(hold);}
async function move(x,y,ms=500){const from={...position};const steps=Math.max(12,Math.round(ms/25));for(let i=1;i<=steps;i++){const t=i/steps;await page.mouse.move(from.x+(x-from.x)*t,from.y+(y-from.y)*t);await pause(ms/steps);}position={x,y};}
async function clickAt(x,y,options={}){await move(x,y);await page.mouse.click(x,y,options);await pause(350);}
async function target(loc){await loc.scrollIntoViewIfNeeded();await pause(180);const b=await loc.boundingBox();if(!b)throw Error('No target bounds');await page.locator('#tutorial-focus').evaluate((el,b)=>{Object.assign(el.style,{left:(b.x-4)+'px',top:(b.y-4)+'px',width:(b.width+8)+'px',height:(b.height+8)+'px',opacity:'1'});},b);await move(b.x+b.width/2,b.y+b.height/2);return b;}
async function click(loc){await target(loc);await loc.click();await pause(350);await page.locator('#tutorial-focus').evaluate(el=>el.style.opacity='0');}
async function field(loc,value){await target(loc);await loc.click();await loc.press('Meta+A');await loc.pressSequentially(String(value),{delay:100});await pause(200);await loc.press('Enter');await pause(400);await page.locator('#tutorial-focus').evaluate(el=>el.style.opacity='0');}
async function drag(x1,y1,x2,y2,ms=900){await move(x1,y1);await page.mouse.down();await move(x2,y2,ms);await page.mouse.up();await pause(400);}
async function shot(name){await page.screenshot({path:OUT+'/'+name+'.png'});await fs.writeFile(OUT+'/'+name+'.txt',await page.locator('body').innerText());}
async function checkpoint(id){await pause(400);const data=await page.evaluate(async()=>{if(!(await indexedDB.databases()).some(d=>d.name==='keyval-store'))return [];const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('keyval-store');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{if(!db.objectStoreNames.contains('keyval'))return{};const tx=db.transaction('keyval','readonly'),store=tx.objectStore('keyval');return await new Promise((resolve,reject)=>{const r=store.getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}});await fs.writeFile(OUT+'/checkpoint-'+id+'.json',JSON.stringify(data,null,2));await shot('boundary-'+id);}
async function section(id,title){if(marks.some(m=>m.type==='section'))await checkpoint('before-'+id);await pause(600);marks.push({type:'section',id,title,time:(Date.now()-zero)/1000});await fs.writeFile(OUT+'/marks.json',JSON.stringify(marks,null,2));console.log('SECTION '+id+' '+title);}
async function imagePoint(x,y){return page.getByTestId('trace-source-image').evaluate((el,p)=>{const pt=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:pt.x,y:pt.y};},{x,y});}
async function imageDrag(x1,y1,x2,y2){const a=await imagePoint(x1,y1),b=await imagePoint(x2,y2);await drag(a.x,a.y,b.x,b.y);}
async function state(){console.log(await page.locator('body').innerText());}

async function importPhoto(filename,first=false){
 const input=first?page.locator('input[type=file]').first():page.getByLabel('Choose another photo');
 // The label triggers the native chooser in this headless browser only.
 const label=await input.evaluate(el=>{if(el.id){const l=document.querySelector('label[for="'+el.id+'"]');if(l)return {id:el.id};}return null;});
 if(label){const loc=page.locator('label[for="'+label.id+'"]');await target(loc);const chooser=page.waitForEvent('filechooser');await loc.click();await (await chooser).setFiles(filename);}else{const loc=page.getByText('Choose photo',{exact:true});if(await loc.isVisible()){await target(loc);const chooser=page.waitForEvent('filechooser');await loc.click();await (await chooser).setFiles(filename);}else{await move(850,430);await input.setInputFiles(filename);}}
 await pause(500);
}
async function showDownloads(text){await page.goto('chrome://downloads/');await overlay();await caption(text,2200);await shot('download-list-'+downloads.length);const names=await page.getByRole('link').allTextContents();marks.push({type:'downloads',time:(Date.now()-zero)/1000,names});await page.goBack();await page.getByRole('button',{name:'Project',exact:true}).waitFor({state:'visible',timeout:30000});await overlay();}
async function waitDownloads(count){for(let i=0;i<180&&downloads.length<count;i++)await pause(500);if(downloads.length<count)throw Error('Expected '+count+' completed downloads');await pause(500);}

await setup();
try {
await section('00','Prepare your photographs');
await page.evaluate(()=>{const wrap=document.createElement('div');wrap.id='photo-intro';Object.assign(wrap.style,{position:'fixed',inset:'0 0 90px',background:'#f6f7f9',display:'flex',alignItems:'center',justifyContent:'center',zIndex:'2147483640'});const photo=document.createElement('img');photo.id='intro-image';Object.assign(photo.style,{height:'760px',maxWidth:'1200px',objectFit:'contain',borderRadius:'8px'});wrap.append(photo);const title=document.createElement('div');title.id='intro-title';Object.assign(title.style,{position:'absolute',top:'24px',left:'32px',font:'600 26px system-ui',color:'#17243a'});wrap.append(title);document.body.append(wrap);});
for(const [file,label,captions] of [
 ['air-duster.jpg','Air duster',[['Start with photographs of the tools you want to trace.',2500],['Photograph tools on the provided templates to make scaling easier.',4500]]],
 ['adapter-stack.jpg','Adapter stack',[["Here are the photographs we took of the air duster, adapters, and angled nozzle.",7000]]],
 ['angled-nozzle.jpg','Angled nozzle',[["Some of the shadowing isn’t ideal. We’ll correct it when editing the outlines.",7000]]]
]){await page.locator('#intro-image').evaluate((el,file)=>el.src='/tutorial-assets/photos/'+file,file);await page.locator('#intro-title').evaluate((el,label)=>el.textContent=label,label);await page.locator('#intro-image').evaluate(el=>el.decode());for(const [text,hold] of captions){if(file==='air-duster.jpg'&&text.startsWith('Photograph')){const b=await page.locator('#intro-image').boundingBox();for(const [x,y] of [[.213,.199],[.829,.199],[.208,.805],[.812,.819]]){await page.evaluate(({x,y,b})=>{const el=document.createElement('div');el.className='marker-highlight';Object.assign(el.style,{position:'fixed',left:(b.x+x*b.width-28)+'px',top:(b.y+y*b.height-28)+'px',width:'56px',height:'56px',border:'4px solid #f59e0b',borderRadius:'9px',zIndex:'2147483641'});document.body.append(el);},{x,y,b});} }await caption(text,hold);}await page.locator('.marker-highlight').evaluateAll(els=>els.forEach(el=>el.remove()));}
await page.locator('#photo-intro').evaluate(el=>el.remove());
{await section('01','Start a project');
await caption('Start with a new project. We’ll build this bin from the tool outlines.');
await click(page.getByRole('link',{name:'Bin',exact:true}));
await click(page.getByRole('button',{name:'Project',exact:true}));
await shot('project-panel');

}
{
await click(page.getByTestId('button-new-project'));
if(await page.getByTestId('button-confirm-new-project').isVisible())await click(page.getByTestId('button-confirm-new-project'));
await click(page.getByTestId('button-save-library'));
await field(page.getByTestId('input-project-name'),'Air Duster Tutorial');
if(await page.getByTestId('button-confirm-save-library').isVisible())await click(page.getByTestId('button-confirm-save-library'));
await click(page.getByRole('link',{name:'Trace',exact:true}));
await section('02','Trace the air duster');
await caption('Print the calibration sheet at 100% and check its 100 mm reference bar.');
await importPhoto(REPO+'/docs/tutorial/air-duster/photos/air-duster.jpg',true);
await page.getByTestId('button-apply-auto-perspective').waitFor({state:'visible',timeout:30000});
await shot('duster-import');

}
{
for(const loc of await page.locator('[data-testid="ruler-marker"]').all()){const b=await loc.boundingBox();if(b)await move(b.x+b.width/2,b.y+b.height/2);}
await click(page.getByTestId('button-apply-auto-perspective'));
await page.getByTestId('button-set-region').waitFor({state:'visible'});
await pause(1300);
await shot('duster-corrected');

}
{
await click(page.getByTestId('button-set-region'));
await imageDrag(265,260,700,950);
await page.getByTestId('detected-contour-stroke').first().waitFor({state:'visible',timeout:30000});
await caption('Follow the physical edge of the tool. Shadows and reflections can distort the trace.');
await click(page.getByRole('combobox',{name:'Margin',exact:true}));
await click(page.getByRole('option',{name:'0.0 mm',exact:true}));

await shot('duster-detected');

}
{
await target(page.getByRole('slider',{name:'Detail',exact:true}));
await page.getByRole('slider',{name:'Detail',exact:true}).press('Home');
for(let i=0;i<29;i++)await page.getByRole('slider',{name:'Detail',exact:true}).press('ArrowRight');
await target(page.getByRole('slider',{name:'Smoothing',exact:true}));await page.getByRole('slider',{name:'Smoothing',exact:true}).press('Home');
await page.locator('#tutorial-focus').evaluate(el=>el.style.opacity='0');
await shot('duster-simplified');

}
{
await click(page.getByRole('button',{name:'Edit points',exact:true}));await click(page.getByRole('button',{name:/^Shape 1/})); await shot('duster-ready');
}
{
const {editTrace}=await import(ROOT+'/trace-editor.mjs');await editTrace({page,fs,REPO,OUT,pause,move,imagePoint,caption,shot},'Air Duster');
}
{
await click(page.getByRole('button',{name:'Add to bin',exact:true}));await field(page.locator('#tool-name-0'),'Air Duster');await click(page.getByRole('button',{name:'Add and trace another photo',exact:true}));
await section('03','Trace the adapters');await caption('Check reflective areas carefully. The pocket should follow the outside edge.');await importPhoto(REPO+'/docs/tutorial/air-duster/photos/adapter-stack.jpg');await page.getByTestId('button-apply-auto-perspective').waitFor({state:'visible',timeout:30000});await click(page.getByTestId('button-apply-auto-perspective'));await page.getByTestId('button-set-region').waitFor({state:'visible'});await pause(1000);await shot('adapters-corrected');
await click(page.getByTestId('button-set-region'));await imageDrag(330,335,530,885);await page.getByTestId('detected-contour-stroke').first().waitFor({state:'visible',timeout:30000});
await target(page.getByRole('slider',{name:'Sensitivity',exact:true}));for(let i=0;i<24;i++)await page.getByRole('slider',{name:'Sensitivity',exact:true}).press('ArrowLeft');await pause(800);
await click(page.getByRole('combobox',{name:'Margin',exact:true}));await click(page.getByRole('option',{name:'0.0 mm',exact:true}));
await target(page.getByRole('slider',{name:'Detail',exact:true}));await page.getByRole('slider',{name:'Detail',exact:true}).press('Home');for(let i=0;i<29;i++)await page.getByRole('slider',{name:'Detail',exact:true}).press('ArrowRight');await target(page.getByRole('slider',{name:'Smoothing',exact:true}));await page.getByRole('slider',{name:'Smoothing',exact:true}).press('Home');await page.locator('#tutorial-focus').evaluate(el=>el.style.opacity='0');
await click(page.getByRole('button',{name:'Edit points',exact:true}));await click(page.getByRole('button',{name:/^Shape 1/}));await shot('adapters-ready');
const {editTrace}=await import(ROOT+'/trace-editor.mjs');await editTrace({page,fs,REPO,OUT,pause,move,imagePoint,caption,shot},'Adapters');

}
{
await click(page.getByRole('button',{name:'Add to bin',exact:true}));await field(page.locator('#tool-name-0'),'Adapters');await click(page.getByRole('button',{name:'Add and trace another photo',exact:true}));
await section('04','Trace the angled nozzle');await caption('Remove the false notch while preserving the nozzle’s real corners.');await importPhoto(REPO+'/docs/tutorial/air-duster/photos/angled-nozzle.jpg');await page.getByTestId('button-apply-auto-perspective').waitFor({state:'visible',timeout:30000});await click(page.getByTestId('button-apply-auto-perspective'));await page.getByTestId('button-set-region').waitFor({state:'visible'});await pause(1000);await shot('nozzle-corrected');
await click(page.getByTestId('button-set-region'));await imageDrag(320,515,560,785);await page.getByTestId('detected-contour-stroke').first().waitFor({state:'visible',timeout:30000});
await click(page.getByRole('combobox',{name:'Margin',exact:true}));await click(page.getByRole('option',{name:'0.0 mm',exact:true}));
await target(page.getByRole('slider',{name:'Detail',exact:true}));await page.getByRole('slider',{name:'Detail',exact:true}).press('Home');for(let i=0;i<29;i++)await page.getByRole('slider',{name:'Detail',exact:true}).press('ArrowRight');await target(page.getByRole('slider',{name:'Smoothing',exact:true}));await page.getByRole('slider',{name:'Smoothing',exact:true}).press('Home');await page.locator('#tutorial-focus').evaluate(el=>el.style.opacity='0');
if(await page.getByRole('button',{name:'Delete shape 2',exact:true}).isVisible())await click(page.getByRole('button',{name:'Delete shape 2',exact:true}));await click(page.getByRole('button',{name:'Edit points',exact:true}));await click(page.getByRole('button',{name:/^Shape 1/}));await shot('nozzle-ready');
const {editTrace}=await import(ROOT+'/trace-editor.mjs');await editTrace({page,fs,REPO,OUT,pause,move,imagePoint,caption,shot},'Angled Nozzle');

}
for(const stage of ['bin-job.js','fit-job.js','finish-job.js']){await eval('(async()=>{'+await fs.readFile(ROOT+'/'+stage,'utf8')+'})()');}
await checkpoint('13-final');await pause(1800);marks.push({type:'end',time:(Date.now()-zero)/1000});await fs.writeFile(OUT+'/marks.json',JSON.stringify(marks,null,2));await fs.writeFile(OUT+'/downloads.json',JSON.stringify(downloads,null,2));const original=await video.path();await context.close();await fs.rename(original,OUT+'/continuous-original.webm');console.log('CAPTURE COMPLETE '+OUT);
} catch(e){await shot('capture-error');await fs.writeFile(OUT+'/marks.json',JSON.stringify(marks,null,2));console.error(e);throw e;} finally{await browser.close();}
