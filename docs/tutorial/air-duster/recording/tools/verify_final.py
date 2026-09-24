"""Check the actual downloaded tutorial project and printable files."""
import json,glob,math,os,struct,zipfile,hashlib,collections,xml.etree.ElementTree as ET
from pathlib import Path
root=Path('/private/tmp/pocketry-tutorial-revision-20260915'); take=root/'final-take';repo=Path('/Users/willcobb/Code.local/pocketry');dest=repo/'docs/tutorial/air-duster'
files=sorted(take.glob('*multicolor*.pocketry.json'),key=os.path.getmtime)
if files:p=json.loads(files[-1].read_text())
else:
 values=json.loads((take/'checkpoint-08-corrected-contours.json').read_text());p=next(x for x in values if isinstance(x,dict) and 'spec' in x)
ref=json.loads((dest/'reference/Airduster-Tutorial.pocketry.json').read_text())
def shape(doc,c):return next(s for s in doc['shapes'] if s['id']==c['shapeId'])
def ring(doc,c):return [{'x':q['x']*c['scaleX'],'y':q['y']*c['scaleY']} for q in shape(doc,c)['outlineMm'][0]['outer']]
def samples(ps):
 for a,b in zip(ps,ps[1:]+ps[:1]):
  n=max(1,math.ceil(math.hypot(b['x']-a['x'],b['y']-a['y'])/.25))
  for j in range(n):yield (a['x']+(b['x']-a['x'])*j/n,a['y']+(b['y']-a['y'])*j/n)
def dist(q,ps):
 out=[]
 for a,b in zip(ps,ps[1:]+ps[:1]):
  vx=b['x']-a['x'];vy=b['y']-a['y'];ll=vx*vx+vy*vy;t=max(0,min(1,((q[0]-a['x'])*vx+(q[1]-a['y'])*vy)/ll)) if ll else 0
  out.append(math.hypot(q[0]-a['x']-t*vx,q[1]-a['y']-t*vy))
 return min(out)
expected={'Air Duster':(87.83,145.57),'Adapters':(36.74,113.32),'Angled Nozzle':(45.43,52.75),'USB Cable':(17.44,103.59)}
assert len(p['cutouts'])==3
assert len(p['fingerHoles'])==3
cable=next(h for h in p['fingerHoles'] if h.get('name')=='USB Cable')
assert abs(cable['diameterMm']-17.44)<.001 and abs(cable['lengthMm']-103.59)<.001
assert abs(cable['depthMm']-37.3)<.001
pockets=[]
for c in p['cutouts']:
 s=shape(p,c);r=next(x for x in ref['cutouts'] if shape(ref,x)['name']==s['name']);a=ring(p,c);b=ring(ref,r);ds=sorted([dist(q,b) for q in samples(a)]+[dist(q,a) for q in samples(b)]);w=max(q['x'] for q in a)-min(q['x'] for q in a);l=max(q['y'] for q in a)-min(q['y'] for q in a)
 assert abs(w-expected[s['name']][0])<.005 and abs(l-expected[s['name']][1])<.005
 assert c['clearanceMm']==0
 assert max(ds)<.15, (s['name'],max(ds))
 pockets.append({'name':s['name'],'widthMm':w,'lengthMm':l,'position':c['position'],'rotationDeg':c['rotationDeg'],'depth':c['depth'],'clearanceMm':c['clearanceMm'],'pointCount':s['pointCount'],'boundaryMaxMm':max(ds),'boundaryP95Mm':ds[int(len(ds)*.95)]})
report={'appCommit':'3b72a380b6d24e0213194b34138f4e359fcf48b1','projectName':'Air Duster Tutorial','reference':'reference/Airduster-Tutorial.pocketry.json','boundaryMethod':'Symmetric distance from final unrotated scaled outline boundaries to the supplied editable reference; samples at most 0.25 mm apart. Excludes rounding, clearance, and finger holes. This is geometric comparison, not physical fit validation.','pockets':pockets,'spec':p['spec'],'fingerHoles':p['fingerHoles'],'exports':[]}
for f in sorted(take.glob('*.stl'))+sorted(take.glob('*.3mf')):
 raw=f.read_bytes();item={'filename':f.name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
 if f.suffix=='.stl':
  count=struct.unpack_from('<I',raw,80)[0];assert len(raw)==84+count*50;lo=[1e9]*3;hi=[-1e9]*3
  for i in range(count):
   v=struct.unpack_from('<9f',raw,96+i*50)
   for j in range(9):lo[j%3]=min(lo[j%3],v[j]);hi[j%3]=max(hi[j%3],v[j])
  item.update(triangles=count,boundsMm=[lo,hi],thicknessMm=hi[2]-lo[2]);assert abs(hi[2]-lo[2]-1.2)<1e-5
 else:
  with zipfile.ZipFile(f) as z:
   assert z.testzip() is None;m=ET.fromstring(z.read('3D/3dmodel.model'));ns={'m':'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'};assert m.attrib['unit']=='millimeter';objs=[]
   for o in m.findall('.//m:object',ns):
    verts=[tuple(float(v.attrib[k]) for k in ['x','y','z']) for v in o.findall('.//m:vertex',ns)];tris=[tuple(int(t.attrib[k]) for k in ['v1','v2','v3']) for t in o.findall('.//m:triangle',ns)];info={'name':o.attrib.get('name'),'vertices':len(verts),'triangles':len(tris)}
    if tris:
     assert all(0<=x<len(verts) for t in tris for x in t);edges=collections.Counter(tuple(sorted(e)) for a,b,c in tris for e in [(a,b),(b,c),(c,a)]);info['edgesUsedOtherThanTwice']=sum(n!=2 for n in edges.values());info['boundsMm']=[[min(v[j] for v in verts) for j in range(3)],[max(v[j] for v in verts) for j in range(3)]];assert info['edgesUsedOtherThanTwice']==0
    objs.append(info)
   item.update(unit='millimeter',objects=objs)
 report['exports'].append(item)
(root/'final-geometry-verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(pockets,indent=2));print('Verified exports',len(report['exports']))

# The same photographed outlines remain active; no later contour replacement occurred.
checkpoints=[]
for f in take.glob('checkpoint-*.json'):
 values=json.loads(f.read_text());docs=[d for d in values if isinstance(d,dict) and 'spec' in d]
 if docs and len(docs[0]['cutouts'])==3:
  d=docs[0];assert d['name']==p['name'];assert [(c['id'],c['shapeId']) for c in d['cutouts']]==[(c['id'],c['shapeId']) for c in p['cutouts']];checkpoints.append(f.name)
marks=json.loads((take/'marks.json').read_text());caps=[m['text'] for m in marks if m['type']=='caption'];assert not any('3mf' in t.lower() or 'supplied' in t.lower() for t in caps)
assert len([m for m in marks if m['type']=='measurement'])==3
assert any('calipers' in t.lower() and 'depth' in t.lower() for t in caps)
assert len(list(take.glob('*.stl')))==2
report['lineageCheckpoints']=checkpoints
report['workflow']={'photographedTools':3,'fingerAccessPockets':3,'usbCreatedUsingFingerAccess':True,'rulerMeasurements':3,'laterContourReplacements':0,'fitPhotoPlaceholder':True,'physicalFitVerified':False}
(root/'final-geometry-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print('Workflow and lineage verified',len(checkpoints))
