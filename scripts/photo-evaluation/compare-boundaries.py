import json,sys,numpy as np
from pathlib import Path
p=Path(sys.argv[1])
# Manually read on original-image edge strips; approximately ±1.5 px ambiguity.
landmarks=[(100,67.5,244.5),(200,67,247),(300,79.5,235.5),(400,83.5,232.5),(500,76.5,241)]
meta=json.loads((p/'gerber.json').read_text());w,h=meta['width'],meta['height'];baseline=np.fromfile(p/'gerber-none.mask',np.uint8).reshape(h,w)>0;gc=np.fromfile(p/'gerber-grabcut.mask',np.uint8).reshape(h,w)>0
rows=[]
for y,left,right in landmarks:
 for side,reference in [('left',left),('right',right)]:
  coord=lambda m: (np.flatnonzero(m[y])[0] if side=='left' else np.flatnonzero(m[y])[-1]+1)
  b,g=coord(baseline),coord(gc);entry={'y':y,'side':side,'reference':reference,'baseline':int(b),'grabcut':int(g)}
  for size in [512,256]:
   edge=np.fromfile(p/f'gerber-teed{size}.f32',np.float32).reshape(h,w)
   # A local boundary-only proposal, not a free contour tracer. Search within
   # three source pixels of the accepted mask edge, excluding distant details.
   xx=np.arange(max(0,g-3),min(w,g+4));yy=np.arange(y-1,y+2)
   scores=edge[yy[:,None],xx].mean(0)
   entry[f'teed{size}']=int(xx[np.argmax(scores)])+0.5
  rows.append(entry)
report={'annotations':'One evaluator, original image, five horizontal cross-sections, ±1.5 px uncertainty; not a full ground-truth mask.','rows':rows,'meanAbsoluteErrorPx':{key:float(np.mean([abs(r[key]-r['reference']) for r in rows])) for key in ['baseline','grabcut','teed512','teed256']}}
print(json.dumps(report,indent=2));(p/'boundary-quality.json').write_text(json.dumps(report,indent=2))
