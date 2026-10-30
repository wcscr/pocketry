import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const [modulePath,wasmPath,outputPath]=process.argv.slice(2);
if(!modulePath||!wasmPath||!outputPath)throw new Error('Usage: node verify-destructors.mjs MODULE_JS WASM OUTPUT_JSON');
const {default:init}=await import(pathToFileURL(resolve(modulePath)));
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const bytes=readFileSync(resolve(wasmPath)),module=await WebAssembly.compile(bytes);let memory,table;
const names=new Set(['BRepCheck_Analyzer','gp_Pnt','BRepAlgoAPI_Cut','BRepAlgoAPI_Common','BRepAlgoAPI_Fuse','BRepAlgoAPI_Splitter','TopoDS_Shape','TopExp_Explorer','Bnd_Box','GProp_GProps','BRepBuilderAPI_MakeEdge','BRepBuilderAPI_MakeWire','BRepBuilderAPI_Transform','BRepPrimAPI_MakePrism','BRepOffsetAPI_MakeOffset','BRepFilletAPI_MakeFillet','STEPCAFControl_Writer']);
const records=[];
const ascii=p=>{if(!memory||!Number.isInteger(p)||p<1||p>=memory.buffer.byteLength)return '';const a=new Uint8Array(memory.buffer,p,Math.min(4096,memory.buffer.byteLength-p)),end=a.indexOf(0);if(end<0)throw new Error('Unterminated native registration name');return new TextDecoder().decode(a.subarray(0,end));};
await init({print:()=>{},printErr:()=>{},instantiateWasm(imports,success){
 for(const ns of Object.values(imports))for(const [key,fn] of Object.entries(ns))if(typeof fn==='function')ns[key]=(...args)=>{
  if(args.length===13){const name=ascii(args[10]);if(name)records.push({name,rawDestructorTableIndex:args[12]});}
  return fn(...args);
 };
 const instance=new WebAssembly.Instance(module,imports);memory=Object.values(instance.exports).find(v=>v instanceof WebAssembly.Memory);table=Object.values(instance.exports).find(v=>v instanceof WebAssembly.Table);success(instance,module);return instance.exports;
}});
let pos=8;const uleb=()=>{let value=0,shift=0,b;do{b=bytes[pos++];value|=(b&127)<<shift;shift+=7;}while(b&128);return value>>>0;};let bodies=[];
while(pos<bytes.length){const id=bytes[pos++],size=uleb(),end=pos+size;if(id===10){const n=uleb();for(let i=0;i<n;i++){const len=uleb();bodies.push(bytes.subarray(pos,pos+len));pos+=len;}}pos=end;}
const imported=WebAssembly.Module.imports(module).filter(i=>i.kind==='function').length;
for(const r of records){const fn=table.get(r.rawDestructorTableIndex);r.wasmFunctionName=fn.name;const index=Number(fn.name);if(!Number.isInteger(index)||!bodies[index-imported])throw new Error(`Cannot resolve native destructor code for ${r.name}`);if(Number.isInteger(index)){const body=bodies[index-imported];r.nativeCodeBytes=body?.length;r.bodyPrefixHex=body?.subarray(0,24).toString('hex');r.isEmptyFunction=body?.toString('hex')==='000b';r.isPocketryLifetimeRegression=names.has(r.name);}}
const report={wasmSha256:createHash('sha256').update(bytes).digest('hex'),importedFunctions:imported,records};writeFileSync(resolve(outputPath),JSON.stringify(report,null,2));console.log(JSON.stringify({wasmSha256:report.wasmSha256,classes:records.length,emptyDestructors:records.filter(r=>r.isEmptyFunction).length,regressions:records.filter(r=>r.isPocketryLifetimeRegression).map(r=>({name:r.name,isEmptyFunction:r.isEmptyFunction}))}));
