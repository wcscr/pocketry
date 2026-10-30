import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
const [modulePath,wasmPath,outputPath]=process.argv.slice(2);
if(!modulePath||!wasmPath||!outputPath)throw new Error('Usage: node verify-analyzer-lifetime.mjs MODULE_JS WASM OUTPUT_JSON');
const {default:init}=await import(pathToFileURL(resolve(modulePath)));
const oc=await init({locateFile:()=>resolve(wasmPath),print:()=>{},printErr:()=>{}});
const report={node:process.version,operations:5000,reuse:false,exact:true,initialWasmBytes:oc.wasmMemory.buffer.byteLength,samples:[],completed:0,validEveryCall:true,exactEveryCall:true};
const make=(x,y,z)=>{const builder=new oc.BRepPrimAPI_MakeBox(x,y,z);try{return builder.Shape();}finally{builder.delete();}};
let shapes=[];
try{
 shapes=[make(10,20,30),make(8,9,10)];
 for(let i=0;i<report.operations;i++){
  const analyzer=new oc.BRepCheck_Analyzer(shapes[i%2],true,false,true);
  try{report.validEveryCall&&=analyzer.IsValid();report.exactEveryCall&&=analyzer.IsExactMethod();}finally{analyzer.delete();}
  report.completed=i+1;
  if(i<5||i%500===499)report.samples.push({completed:i+1,wasmBytes:oc.wasmMemory.buffer.byteLength,rss:process.memoryUsage().rss});
  if(oc.wasmMemory.buffer.byteLength>=512*1024*1024)throw new Error('512 MiB test limit reached');
 }
}catch(error){report.error=String(error);}
finally{for(const shape of shapes)shape.delete();}
report.finalWasmBytes=oc.wasmMemory.buffer.byteLength;
report.passed=report.completed===report.operations&&report.validEveryCall&&report.exactEveryCall&&!report.error&&report.finalWasmBytes===report.initialWasmBytes;
writeFileSync(resolve(outputPath),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
