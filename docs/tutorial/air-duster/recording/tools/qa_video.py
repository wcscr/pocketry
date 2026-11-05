from pathlib import Path
import json,subprocess,re,hashlib
from PIL import Image,ImageDraw,ImageFont
r=Path('/private/tmp/pocketry-tutorial-revision-20260915');d=Path('/private/tmp/pocketry-tutorial-revision-20260915/deliverables');ff='/private/tmp/pocketry-headless-tutorial-20260915/encoder/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1';video=d/'pocketry-air-duster-tutorial.mp4';timeline=json.loads((d/'timeline.json').read_text());qa=r/'final-video-qa';qa.mkdir(exist_ok=True)
result=subprocess.run([ff,'-hide_banner','-v','info','-i',str(video),'-progress','pipe:1','-an','-f','null','-'],capture_output=True,text=True,check=True);(qa/'decode.log').write_text(result.stderr);(qa/'progress.txt').write_text(result.stdout)
assert 'Audio:' not in result.stderr;assert '1440x900' in result.stderr and '30 fps' in result.stderr
frames=int(re.findall(r'^frame=(\d+)$',result.stdout,re.M)[-1]);duration=frames/30;assert duration<600
assert not re.search(r'\b(colour|colours|grey|centre|centres|neighbour\w*|millimetre\w*)\b',(d/'pocketry-air-duster-tutorial.srt').read_text(),re.I)
# Inspect an actual frame from every chapter, including final states and close-up edits.
items=[]
for sec in timeline['chapters']:
 t=min(sec['end']-.5,sec['start']+max(2,(sec['end']-sec['start'])*.45));items.append((sec['id']+' '+sec['title'],t,'chapter-'+sec['id']))
for m in timeline['measurements'][-3:]:items.append((m['reading'],m['finalTime']-.7,'measurement-'+m['name']))
for c in timeline['captions']:
 if c['text'].startswith(('The warning clears.','Cross-section View helps','Keep the editable project with')):items.append((c['text'],c['finalTime']+1,'detail-'+str(len(items))))
for label,t,name in items:
 subprocess.run([ff,'-hide_banner','-loglevel','error','-y','-ss',str(t),'-i',str(video),'-frames:v','1',str(qa/(name+'.png'))],check=True)
font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',18);cw,ch=480,330;sheet=Image.new('RGB',(cw*3,ch*((len(items)+2)//3)),'#e8ebf0');draw=ImageDraw.Draw(sheet)
for i,(label,t,name) in enumerate(items):
 im=Image.open(qa/(name+'.png'));im.thumbnail((480,300));x=i%3*cw;y=i//3*ch;sheet.paste(im,(x,y));draw.text((x+8,y+304),label[:52],font=font,fill='#17243a')
sheet.save(qa/'contact-sheet.jpg',quality=92)
# Short consecutive-frame samples confirm ongoing motion at native action moments.
for idx,prefix in enumerate(['Right-click to remove','Drag points to refine','Click an edge to add','Inspect the rounded']):
 c=next(c for c in timeline['captions'] if c['text'].startswith(prefix));t=c['finalTime']+2
 cmd=[ff,'-hide_banner','-loglevel','error','-ss',str(t),'-t','1.5','-i',str(video),'-vf','fps=6,scale=720:-1','-f','framemd5','-'];out=subprocess.check_output(cmd,text=True);hashes=[line.split(',')[-1].strip() for line in out.splitlines() if not line.startswith('#') and ',' in line];assert len(set(hashes))>=3,(prefix,hashes)
report={'durationSeconds':duration,'frames':frames,'resolution':[1440,900],'fps':30,'audioTracks':0,'fullDecode':'passed','americanEnglishCaptionScan':'passed','motionSamples':'4 intervals passed; at least 3 distinct frames per interval','chapterFramesReviewed':len(items),'sha256':hashlib.sha256(video.read_bytes()).hexdigest()};(r/'video-verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
