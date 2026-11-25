"""Assemble continuous UI recordings; retain source and independently replaceable chapters."""
from pathlib import Path
import json,subprocess,re,math,hashlib
ROOT=Path('/private/tmp/pocketry-tutorial-revision-20260915'); TAKE=ROOT/'final-take'; DEST=ROOT/'deliverables'; SEG=DEST/'recording/segments'; SEG.mkdir(parents=True,exist_ok=True)
FF='/private/tmp/pocketry-headless-tutorial-20260915/encoder/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1'; RAW=TAKE/'continuous-original.webm'; FONT='/System/Library/Fonts/Supplemental/Arial.ttf'
marks=json.loads((TAKE/'marks.json').read_text()); sections=[m for m in marks if m['type']=='section']; end=next(m['time'] for m in marks if m['type']=='end');caps=[m for m in marks if m['type']=='caption']
base={'00':1,'01':1,'02':1.5,'03':1.5,'04':1.5,'05':1.8,'06':1.7,'07':1.25,'08':1,'09':1,'10':1.8,'11':1,'12':1,'13':1}
refines=[]
for i,c in enumerate(caps):
 if c['text'].startswith(('Right-click to remove','Drag points to refine','Click an edge to add')):refines.append((c['time'],caps[i+1]['time'] if i+1<len(caps) else end))
protected=[(m['time']-3,m['time']+.3) for m in marks if m['type']=='measurement']
pieces=[]
for i,sec in enumerate(sections):
 a=sec['time'];b=sections[i+1]['time'] if i+1<len(sections) else end
 cuts=sorted({a,b,*[max(a,min(b,t)) for span in refines+protected for t in span]})
 for x,y in zip(cuts,cuts[1:]):
  if y-x<.01:continue
  mid=(x+y)/2;s=base[sec['id']]
  if any(lo<=mid<=hi for lo,hi in refines):s=2.0
  protect=any(lo<=mid<=hi for lo,hi in protected) or sec['id'] in ['00','01','08','09','11','12','13']
  if protect:s=1
  pieces.append({'id':sec['id'],'start':x,'end':y,'speed':s,'protected':protect})
# Keep important readings and outcome checks at normal speed. Compress repetitive work only.
for _ in range(120):
 duration=sum((p['end']-p['start'])/p['speed'] for p in pieces)
 if duration<=588:break
 for p in pieces:
  if not p['protected']:p['speed']=min(3.0,p['speed']*1.025)
else:raise RuntimeError('Workflow needs an editorial cut to meet ten minutes')
for p in pieces:p['speed']=round(p['speed'],2)
def outtime(t):return sum(max(0,min(t,p['end'])-p['start'])/p['speed'] for p in pieces if t>p['start'])
def fmt(t,ms=False):
 n=round(t*1000) if ms else round(t)
 if ms:return f'{n//3600000:02}:{n//60000%60:02}:{n//1000%60:02},{n%1000:03}'
 return f'{n//60:02}:{n%60:02}'
manifest=[]
for sec in sections:
 ps=[p for p in pieces if p['id']==sec['id']];start=ps[0]['start'];length=ps[-1]['end']-start
 slug=re.sub('[^a-z0-9]+','-',sec['title'].lower()).strip('-');out=SEG/(sec['id']+'-'+slug+'.mp4')
 filters=[];n=len(ps)
 if n>1:filters.append('[0:v]split='+str(n)+''.join('[src'+str(i)+']' for i in range(n)))
 for i,p in enumerate(ps):
  source=f'[src{i}]' if n>1 else '[0:v]';f=f"{source}trim=start={p['start']-start:.6f}:end={p['end']-start:.6f},setpts=(PTS-STARTPTS)/{p['speed']}"
  if p['speed']!=1:f+=f",drawtext=fontfile='{FONT}':text='{p['speed']:g}x speed':fontsize=19:fontcolor=white:box=1:boxcolor=0x101a2ccc:boxborderw=8:x=w-tw-18:y=54"
  filters.append(f+'[v'+str(i)+']')
 filters.append(''.join('[v'+str(i)+']' for i in range(n))+f'concat=n={n}:v=1:a=0,fps=30,format=yuv420p[out]')
 script=ROOT/('filter-'+sec['id']+'.txt');script.write_text(';\n'.join(filters))
 cmd=[FF,'-hide_banner','-loglevel','error','-y','-ss',str(start),'-t',str(length+.12),'-i',str(RAW),'-filter_complex_script',str(script),'-map','[out]','-an','-c:v','libx264','-preset','fast','-crf','21','-movflags','+faststart',str(out)]
 print('Encoding',sec['id'],sec['title'],flush=True);subprocess.run(cmd,check=True)
 manifest.append({**sec,'file':str(out.relative_to(DEST)),'sourceStart':start,'sourceEnd':ps[-1]['end'],'start':outtime(start),'end':outtime(ps[-1]['end']),'pieces':ps})
concat=ROOT/'concat.txt';concat.write_text('\n'.join("file '"+str(DEST/m['file'])+"'" for m in manifest)+'\n')
subprocess.run([FF,'-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(concat),'-c','copy','-an','-movflags','+faststart',str(DEST/'pocketry-air-duster-tutorial.mp4')],check=True)
(DEST/'chapters.txt').write_text('\n'.join(fmt(m['start'])+' '+m['title'] for m in manifest)+'\n')
srt=[]
for i,c in enumerate(caps):
 a=outtime(c['time']);b=outtime(caps[i+1]['time'] if i+1<len(caps) else end)
 if b-a<.1:continue
 srt.append(f"{len(srt)+1}\n{fmt(a,True)} --> {fmt(b,True)}\n{c['text']}\n")
(DEST/'pocketry-air-duster-tutorial.srt').write_text('\n'.join(srt))
report={'durationSeconds':outtime(end),'resolution':[1440,900],'outputFps':30,'sourceFps':25,'audioTracks':0,'chapters':manifest,'measurements':[{**m,'finalTime':outtime(m['time'])} for m in marks if m['type']=='measurement'],'captions':[{**m,'finalTime':outtime(m['time'])} for m in caps]}
(DEST/'timeline.json').write_text(json.dumps(report,indent=2)+'\n');print('FINISHED',outtime(end),flush=True)
