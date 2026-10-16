{
await section('10','Set pocket depths and add finger access');await click(page.getByRole('button',{name:'Layout',exact:true}));await click(page.getByRole('button',{name:'Pockets',exact:true}));await caption('Adjust pocket depth based on measurements of each real tool. Use calipers for accurate depth measurements.');
for(const [name,depth] of [['Air Duster',39],['Adapters',34],['Angled Nozzle',34]]){await page.tut.select(name);await click(page.getByRole('combobox',{name:'Pocket depth mode',exact:true}));await click(page.getByRole('option',{name:'Fixed depth',exact:true}));await field(page.getByLabel('Pocket cut depth in millimetres',{exact:true}),depth);}
await click(page.getByRole('button',{name:'Finger access',exact:true}));await caption('Add two more finger-access scoops so the tools are easy to lift out.');await click(page.getByTestId('button-add-finger-hole'));await click(page.getByTestId('finger-shape-slot'));await click(page.getByTestId('finger-bottom-curved'));await field(page.getByLabel('Depth in millimetres',{exact:true}),32.7);
await page.tut.details('finger-size-settings');await field(page.getByLabel('Width in millimetres',{exact:true}),22.43);await field(page.getByLabel('Length in millimetres',{exact:true}),153.36);
await page.tut.details('finger-edge-settings');await field(page.getByLabel('Top edge round in millimetres',{exact:true}),0);
const a=await page.tut.binPoint(0,0),b=await page.tut.binPoint(0,-25);await drag(a.x,a.y,b.x,b.y);
await page.tut.details('finger-position-settings');await field(page.getByLabel('X position in millimetres',{exact:true}),-.08);await field(page.getByLabel('Y position in millimetres',{exact:true}),-25.27);await field(page.getByLabel('Elongated finger hole rotation',{exact:true}),.21);await shot('finger-slot');
await click(page.getByTestId('button-add-finger-hole'));await click(page.getByTestId('finger-bottom-curved'));await field(page.getByLabel('Depth in millimetres',{exact:true}),33.5);
await page.tut.details('finger-size-settings');await field(page.getByLabel('Diameter in millimetres',{exact:true}),22);await page.tut.details('finger-edge-settings');await field(page.getByLabel('Top edge round in millimetres',{exact:true}),0);
const c=await page.tut.binPoint(-39.78,68.13);await drag(a.x,a.y,c.x,c.y);
await page.tut.details('finger-position-settings');await field(page.getByLabel('X position in millimetres',{exact:true}),-39.78);await field(page.getByLabel('Y position in millimetres',{exact:true}),68.13);await shot('finger-round');
await click(page.getByRole('button',{name:'3D',exact:true}));await pause(600);await page.getByTestId('bin-preview-status').waitFor({state:'hidden',timeout:90000});await shot('bin-with-scoops');

}
{
await section('11','Color the bin and fix the warning');await caption('Use a gray body with black pocket floors and a black rim.');
await click(page.getByRole('button',{name:'Materials & Colors',exact:true}));
const colors={};for(const id of ['input-bin-color','input-pocket-floor-color','input-stacking-rim-color']){await target(page.getByTestId(id));colors[id]=await page.getByTestId(id).inputValue();await pause(700);}await page.locator('#tutorial-focus').evaluate(el=>el.style.opacity='0');
await field(page.getByTestId('input-pocket-floor-thickness'),.6);await field(page.getByTestId('input-stacking-rim-thickness'),1.25);await shot('materials');
await click(page.getByTestId('canvas-warnings').getByRole('button').first());await pause(2000);await shot('floor-warning');

}
{
await page.getByTestId('bin-preview-status').waitFor({state:'hidden',timeout:90000});
await caption('The black floor layer reaches the recesses between the base feet.',1500);
if(await page.getByTestId('canvas-warnings').getByRole('button').first().getAttribute('aria-expanded')==='false')await click(page.getByTestId('canvas-warnings').getByRole('button').first());
await shot('floor-warning-complete');await click(page.getByTestId('canvas-warnings').getByRole('button').filter({hasText:'Floor color may show on the underside.'}));
await shot('warning-edit-pocket');await caption('Reduce pocket depth from 39 to 38.5 mm to leave more floor underneath.');
await field(page.getByLabel('Pocket cut depth in millimetres',{exact:true}),38.5);await page.getByTestId('canvas-warnings').waitFor({state:'hidden',timeout:30000});
await caption('The warning clears. The tool sits 0.5 mm higher; check that seating depth.',1500);await shot('warning-cleared');
await click(page.getByRole('button',{name:'Export',exact:true}));await shot('export-ready');
await section('12','Inspect the completed bin');await caption('Inspect the rounded edges, pocket floors, cable pocket, and finger scoops.');
if(await page.getByTestId('bin-viewport').count()===0)await click(page.getByRole('button',{name:'3D',exact:true}));await page.getByTestId('bin-preview-status').waitFor({state:'hidden',timeout:90000});
await drag(1050,470,1150,510,1600);await drag(1100,470,1040,510,1200);
await move(1030,480);await page.mouse.wheel(0,-130);await pause(1100);await shot('inspect-3d');await page.mouse.wheel(0,130);await pause(500);
await click(page.getByRole('button',{name:'Cross-section View',exact:true}));await caption('Cross-section View helps inspect the interior. The exported model remains whole.');
await click(page.getByRole('switch',{name:'Cut the preview open',exact:true}));await field(page.getByLabel('Position in millimetres',{exact:true}),33.49);await pause(600);await page.getByTestId('bin-preview-status').waitFor({state:'hidden',timeout:90000});await shot('cross-section');
await click(page.getByTestId('button-show-full-bin'));await pause(600);await page.getByTestId('bin-preview-status').waitFor({state:'hidden',timeout:90000});await shot('full-bin-restored');

}
{
await section('13','Export the final bin and preserve the project');await caption('After the real tools fit and pocket depths are checked, export the full bin.',1500);await click(page.getByRole('button',{name:'Export',exact:true}));
await click(page.getByTestId('button-export-3mf'));await click(page.getByTestId('checkbox-export-project'));await shot('3mf-confirmation');
await caption('Save the finished bin and an editable project backup.');const count=downloads.length;await click(page.getByTestId('button-export-multicolor-3mf'));for(let i=0;i<120&&downloads.length<count+2;i++)await pause(500);if(downloads.length<count+2)throw Error('3MF and project downloads did not finish');await shot('3mf-downloaded');
await page.goto('chrome://downloads/');await pause(700);await overlay();await caption('Keep the editable project with the print file. Check the slicer preview before printing.',1800);await shot('downloads-final');
const names=await page.getByRole('link').allTextContents();await page.goBack();await page.getByRole('button',{name:'Project',exact:true}).waitFor({state:'visible',timeout:30000});await overlay();await click(page.getByRole('button',{name:'Project',exact:true}));await target(page.getByTestId('button-export-project'));await pause(1000);await page.locator('#tutorial-focus').evaluate(el=>el.style.opacity='0');await caption('Use Project → Export project to save another editable backup later.');
await click(page.getByRole('button',{name:'3D',exact:true}));await pause(500);await page.getByTestId('bin-preview-status').waitFor({state:'hidden',timeout:90000});await drag(1020,470,1110,515,1500);await caption('Print the fit test first. Then check the full model in your slicer.',2000);await shot('finished-bin');

}
