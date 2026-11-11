import { distanceToSegment } from "./rings";
import type { Outline, Point, Ring } from "./types";

interface Segment { a: Point; b: Point; minX: number; minY: number; maxX: number; maxY: number }
interface Node { minX: number; minY: number; maxX: number; maxY: number; segments?: Segment[]; left?: Node; right?: Node }

/** Small immutable BVH for distance and even/odd membership queries. */
function index(ring: Ring): Node {
  // Coalesce exact straight runs before indexing; otherwise a long straight
  // edge needs thousands of redundant distance certifications.
  const corners = ring.filter((p,i) => distanceToSegment(p,ring[(i+ring.length-1)%ring.length],ring[(i+1)%ring.length]) > 1e-10);
  if (corners.length >= 3) ring = corners;
  const segments = ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length];
    return { a, b, minX: Math.min(a.x,b.x), minY: Math.min(a.y,b.y), maxX: Math.max(a.x,b.x), maxY: Math.max(a.y,b.y) };
  });
  const build = (items: Segment[]): Node => {
    const node: Node = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const s of items) { node.minX=Math.min(node.minX,s.minX); node.minY=Math.min(node.minY,s.minY); node.maxX=Math.max(node.maxX,s.maxX); node.maxY=Math.max(node.maxY,s.maxY); }
    if (items.length<=8) node.segments=items;
    else {
      const x=node.maxX-node.minX>=node.maxY-node.minY;
      items.sort((a,b)=>x ? a.minX+a.maxX-b.minX-b.maxX : a.minY+a.maxY-b.minY-b.maxY);
      const half=items.length>>1; node.left=build(items.slice(0,half)); node.right=build(items.slice(half));
    }
    return node;
  };
  return build(segments);
}

function signedDistance(root: Node, p: Point): number {
  let distance=Infinity, crossings=0;
  const visitDistance=(node: Node): void=>{
    const dx=Math.max(node.minX-p.x,0,p.x-node.maxX), dy=Math.max(node.minY-p.y,0,p.y-node.maxY);
    if (Math.hypot(dx,dy)>=distance) return;
    if(node.segments) for(const s of node.segments) distance=Math.min(distance,distanceToSegment(p,s.a,s.b));
    else {
      const distanceToBox=(n:Node)=>Math.hypot(Math.max(n.minX-p.x,0,p.x-n.maxX),Math.max(n.minY-p.y,0,p.y-n.maxY));
      const [first,second]=distanceToBox(node.left!)<distanceToBox(node.right!)?[node.left!,node.right!]:[node.right!,node.left!];
      visitDistance(first);visitDistance(second);
    }
  };
  const visitRay=(node: Node): void=>{
    if(p.y<node.minY || p.y>=node.maxY || node.maxX<=p.x) return;
    if(node.segments) for(const {a,b} of node.segments) {
      if((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) crossings++;
    } else { visitRay(node.left!); visitRay(node.right!); }
  };
  visitDistance(root); visitRay(root);
  return crossings%2 ? -distance : distance;
}

/**
 * Certifies a one-sided distance bound on every segment, including between
 * vertices. Signed distance is 1-Lipschitz: endpoint distance + half segment
 * length bounds every point in that segment. Unresolved/budgeted work rejects
 * the candidate rather than silently accepting an unsampled tip or slit.
 */
function bounded(ring: Ring, target: Node, direction: 1 | -1, allowance: number, budget: () => boolean): boolean {
  const value=(p:Point)=>direction*signedDistance(target,p);
  const onSameEdge=(node:Node,a:Point,b:Point):boolean=>{
    if(Math.min(a.x,b.x)<node.minX-1e-9 || Math.max(a.x,b.x)>node.maxX+1e-9 ||
      Math.min(a.y,b.y)<node.minY-1e-9 || Math.max(a.y,b.y)>node.maxY+1e-9) return false;
    return node.segments ? node.segments.some(s=>distanceToSegment(a,s.a,s.b)<1e-9&&distanceToSegment(b,s.a,s.b)<1e-9)
      : onSameEdge(node.left!,a,b)||onSameEdge(node.right!,a,b);
  };
  const interval=(a:Point,b:Point,da:number,db:number,depth:number):boolean=>{
    if(!budget() || da>allowance+1e-9 || db>allowance+1e-9) return false;
    if(Math.abs(da)<1e-9 && Math.abs(db)<1e-9 && onSameEdge(target,a,b)) return true;
    const length=Math.hypot(a.x-b.x,a.y-b.y);
    if(Math.max(da,db)+length/2<=allowance+1e-9) return true;
    if(depth>=24) return false;
    const middle={x:(a.x+b.x)/2,y:(a.y+b.y)/2}, dm=value(middle);
    return interval(a,middle,da,dm,depth+1)&&interval(middle,b,dm,db,depth+1);
  };
  const distances=ring.map(value);
  return ring.every((a,i)=>interval(a,ring[(i+1)%ring.length],distances[i],distances[(i+1)%ring.length],0));
}

/** Material may grow, but neither a missing tip nor a new cut-in may exceed the allowance. */
export function preservesMaterial(reference: Outline, candidate: Outline, allowance: number): boolean {
  if(!Number.isFinite(allowance) || allowance<=0 || reference.length!==candidate.length) return false;
  let remaining=100_000;
  const budget=()=>--remaining>=0;
  for(let s=0;s<reference.length;s++) {
    const before=reference[s], after=candidate[s];
    if(before.holes.length!==after.holes.length) return false;
    for(let h=-1;h<before.holes.length;h++) {
      const a=h<0?before.outer:before.holes[h], b=h<0?after.outer:after.holes[h];
      if(a.length<3 || b.length<3) return false;
      if(a===b) continue;
      const direction=h<0?1:-1;
      if(!bounded(a,index(b),direction,allowance,budget) || !bounded(b,index(a),-direction as 1|-1,allowance,budget)) return false;
    }
  }
  return true;
}
