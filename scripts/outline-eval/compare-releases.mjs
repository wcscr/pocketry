/**
 * Capture release comparisons through the real photo workflow. Requires an
 * existing Playwright installation and local development servers; installs
 * nothing and never changes application state except through rendered controls.
 * Read-only worker/IndexedDB observations record outputs, never supply inputs.
 */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,all)=>v.startsWith('--')?[...a,[v.slice(2),all[i+1]]]:a,[]));
for(const key of ['photos','plan','url','version','commit','out','playwright']) if(!args[key]) throw Error(`Missing --${key}`);
const {chromium}=await import(pathToFileURL(resolve(args.playwright)).href);
const plan=JSON.parse(readFileSync(args.plan,'utf8')).filter(c=>!args.only||c.name.includes(args.only));
const out=resolve(args.out);mkdirSync(out,{recursive:true});
const hook=readFileSync(fileURLToPath(new URL('./capture-hooks.js',import.meta.url)),'utf8');
const browser=await chromium.launch({channel:'chrome',headless:true});
const summary=[];
try {
 for(const item of plan) {
  const dest=join(out,item.name+'.json');
  if(args.resume==='yes'&&existsSync(dest)){const saved=JSON.parse(readFileSync(dest));if(saved.status==='complete'&&saved.observation?.detectionComplete){summary.push({case:saved.case,status:saved.status});continue;}}
  const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
  const page=await context.newPage();
  await page.addInitScript({content:hook});
  const actions=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  const note=async action=>actions.push({action,at:new Date().toISOString()});
  const source=readFileSync(join(args.photos,item.sourceFile));
  const record={case:item.name,title:item.title,photo:item.photo,sourceFile:item.sourceFile,sourceSha256:createHash('sha256').update(source).digest('hex'),version:args.version,commit:args.commit,viewport:{width:1440,height:900},actions,errors,status:'incomplete'};
  try {
   if(item.sha256&&record.sourceSha256!==item.sha256)throw Error('Original photo hash does not match the frozen plan');
   await page.goto(args.url,{waitUntil:'networkidle'});
   record.userAgent=await page.evaluate(()=>navigator.userAgent);
   const welcome=page.getByRole('button',{name:'Close',exact:true});
   if(await welcome.isVisible()){await welcome.click();await note('Dismiss welcome dialog');}
   await page.locator('input[type="file"]').first().setInputFiles(join(args.photos,item.sourceFile));await note('Choose original, unmodified photo');
   const offer=page.getByRole('button',{name:/^Correct perspective & use (aid )?scale$/});
   await offer.first().waitFor({state:'visible',timeout:45000});
   const aid=page.getByRole('button',{name:'Correct perspective & use aid scale',exact:true});
   const chosen=await aid.isVisible()?aid:page.getByRole('button',{name:'Correct perspective & use scale',exact:true});
   const offerName=await chosen.innerText();await chosen.click();await note(offerName);
   await offer.first().waitFor({state:'hidden',timeout:30000});
   await page.waitForTimeout(1200);
   const image=page.getByTestId('trace-source-image');
   await image.waitFor({state:'visible',timeout:15000});
   const dimensions=await image.evaluate(e=>({width:Number(e.getAttribute('width')),height:Number(e.getAttribute('height'))}));
   record.imageSize=dimensions;
   if(item.imageSize&&(dimensions.width!==item.imageSize.width||dimensions.height!==item.imageSize.height)) throw Error(`Corrected dimensions differ from plan: ${JSON.stringify(dimensions)}`);
   // Save the app's corrected photo as an output for presentation only.
   const photo=await image.evaluate(async e=>Array.from(new Uint8Array(await(await fetch(e.getAttribute('href')||e.getAttribute('xlink:href'))).arrayBuffer())));
   writeFileSync(join(out,item.name+'.working.png'),Buffer.from(photo));
   if(!item.region){record.status='calibrated';await page.screenshot({path:join(out,item.name+'.png')});}
   else {
    let region={...item.region};
    if(item.normalized) region={x:region.x*dimensions.width,y:region.y*dimensions.height,width:region.width*dimensions.width,height:region.height*dimensions.height};
    record.requestedRegion=region;
    const fit=page.getByRole('button',{name:'Fit to screen',exact:true});
    if(await fit.isVisible()){await fit.click();await note('Fit to screen');await page.waitForTimeout(300);}
    const onScreen=()=>image.evaluate((e,r)=>{const m=e.getScreenCTM();const p=(x,y)=>({x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f});return{from:p(r.x,r.y),to:p(r.x+r.width,r.y+r.height),viewport:e.closest('svg').getBoundingClientRect().toJSON()};},region);
    let screen=await onScreen();
    const fits=s=>s.from.x>s.viewport.left+10&&s.from.y>s.viewport.top+35&&s.to.x<s.viewport.right-10&&s.to.y<s.viewport.bottom-35;
    for(let n=0;!fits(screen)&&n<8;n++){await page.getByRole('button',{name:'Zoom out (-)',exact:true}).click();await note('Zoom out to expose region endpoints');await page.waitForTimeout(150);screen=await onScreen();}
    if(!fits(screen))throw Error('Region endpoints are obscured');
    const before=await page.evaluate(()=>window.pocketryCapture.state.count);
    await page.mouse.move(screen.from.x,screen.from.y);await page.mouse.down();await page.mouse.move(screen.to.x,screen.to.y,{steps:12});await page.mouse.up();await note('Draw planned tool region');
    if(args.version!=='1.9.0') await page.waitForFunction(n=>{const c=window.pocketryCapture.state;return c.count>n&&c.last&&(c.last.result||c.last.error);},before,{timeout:120000});
    await page.waitForFunction(async()=>{const d=await window.pocketryCapture.readDraft();return d?.detectionComplete&&d.state?.outline?.length>0;},null,{timeout:120000});
    await page.waitForTimeout(700);
    record.observation=await page.evaluate(async()=>{const capture=window.pocketryCapture;const r=capture.state.last;const d=await capture.readDraft();const fields=['fileName','imageSize','imageRotation','imageAlignment','calibration','calibrationSource','region','perspectiveCorrection','sensitivity','includeInteriorHoles','boundaryMethod','editableCurves','tolerancePx','smoothing','margin','outline','rawOutline','estimatedEdgeRegions','detectionHints'];const state=Object.fromEntries(fields.map(k=>[k,d.state[k]]));const digest=r?await crypto.subtle.digest('SHA-256',r.data):null;return{detectionComplete:d.detectionComplete,app:state,detect:r?{width:r.width,height:r.height,inputSha256:[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join(''),options:r.options,ms:r.ms,result:r.result,error:r.error??null}:null,captureErrors:capture.state.errors,renderedPaths:[...document.querySelectorAll('[data-testid="detected-contour-stroke"]')].map(e=>e.getAttribute('d'))};});
    if(!record.observation.detectionComplete||!record.observation.app.outline?.length||!record.observation.renderedPaths.length)throw Error('Final saved/rendered outline was not complete');
    if(args.version!=='1.9.0'&&!record.observation.detect?.result)throw Error('Worker result was not complete');
    const actual=record.observation.app.region;
    record.regionMaxDifference=Math.max(...Object.keys(region).map(k=>Math.abs(actual[k]-region[k])));
    if(record.regionMaxDifference>0.1)throw Error(`Actual region differs by ${record.regionMaxDifference}px`);
    record.status='complete';await note('Default detection and automatic cleanup complete; no manual settings changed');
    await page.screenshot({path:join(out,item.name+'.png')});
   }
  }catch(error){record.failure=String(error);await page.screenshot({path:join(out,item.name+'.failure.png')}).catch(()=>{});record.ui=await page.locator('body').innerText().catch(()=> '');}
  writeFileSync(dest,JSON.stringify(record,null,2)+'\n');summary.push({case:record.case,status:record.status,failure:record.failure});
  console.log(JSON.stringify(summary.at(-1)));await context.close();
 }
}finally{await browser.close();writeFileSync(join(out,'run-summary.json'),JSON.stringify(summary,null,2)+'\n');}
