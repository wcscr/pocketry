import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
const [modulePath,wasmPath,outputPath]=process.argv.slice(2);
if(!modulePath||!wasmPath||!outputPath)throw new Error('Usage: node verify-owned-shapes.mjs MODULE_JS WASM OUTPUT_JSON');
const {default:init}=await import(pathToFileURL(resolve(modulePath)));
const oc=await init({locateFile:()=>resolve(wasmPath),print:()=>{},printErr:()=>{}});
const report={node:process.version,checks:[],passed:false};const keep=[];
const own=x=>(keep.push(x),x);
const valid=s=>{const a=new oc.BRepCheck_Analyzer(s,true,false,true);try{return a.IsValid()&&a.IsExactMethod();}finally{a.delete();}};
const volume=s=>{const p=new oc.GProp_GProps();try{oc.BRepGProp.VolumeProperties(s,p,false,false,false);return p.Mass();}finally{p.delete();}};
const check=(name,condition,details={})=>{report.checks.push({name,passed:Boolean(condition),...details});if(!condition)throw new Error(name);};
try{
 for(const name of ['BRepAlgoAPI_Algo','CDM_Document']){let rejected=false;try{const unexpected=new oc[name]();unexpected.delete();}catch{rejected=true;}check(`${name} protected base has no public constructor`,rejected);}
 const builder=new oc.BRepPrimAPI_MakeBox(10,20,30),shape=own(builder.Shape());builder.delete();
 check('shape survives builder destruction',valid(shape)&&Math.abs(volume(shape)-6000)<1e-7);
 const explorer=new oc.TopExp_Explorer(shape,oc.TopAbs_ShapeEnum.TopAbs_FACE),current=explorer.Current(),face=own(oc.TopoDS.Face(current));current.delete();explorer.delete();
 check('typed subshape survives explorer and returned wrapper destruction',valid(face));
 const list=new oc.NCollection_List_TopoDS_Shape();list.Append(shape);const fromList=own(list.First());list.delete();
 check('copied list result survives container destruction',valid(fromList)&&Math.abs(volume(fromList)-6000)<1e-7);
 const points=[new oc.gp_Pnt(1,0,0),new oc.gp_Pnt(Math.SQRT1_2,Math.SQRT1_2,0),new oc.gp_Pnt(0,1,0)];
 const arcBuilder=new oc.GC_MakeArcOfCircle(...points),curve=arcBuilder.Value();arcBuilder.delete();points.forEach(p=>p.delete());
 const edgeBuilder=new oc.BRepBuilderAPI_MakeEdge(curve),edge=own(edgeBuilder.Edge());edgeBuilder.delete();curve.delete();
 check('edge retains reference-counted curve after builders and curve handle destruction',valid(edge));
 const origin=new oc.gp_Pnt(3,3,-1),toolBuilder=new oc.BRepPrimAPI_MakeBox(origin,4,4,40),tool=own(toolBuilder.Shape());origin.delete();toolBuilder.delete();
 const cutBuilder=new oc.BRepAlgoAPI_Cut(shape,tool),cut=own(cutBuilder.Shape());cutBuilder.delete();
 check('boolean result survives builder destruction',valid(cut)&&Math.abs(volume(cut)-5520)<1e-7,{volumeMm3:volume(cut)});
 check('named inputs remain usable after boolean result creation',valid(shape)&&valid(tool)&&Math.abs(volume(shape)-6000)<1e-7);
 report.passed=true;
}catch(error){report.error=String(error);}
finally{for(const h of keep.reverse()){try{h.delete();}catch(error){report.cleanupError=String(error);report.passed=false;}}}
report.finalWasmBytes=oc.wasmMemory.buffer.byteLength;writeFileSync(resolve(outputPath),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
