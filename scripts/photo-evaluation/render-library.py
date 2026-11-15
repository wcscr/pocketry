"""Render paired measured outlines for visual review; no generative edits."""
import argparse,json,math
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
parser=argparse.ArgumentParser();parser.add_argument('input',type=Path);parser.add_argument('results',type=Path);parser.add_argument('output',type=Path);args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
# Use Pillow's portable default font. Images, not typography, carry the evidence.
font=ImageFont.load_default(size=16)
benchmark=json.loads((args.results/'benchmark.json').read_text())
for group in ['original','published']:
 cases=[c for c in benchmark['cases'] if c['group']==group]
 for page in range(math.ceil(len(cases)/6)):
  canvas=Image.new('RGB',(1200,1110),'#f5f6f8');draw=ImageDraw.Draw(canvas)
  for i,c in enumerate(cases[page*6:page*6+6]):
   x=i%2*600;y=i//2*370
   result=json.loads((args.results/(c['name']+'.json')).read_text());base=Image.open(args.input/(c['name']+'.png')).convert('RGB')
   draw.text((x+5,y+4),c['name'],font=font,fill='black')
   draw.text((x+5,y+25),c['refinement']['status']+' / '+c['refinement']['reason'],font=font,fill='black')
   for side,key in enumerate(['baseline','refined']):
    img=base.copy();ink=ImageDraw.Draw(img)
    for shape in result[key]:
     for ring in [shape['outer']]+shape['holes']:
      points=[(p['x'],p['y']) for p in ring]
      if points:ink.line(points+[points[0]],fill=(0,230,255),width=1)
    img.thumbnail((290,295));xx=x+side*300;canvas.paste(img,(xx+5,y+70));draw.text((xx+5,y+48),'Baseline' if side==0 else 'GrabCut',font=font,fill='black')
  canvas.save(args.output/(group+'-'+str(page+1)+'.jpg'),quality=90)
