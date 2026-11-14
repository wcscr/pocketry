/** Re-evaluate unchanged white-sheet boundaries in both editing modes. No new
 * inference timing is implied: this measures cleanup/symmetry and state commits. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { curvesFromOutline, curveControls, evaluateCurve, mapCurves, sampleCurves, type CurveOutline } from "../shared/geometry/curves";
import { simplifyDetectedOutline } from "../shared/geometry/contour-simplification";
import { reconstructDetectedOutline } from "../shared/geometry/contour-reconstruction";
import { symmetrizeCurves } from "../client/src/lib/geometry/curve-symmetry";
import { suggestSymmetryAxis, symmetrizeShape, type SymmetrySide, type SymmetryAxis } from "../client/src/lib/geometry/symmetry";
import { initialTraceState, traceReducer, type TraceState } from "../client/src/state/trace-store";
import { mmPerPixel } from "../shared/geometry/scale";
import { rotateImageAlignment, transformImagePoint } from "../shared/geometry/image-alignment";
import { generateOutlineSVG } from "../client/src/lib/export/svg";
import { traceDraftSnapshot } from "../client/src/lib/trace-draft";
import { traceDraftSchema } from "../shared/trace-draft";

const input = resolve(process.argv[2]), output = resolve(process.argv[3]); mkdirSync(output, { recursive: true });
const manifest = JSON.parse(readFileSync(resolve(input, "summary.json"), "utf8"));
const median = (xs: number[]) => xs.slice().sort((a,b)=>a-b)[Math.floor(xs.length/2)];
const count = (curves: CurveOutline) => curves.reduce((n,s)=>n+s.outer.length+s.holes.reduce((n,r)=>n+r.length,0),0);
const cubics = (curves: CurveOutline) => curves.reduce((n,s)=>n+[s.outer,...s.holes].reduce((n,r)=>n+r.filter((a,i)=>a.out||r[(i+1)%r.length].in).length,0),0);
const outlineOf = (curves: CurveOutline) => curves.map(s=>({outer:s.outer.map(a=>a.point),holes:s.holes.map(r=>r.map(a=>a.point))}));
function verifyHistory(before: TraceState, after: TraceState) {
 assert.equal(after.history.index,before.history.index+1);assert.ok(Math.abs(mmPerPixel(after.calibration)!-mmPerPixel(before.calibration)!)<1e-10);
 const undo=traceReducer(after,{type:"UNDO"}),redo=traceReducer(undo,{type:"REDO"});
 for(const key of ["curves","outline","calibration","imageSize","imageAlignment","region"] as const){assert.deepEqual(undo[key],before[key]);assert.deepEqual(redo[key],after[key]);}
 const draft=traceDraftSchema.parse(traceDraftSnapshot(after)); const restored=traceReducer(after,{type:"TRACE_DRAFT_RESTORED",draft});
 assert.deepEqual(restored.curves,after.curves);assert.deepEqual(restored.calibration,after.calibration);
}
function symmetryResidual(curves: CurveOutline, axis: SymmetryAxis, index=0) {
 const ring=curves[index].outer,dx=axis.end.x-axis.start.x,dy=axis.end.y-axis.start.y,l=Math.hypot(dx,dy),nx=dy/l,ny=-dx/l;
 const reflect=(p:{x:number;y:number})=>{const d=(p.x-axis.start.x)*nx+(p.y-axis.start.y)*ny;return{x:p.x-2*d*nx,y:p.y-2*d*ny}};
 let error=0;
 for(let i=0;i<ring.length;i++){const wanted=curveControls(ring,i).slice().reverse().map(reflect);let best=Infinity;
  for(let j=0;j<ring.length;j++){const actual=curveControls(ring,j);best=Math.min(best,Math.max(...actual.map((p,k)=>Math.hypot(p.x-wanted[k].x,p.y-wanted[k].y))));}error=Math.max(error,best);}
 assert.ok(error<1e-6,"Native reflection mismatch "+error);return error;
}
const records: Record<string,unknown>[]=[];
for(const row of manifest.cases){
 const c=JSON.parse(readFileSync(resolve(input,row.name+".json"),"utf8")), imageUrl="data:image/png;base64,"+readFileSync(c.path.replace(/\.[^.]+$/, ".png")).toString("base64"), modes:Record<string,any>={}; // Evaluation JSON deliberately holds different result/error shapes.
 for(const mode of ["points","curves"] as const){
  const cleanupSamples:number[]=[];let cleaned:CurveOutline=curvesFromOutline(c.result.outline),cleanupError:string|undefined;
  for(let repeat=0;repeat<3;repeat++){const start=performance.now();try{cleaned=(mode==="points"?simplifyDetectedOutline:reconstructDetectedOutline)(curvesFromOutline(c.result.outline),c.reconstructionSource,c.fitTolerancePx).curves;}catch(error){cleanupError=String(error)}cleanupSamples.push(performance.now()-start)}
  // Synthetic 0.1 mm/input-px ruler checks invariance; it is NOT a tool measurement.
  let state=traceReducer({...initialTraceState,imageUrl:imageUrl,imageSize:{width:c.width,height:c.height},
   calibration:{startX:c.width*.1,startY:c.height*.1,endX:c.width*.9,endY:c.height*.1,lengthMm:c.width*.08},
   region:{x:0,y:0,width:c.width,height:c.height}}, {type:"DETECTED",imageUrl:imageUrl,outline:c.result.outline,rawOutline:c.reconstructionSource,svg:"",region:null});
  if(!cleanupError)state=traceReducer(state,mode==="curves"?{type:"CURVES_COMMITTED",curves:cleaned,label:"Auto-simplify outline"}:{type:"OUTLINE_COMMITTED",outline:outlineOf(cleaned),label:"Auto-simplify outline"});
  const source=state.curves??curvesFromOutline(state.outline),axis=suggestSymmetryAxis(state.outline[0].outer),radians=Math.atan2(axis.end.x-axis.start.x,axis.end.y-axis.start.y);
  let start=performance.now();const straight=traceReducer(state,{type:"ALIGN_UPRIGHT",outline:state.outline,expectedOutline:state.outline,radians,label:"Straighten photo"});const straightenMs=performance.now()-start;
  verifyHistory(state,straight);const transform=rotateImageAlignment(state.imageSize,radians,state.imageAlignment).transform;
  if(state.curves)assert.deepEqual(straight.curves,mapCurves(state.curves,p=>transformImagePoint(p,transform)));
  const sides:Record<string,any>={};
  for(const side of ["left","right","average"] as const){
   const samples:number[]=[];let candidate:CurveOutline|undefined,error:string|undefined;
   for(let repeat=0;repeat<3;repeat++){start=performance.now();try{if(state.curves)candidate=symmetrizeCurves({source:state.curves,shapeIndex:0,axis,side,tolerance:.25}).curves;
    else {const result=symmetrizeShape(state.outline[0],axis,side);if(!result.shape)throw Error(result.error);candidate=curvesFromOutline(state.outline.map((s,i)=>i===0?result.shape!:s));}}catch(cause){error=String(cause)}samples.push(performance.now()-start)}
   if(!candidate){sides[side]={error,samplesMs:samples,medianMs:median(samples),retained:true};continue;}
   for(const rotation of [undefined,radians]){const after=state.curves?traceReducer(state,{type:"CURVE_SYMMETRY_COMMITTED",curves:candidate,expectedCurves:state.curves,expectedOutline:state.outline,expectedCalibration:state.calibration,radians:rotation,label:"Symmetry"})
    :rotation===undefined?traceReducer(state,{type:"OUTLINE_COMMITTED",outline:outlineOf(candidate),label:"Symmetry"}):traceReducer(state,{type:"ALIGN_UPRIGHT",outline:outlineOf(candidate),expectedOutline:state.outline,radians:rotation,label:"Symmetry and straighten"});verifyHistory(state,after);}
   for(let i=1;i<source.length;i++)assert.deepEqual(candidate[i],source[i]);
   const residual=state.curves?symmetryResidual(candidate,axis):undefined;
   sides[side]={curves:candidate,samplesMs:samples,medianMs:median(samples),anchors:count(candidate),cubics:cubics(candidate),reflectionResidual:residual,calibrationUndoRecovery:true};
   writeFileSync(resolve(output,row.name+"-"+mode+"-"+side+".svg"),generateOutlineSVG(sampleCurves(candidate,.25),{width:c.width,height:c.height,curves:candidate}));
  }
  modes[mode]={source,cleanupError,cleanupSamplesMs:cleanupSamples,cleanupMedianMs:median(cleanupSamples),anchors:count(source),cubics:cubics(source),axis,radians,
   straighten:{ms:straightenMs,curves:straight.curves??curvesFromOutline(straight.outline),alignment:straight.imageAlignment,calibrationUndoRecovery:true},sides};
 }
 const result={name:row.name,width:c.width,height:c.height,modes};writeFileSync(resolve(output,row.name+".json"),JSON.stringify(result));
 records.push({name:row.name,modes:Object.fromEntries(Object.entries(modes).map(([mode,m]:[string,any])=>[mode,{cleanupError:m.cleanupError,cleanupSamplesMs:m.cleanupSamplesMs,cleanupMedianMs:m.cleanupMedianMs,anchors:m.anchors,cubics:m.cubics,straightenMs:m.straighten.ms,
  sides:Object.fromEntries(Object.entries(m.sides).map(([side,s]:[string,any])=>[side,{error:s.error,samplesMs:s.samplesMs,medianMs:s.medianMs,anchors:s.anchors,cubics:s.cubics,reflectionResidual:s.reflectionResidual,calibrationUndoRecovery:s.calibrationUndoRecovery}]))}]))});
 console.log(row.name,Object.entries(modes).map(([mode,m]:[string,any])=>mode+":"+m.anchors+" pts; "+Object.entries(m.sides).map(([side,s]:[string,any])=>side+" "+(s.error?"retained":s.anchors+"a/"+s.cubics+"C")).join(", ")).join(" | "));
}
writeFileSync(resolve(output,"summary.json"),JSON.stringify({node:process.version,scope:"27 unchanged white-sheet boundaries; three geometry-only passes. Suggested PCA axis, primary contour. Both editing modes; synthetic 0.1 mm/input-px ruler verifies scale/undo/recovery, not dimensions. No new inference/phone timing.",cases:records},null,2));
