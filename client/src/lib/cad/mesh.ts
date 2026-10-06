import type { MeshData } from "@/lib/mesh/mesh-data";
import { CadContext, type CadShape } from "./adapter";

/** Stitch identical Float32 positions from shared CAD edges. No remeshing,
 * coordinate rounding, smoothing or geometry repair is performed here. */
export function stitchCadMesh(mesh:MeshData):MeshData {
  const positions:number[]=[],mapping=new Uint32Array(mesh.positions.length/3),vertices=new Map<string,number>();
  for(let i=0;i<mapping.length;i++){
    const p=mesh.positions.subarray(i*3,i*3+3),key=`${p[0]},${p[1]},${p[2]}`;
    let index=vertices.get(key);if(index===undefined){index=positions.length/3;vertices.set(key,index);positions.push(...p);}mapping[i]=index;
  }
  const triangles:number[]=[],edges=new Map<string,{count:number;direction:number}>();let volume=0;
  for(let i=0;i<mesh.indices.length;i+=3){
    const a=mapping[mesh.indices[i]],b=mapping[mesh.indices[i+1]],c=mapping[mesh.indices[i+2]];
    // A pole/seam can produce a triangle with identical Float32 vertices;
    // it covers zero area and contributes no boundary to the printable mesh.
    if(a===b||b===c||c===a)continue;
    const pa=positions.slice(a*3,a*3+3),pb=positions.slice(b*3,b*3+3),pc=positions.slice(c*3,c*3+3);
    const ux=pb[0]-pa[0],uy=pb[1]-pa[1],uz=pb[2]-pa[2],vx=pc[0]-pa[0],vy=pc[1]-pa[1],vz=pc[2]-pa[2];
    if(Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)===0)throw new Error("CAD tessellation contains a collapsed printable face");
    triangles.push(a,b,c);
    volume+=(pa[0]*(pb[1]*pc[2]-pb[2]*pc[1])+pa[1]*(pb[2]*pc[0]-pb[0]*pc[2])+pa[2]*(pb[0]*pc[1]-pb[1]*pc[0]))/6;
    for(const [u,v] of [[a,b],[b,c],[c,a]]){const key=u<v?`${u},${v}`:`${v},${u}`,edge=edges.get(key)??{count:0,direction:0};edge.count++;edge.direction+=u<v?1:-1;edges.set(key,edge);}
  }
  if([...edges.values()].some(e=>e.count!==2||e.direction!==0))throw new Error("CAD tessellation has an open or nonmanifold shared edge; no printable export was created");
  if(triangles.length&&volume<=0)throw new Error("CAD tessellation has inverted winding");
  return {positions:new Float32Array(positions),indices:new Uint32Array(triangles),normals:null};
}

export function tessellateCad(c:CadContext,shape:CadShape,printable:boolean,segments:number):MeshData {
  if(!c.subshapes(shape,"solid").length)return {positions:new Float32Array(),indices:new Uint32Array(),normals:printable?null:new Float32Array()};
  c.guard("CAD tessellation");
  const data=c.oc.ReplicadMeshExtractor.extract(shape,printable?0.02:0.12,Math.PI*2/Math.max(24,segments),printable);
  try{
    const heap=c.oc.wasmMemory.buffer;
    const mesh:MeshData={positions:new Float32Array(new Float32Array(heap,data.getVerticesPtr(),data.getVerticesSize())),
      indices:new Uint32Array(new Uint32Array(heap,data.getTrianglesPtr(),data.getTrianglesSize())),
      normals:printable?null:new Float32Array(new Float32Array(heap,data.getNormalsPtr(),data.getNormalsSize()))};
    c.guard("CAD tessellation");
    return printable?stitchCadMesh(mesh):mesh;
  }finally{data.delete();}
}
