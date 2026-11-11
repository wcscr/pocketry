import { distanceToSegment } from "@shared/geometry/rings";
import type { DetectionHint } from "@shared/geometry/detection-hints";
import { scoreFromEdgeMask } from "./edge-mask";
import type { ImageLike, ScoreField } from "./types";

/** Correction evidence retains source RGB separately from the automatic proposal. */
export interface RegionEvidence { proposal: Uint8Array; luminance: Uint8Array; labels: Int8Array; mutable: Uint8Array }

export function buildRegionEvidence(
  image: ImageLike, field: ScoreField, hints: readonly DetectionHint[] = [],
): RegionEvidence {
  const { width, height, scale, offsetX, offsetY } = field;
  const scaleY = field.scaleY ?? scale, count = width * height;
  if (count > 4_194_304 || hints.length > 100 || !(scale > 0) || !(scaleY > 0)) {
    throw new Error("Detection correction is too large");
  }
  const proposal = Uint8Array.from(field.score, v => v >= field.iso ? 1 : 0);
  const luminance = new Uint8Array(count);
  const labels = new Int8Array(count), mutable = new Uint8Array(count);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, p = { x: (x + .5) / scale + offsetX, y: (y + .5) / scaleY + offsetY };
    const ix = Math.max(0, Math.min(image.width - 1, Math.floor(p.x)));
    const iy = Math.max(0, Math.min(image.height - 1, Math.floor(p.y))), at = (iy * image.width + ix) * 4;
    luminance[i] = (image.data[at] * 77 + image.data[at + 1] * 150 + image.data[at + 2] * 29) >> 8;
  }
  // Rasterize only segment neighbourhoods, not every pixel against every mark.
  // A work budget also bounds imported or very long, overlapping scribbles.
  let remaining = 20_000_000;
  for (const hint of hints) {
    if (!Number.isFinite(hint.radius) || hint.radius <= 0 || hint.points.length < 1 || hint.points.length > 4096 ||
      hint.points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error("Invalid correction mark");
    // A sub-pixel stroke must still seed at least one model pixel.
    const radius = Math.max(hint.radius, .51 * Math.hypot(1 / scale, 1 / scaleY));
    const reach = Math.max((hint.kind === "tool" ? 32 : 8) / Math.min(scale, scaleY), radius * 8);
    const label = hint.kind === "tool" ? 1 : -1;
    for (let k = 0; k < Math.max(1, hint.points.length - 1); k++) {
      const a = hint.points[k], b = hint.points[Math.min(k + 1, hint.points.length - 1)];
      const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach - offsetX) * scale));
      const x1 = Math.min(width - 1, Math.ceil((Math.max(a.x, b.x) + reach - offsetX) * scale));
      const y0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - reach - offsetY) * scaleY));
      const y1 = Math.min(height - 1, Math.ceil((Math.max(a.y, b.y) + reach - offsetY) * scaleY));
      remaining -= Math.max(0, x1 - x0 + 1) * Math.max(0, y1 - y0 + 1);
      if (remaining < 0) throw new Error("Correction marks are too complex. Remove some marks or use a smaller region.");
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = y * width + x, p = { x: (x + .5) / scale + offsetX, y: (y + .5) / scaleY + offsetY };
        const distance = distanceToSegment(p, a, b);
        // Include strokes permit additions; exclude strokes permit removals.
        // Neither grants permission to change the opposite class elsewhere.
        if (distance <= reach && (hint.kind === "tool" ? !proposal[i] : proposal[i])) mutable[i] = 1;
        if (distance <= radius) {
          if (labels[i] && labels[i] !== label) throw new Error("Tool and paper marks overlap. Remove a mark and try again.");
          labels[i] = label;
        }
      }
    }
  }
  if (mutable.reduce((sum, v) => sum + v, 0) > 1_000_000) throw new Error("Correction covers too much of the image. Select a smaller region.");
  return { proposal, luminance, labels, mutable };
}

/** Binary min-heap; each popped entry settles a pixel in bounded local regions. */
class Heap {
  values:{pixel:number;cost:number;label:number}[]=[];
  push(value:{pixel:number;cost:number;label:number}) {
    const a=this.values;let i=a.length;a.push(value);
    while(i>0){const p=(i-1)>>1;if(a[p].cost<=value.cost)break;a[i]=a[p];i=p;}a[i]=value;
  }
  pop(){const a=this.values,first=a[0],last=a.pop()!;if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1].cost<a[c].cost)c++;if(a[c].cost>=last.cost)break;a[i]=a[c];i=c;}a[i]=last;}return first;}
}

/**
 * Local marker-controlled region solve. Unmarked pixels outside the correction
 * neighbourhood retain the proposal exactly. Within it, image contrast resists
 * propagation across boundaries; explicit tool/paper strokes are hard seeds.
 * This is an assisted solve, not a claim that contrast proves object identity.
 */
export function solveRegionEvidence(field:ScoreField,evidence:RegionEvidence):ScoreField {
  const {width,height}=field,{proposal,labels,mutable,luminance}=evidence;
  if(!labels.some(Boolean)) return field;
  const costs=new Float64Array(proposal.length).fill(Infinity),assigned=new Int8Array(proposal.length),queue=new Heap();
  for(let i=0;i<proposal.length;i++) if(labels[i]||!mutable[i]) {
    assigned[i]=labels[i]||(proposal[i]?1:-1);costs[i]=0;
    // Only the boundary of the mutable region needs to enter the heap.
    const x=i%width,y=(i/width)|0;
    if(labels[i]||(x&&mutable[i-1])||(x+1<width&&mutable[i+1])||(y&&mutable[i-width])||(y+1<height&&mutable[i+width])) queue.push({pixel:i,cost:0,label:assigned[i]});
  }
  while(queue.values.length) {
    const {pixel:i,cost,label}=queue.pop();if(cost!==costs[i]||assigned[i]!==label)continue;
    const x=i%width,y=(i/width)|0;
    for(const j of [x?i-1:-1,x+1<width?i+1:-1,y?i-width:-1,y+1<height?i+width:-1]) {
      if(j<0||!mutable[j]||labels[j])continue;
      const contrast=Math.abs(luminance[i]-luminance[j])/255;
      // Watershed cost follows the strongest appearance barrier on the path.
      // A tiny distance term resolves flat ties without favouring brush-shaped regions.
      const next=Math.max(cost,contrast)+.0001;
      if(next<costs[j]){costs[j]=next;assigned[j]=label;queue.push({pixel:j,cost:next,label});}
    }
  }
  const mask=Uint8Array.from(proposal,(value,i)=>mutable[i]&&assigned[i]?Number(assigned[i]>0):value);
  return {...field,score:scoreFromEdgeMask(mask,width,height),iso:128};
}

