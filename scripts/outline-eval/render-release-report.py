"""Build a portable release report from completed original-photo UI captures.

Usage: python3 render-release-report.py EVIDENCE_DIR REPO_ROOT
Pillow is used only to crop/rotate/resample presentation images after capture.
Detection always starts with the untouched original through the application UI.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import hashlib, html, json, math, statistics, sys, subprocess

root, repo = map(Path, sys.argv[1:3])
out = repo / 'client/public/reports/outline-1.9-to-1.10'
out.mkdir(parents=True, exist_ok=True)
plan = json.loads((out/'capture-plan.json').read_text())
for case in plan: case['referenceFile'] = case['sourceFile']
reviews = json.loads((out/'review.json').read_text())
assert len(plan) == 36 and len({c['name'] for c in plan}) == 36
try:
    font = ImageFont.truetype('DejaVuSans.ttf', 22)
except OSError:
    font = ImageFont.load_default(size=22)
rows = []
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
for case in plan:
    name = case['name']
    captures = [json.loads((root/v/(name+'.json')).read_text()) for v in ['v1.9','v1.10']]
    a, b = captures
    assert all(d['status'] == 'complete' and d['observation']['detectionComplete'] for d in captures), name
    assert a['sourceSha256'] == b['sourceSha256'] == case['sha256'], name
    apps = [d['observation']['app'] for d in captures]
    assert apps[0]['region'] == apps[1]['region'], name
    assert apps[0]['calibration'] == apps[1]['calibration'], name
    assert apps[0]['imageSize'] == apps[1]['imageSize'], name
    images = [root/v/(name+'.working.png') for v in ['v1.9','v1.10']]
    assert sha(images[0]) == sha(images[1]), name
    review = reviews[name]
    region = apps[0]['region']
    crop = (math.floor(region['x']-10), math.floor(region['y']-10), math.ceil(region['x']+region['width']+10), math.ceil(region['y']+region['height']+10))
    photo = Image.open(images[0]).convert('RGB').crop(crop)
    original_width = photo.width
    rotate = photo.height > photo.width * 1.5
    if rotate: photo = photo.transpose(Image.Transpose.ROTATE_90)
    photo.save(out/(name+'.jpg'), quality=90, optimize=True)
    def transform(p):
        x,y = p['x']-crop[0],p['y']-crop[1]
        return [y,original_width-x] if rotate else [x,y]
    versions = []
    panels = []
    for d, app, color in zip(captures, apps, ['#bd286a','#007e77']):
        outline = app['outline']
        assert outline and d['observation']['renderedPaths'], name
        rings = [[transform(p) for p in ring] for s in outline for ring in [s['outer']]+s['holes']]
        points = sum(len(ring) for s in outline for ring in [s['outer']]+s['holes'])
        settings = {k:app.get(k) for k in ['boundaryMethod','sensitivity','includeInteriorHoles','editableCurves','tolerancePx','smoothing','margin']}
        if d['version']=='1.9.0': settings['boundaryMethod']='color (only method in 1.9)'
        full_commit=subprocess.check_output(['git','rev-parse',d['commit']],cwd=repo,text=True).strip()
        assert json.loads(subprocess.check_output(['git','show',full_commit+':package.json'],cwd=repo,text=True))['version']==d['version']
        versions.append({'version':d['version'],'commit':full_commit,'shapes':len(outline),'points':points,'holes':sum(len(s['holes']) for s in outline),'outline':outline,'displayRings':rings,'settings':settings,'actions':d['actions'],'workerOptions':d['observation']['detect']['options'] if d['observation']['detect'] else None})
        scale=min(2,1280/max(photo.size))
        im=photo.resize((round(photo.width*scale),round(photo.height*scale)),Image.Resampling.LANCZOS)
        draw=ImageDraw.Draw(im)
        for ring in rings:
            pts=[(x*scale,y*scale) for x,y in ring]
            draw.line(pts+[pts[0]], fill=color, width=2)
        panel=Image.new('RGB',(im.width,max(42,im.height)+48),'white')
        panel.paste(im,(0,48))
        ImageDraw.Draw(panel).text((10,12),f"{d['version']}  |  {len(outline)} outline{'s' if len(outline)!=1 else ''}  |  {points} points",font=font,fill=color)
        panels.append(panel)
    # Side-by-side for compact/square shapes, stacked for long tools.
    if photo.width/photo.height < 1.5:
        display=Image.new('RGB',(panels[0].width*2+16,max(i.height for i in panels)), '#e8edf0')
        display.paste(panels[0],(0,0));display.paste(panels[1],(panels[0].width+16,0))
    else:
        display=Image.new('RGB',(panels[0].width,sum(i.height for i in panels)+12), '#e8edf0')
        display.paste(panels[0],(0,0));display.paste(panels[1],(0,panels[0].height+12))
    display.save(out/(name+'.webp'),quality=92,method=6)
    rows.append({'id':name,'number':case['subject'],'title':case['title'],'referenceFile':case['referenceFile'],'loadedIdenticalSourceFile':a['sourceFile'],'sourceSha256':case['sha256'],'workingPhotoSha256':sha(images[0]),'imageSize':apps[0]['imageSize'],'region':region,'calibration':apps[0]['calibration'],'width':photo.width,'height':photo.height,'displayCrop':crop,'displayRotationDegrees':90 if rotate else 0,'assessment':review['assessment'],'note':review['note'],'versions':versions})
summary = {'cases':len(rows),'uniquePhotos':len({r['sourceSha256'] for r in rows}), 'versions':[]}
for index in [0,1]:
    vs=[r['versions'][index] for r in rows]
    summary['versions'].append({'version':vs[0]['version'],'singleOutlineCases':sum(v['shapes']==1 for v in vs),'multipleOutlineCases':sum(v['shapes']>1 for v in vs),'totalOutlines':sum(v['shapes'] for v in vs),'totalPoints':sum(v['points'] for v in vs),'medianPoints':statistics.median(v['points'] for v in vs)})
data={'capturedDate':'2026-11-15','browser':captures[0]['userAgent'],'viewport':captures[0]['viewport'],'summary':summary,'cases':rows}
(out/'data.json').write_text(json.dumps(data,separators=(',',':'))+'\n')
(root/'report-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
template=(repo/'scripts/outline-eval/release-report.html').read_text()
(out/'index.html').write_text(template.replace('__REPORT_DATA__',json.dumps(data,separators=(',',':')).replace('<','\\u003c')))
# A repository-native gallery works directly on GitHub.
table=['| # | Reference | Visual assessment | Outlines, 1.9 → 1.10 | Points, 1.9 → 1.10 |','| ---: | --- | --- | ---: | ---: |']
gallery=[]
for r in rows:
    a,b=r['versions']
    table.append(f"| {r['number']} | [{r['title']}](#{r['id']}) | {r['assessment']} | {a['shapes']} → {b['shapes']} | {a['points']} → {b['points']} |")
    gallery += [f'<a id="{r["id"]}"></a>',f'### {r["number"]:02d}. {r["title"]}','',r['note'],'',f'![1.9 and 1.10 outlines for {r["title"]}](../client/public/reports/outline-1.9-to-1.10/{r["id"]}.webp)','']
metrics=['| Recorded output | 1.9.0 | 1.10.0 |','| --- | ---: | ---: |']
for key,label in [('singleOutlineCases','Cases with one outline'),('multipleOutlineCases','Cases with multiple outlines'),('totalOutlines','Total separate outlines'),('totalPoints','Total stored points'),('medianPoints','Median points per case')]:
    metrics.append(f"| {label} | {summary['versions'][0][key]:g} | {summary['versions'][1][key]:g} |")
markdown=(repo/'scripts/outline-eval/release-report.md').read_text().replace('__SUMMARY__','\n'.join(metrics)).replace('__TABLE__','\n'.join(table)).replace('__GALLERY__','\n'.join(gallery))
(repo/'docs/outline-detection-1.9-to-1.10.md').write_text(markdown.rstrip()+'\n')
print(json.dumps(summary,indent=2))
