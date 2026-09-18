{await click(page.getByRole('button',{name:'Add to bin',exact:true}));await field(page.locator('#tool-name-0'),'Angled Nozzle');await click(page.getByRole('button',{name:'Add and arrange',exact:true}));
await section('05','Set the bin size and rough layout');await caption('Set the bin footprint, then size the pockets before fine-tuning their positions.');
await click(page.getByRole('button',{name:'Size',exact:true}));
await target(page.getByTestId('select-grid-pitch'));await pause(600);await page.locator('#tutorial-focus').evaluate(el=>el.style.opacity='0');
await field(page.getByLabel('Width in standard cells',{exact:true}),4);await field(page.getByLabel('Length in standard cells',{exact:true}),4);await field(page.getByLabel('Bin height in units',{exact:true}),6.5);
await click(page.getByRole('switch',{name:'Keep bin size fixed',exact:true}));await shot('bin-sized');
await click(page.getByRole('button',{name:'Construction',exact:true}));
for(const name of ['Stacking lip','Solid fill','Magnet holes','Screw holes']){await target(page.getByRole('switch',{name,exact:true}));await pause(400);}await page.locator('#tutorial-focus').evaluate(el=>el.style.opacity='0');
await click(page.getByRole('button',{name:'Layout',exact:true}));await click(page.getByRole('button',{name:'Pockets',exact:true}));await shot('layout-start');

}
{
page.tut={};
page.tut.binPoint=async(x,y)=>page.getByTestId('layout-canvas').locator(':scope > g').evaluate((el,p)=>{const q=new DOMPoint(84+p.x,84-p.y).matrixTransform(el.getScreenCTM());return{x:q.x,y:q.y};},{x,y});
page.tut.pocketPath=name=>page.locator('path[data-cutout-id]').filter({hasText:name});
page.tut.place=async(name,x,y)=>{await click(page.getByRole('button',{name:name+' — edit pocket properties',exact:true}));const end=await page.tut.binPoint(x,y);const pos=await page.tut.pocketPath(name).evaluate((el,end)=>{const box=el.getBBox(),ctm=el.getScreenCTM();const mid=new DOMPoint(box.x+box.width/2,box.y+box.height/2).matrixTransform(ctm);const dx=end.x-mid.x,dy=end.y-mid.y;for(let fy=.1;fy<1;fy+=.1)for(let fx=.1;fx<1;fx+=.1){const pt=new DOMPoint(box.x+fx*box.width,box.y+fy*box.height);if(!el.isPointInFill(pt))continue;const q=pt.matrixTransform(ctm);if(q.x>410&&q.x<1370&&q.y>150&&q.y<740&&q.x+dx>410&&q.x+dx<1370&&q.y+dy>150&&q.y+dy<740)return{x:q.x,y:q.y,dx,dy};}throw Error('No visible drag point');},end);await drag(pos.x,pos.y,pos.x+pos.dx,pos.y+pos.dy);};
await caption('Drag each pocket into a rough position. We’ll check the size and gaps next.');
for(const args of [['Air Duster',30,0],['Adapters',-20,-20],['Angled Nozzle',-45,45]])await page.tut.place(...args);
await shot('layout-rough');
await checkpoint("06-layout");
await click(page.getByRole('button',{name:'Pockets',exact:true}));await click(page.getByRole('button',{name:'Air Duster — edit pocket properties',exact:true}));
await click(page.getByTestId('pocket-size-settings').locator(':scope > summary'));await shot('duster-original-size');

}
{
page.tut.measure=async(kind,fraction,name)=>{const info=await page.tut.pocketPath('Air Duster').evaluate((el,{kind,fraction})=>{const b=el.getBBox(),nums=el.getAttribute('d').match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi).map(Number),pts=[];for(let i=0;i<nums.length;i+=2)pts.push({x:nums[i],y:nums[i+1]});const c=kind==='vertical'?b.x+b.width*fraction:b.y+b.height*fraction;const intersections=[];for(let i=0;i<pts.length;i++){const a=pts[i],d=pts[(i+1)%pts.length];const p=kind==='vertical'?a.x:a.y,q=kind==='vertical'?d.x:d.y;if((p<=c&&q>c)||(q<=c&&p>c)){const t=(c-p)/(q-p);intersections.push({x:a.x+t*(d.x-a.x),y:a.y+t*(d.y-a.y)});}}intersections.sort((a,b)=>kind==='vertical'?a.y-b.y:a.x-b.x);const ends=[intersections[0],intersections.at(-1)];return ends.map(p=>{const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return{x:q.x,y:q.y};});},{kind,fraction});for(const p of info)await clickAt(p.x,p.y);await pause(1800);const reading=await page.getByTestId('layout-measurement-label').textContent();marks.push({type:'measurement',name,reading,time:(Date.now()-zero)/1000});await shot(name);return reading;};

}
{
page.tut.details=async(id)=>{const loc=page.getByTestId(id);if(await loc.getAttribute('open')===null)await click(loc.locator(':scope > summary'));};
page.tut.select=async name=>click(page.getByRole('button',{name:name+' — edit pocket properties',exact:true}));
page.tut.setSize=async(name,w,l)=>{await page.tut.select(name);await page.tut.details('pocket-size-settings');if(await page.getByRole('button',{name:'Unlock pocket aspect ratio',exact:true}).isVisible())await click(page.getByRole('button',{name:'Unlock pocket aspect ratio',exact:true}));await field(page.getByLabel('Pocket width in millimetres',{exact:true}),w);await field(page.getByLabel('Pocket length in millimetres',{exact:true}),l);};
page.tut.precise=async(name,x,y,r)=>{await page.tut.select(name);await page.tut.details('pocket-position-settings');await field(page.getByLabel('X position in millimetres',{exact:true}),x);await field(page.getByLabel('Y position in millimetres',{exact:true}),y);await field(page.getByLabel('Pocket rotation in degrees',{exact:true}),r);};

}
await caption('Use position and rotation to arrange the tools with room around each pocket.');
for(const p of [['Air Duster',33.49,3.55,0],['Adapters',-15.69,-20.35,.53],['Angled Nozzle',-42,47.89,143.04]])await page.tut.precise(...p);
await caption('Round the pocket edges. Adjust clearance after trying the printed fit check.');
for(const name of ['Air Duster','Adapters','Angled Nozzle']){await page.tut.select(name);await page.tut.details('pocket-edge-settings');await field(page.getByLabel('Top edge rounding in millimetres',{exact:true}),1);await field(page.getByLabel('Bottom edge fillet in millimetres',{exact:true}),1.2);await field(page.getByLabel('Outline corner rounding in millimetres',{exact:true}),1);}
await section('06','Create the USB cable pocket with Finger access');
await click(page.getByRole('button',{name:'Finger access',exact:true}));await caption('In addition to the photos, we’ll create a pocket for the USB cable using Finger access.',2200);
await click(page.getByTestId('button-add-finger-hole'));await click(page.locator('[data-testid^="button-rename-finger-hole-"]').first());await field(page.getByLabel('Finger access name',{exact:true}),'USB Cable');
await click(page.getByTestId('finger-shape-slot'));await click(page.getByTestId('finger-bottom-flat'));await click(page.getByTestId('finger-ends-flat'));
await caption('Measure the coiled cable, then set the slot’s width, length, and depth. Calipers help with depth.',2200);await field(page.getByLabel('Depth in millimetres',{exact:true}),37.3);
await page.tut.details('finger-size-settings');await field(page.getByLabel('Width in millimetres',{exact:true}),17.44);await field(page.getByLabel('Length in millimetres',{exact:true}),103.59);
await page.tut.details('finger-edge-settings');await field(page.getByLabel('Corner round in millimetres',{exact:true}),1);await field(page.getByLabel('Top edge round in millimetres',{exact:true}),1);await field(page.getByLabel('Bottom edge round in millimetres',{exact:true}),1.2);
await page.tut.details('finger-position-settings');await field(page.getByLabel('X position in millimetres',{exact:true}),-60.06);await field(page.getByLabel('Y position in millimetres',{exact:true}),-21.21);await field(page.getByLabel('Elongated finger hole rotation',{exact:true}),88.5);await shot('usb-finger-pocket');
