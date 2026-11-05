"""Validate measured mask/outline invariants and create a standalone visual report.
No external resources, network access, model inference or generative imagery.
"""
import argparse,base64,html,io,json,statistics
from pathlib import Path
from PIL import Image
import numpy as np

parser=argparse.ArgumentParser();parser.add_argument('input',type=Path);parser.add_argument('results',type=Path);parser.add_argument('output',type=Path);parser.add_argument('--notes',type=Path);args=parser.parse_args()
benchmark=json.loads((args.results/'benchmark.json').read_text());notes=json.loads(args.notes.read_text()) if args.notes else {}
cases=benchmark['cases'];cards=[];checks=[]
def category(c): return 'legacy' if '-mat-' in c['name'] else c['group']
cases=sorted(cases,key=lambda c: ['original','legacy','published'].index(category(c)))
counts={group:sum(category(c)==group for c in cases) for group in ['original','legacy','published']}
def stat(group,key): return statistics.median(c[key] for c in cases if category(c)==group)
for c in cases:
    result=json.loads((args.results/(c['name']+'.json')).read_text())
    before=np.fromfile(args.results/(c['name']+'-none.mask'),np.uint8)>0
    after=np.fromfile(args.results/(c['name']+'-grabcut.mask'),np.uint8)>0
    assert len(before)==len(after)==c['width']*c['height'], c['name']+' mask size'
    assert not np.any(after & ~before), c['name']+' unsupported growth'
    assert c['topology']['baseline']==c['topology']['refined'], c['name']+' topology'
    assert c['refinement']['iterations']<=2, c['name']+' iteration budget'
    if c['refinement']['status']!='accepted':
        assert np.array_equal(before,after) and c['identicalOutline'], c['name']+' fallback changed output'
    changed=int(np.count_nonzero(before!=after));checks.append(dict(name=c['name'],removedPixels=changed,removedFraction=changed/max(1,int(before.sum())),status=c['refinement']['status']))
    im=Image.open(args.input/(c['name']+'.png')).convert('RGB');buffer=io.BytesIO();im.save(buffer,format='JPEG',quality=90)
    uri='data:image/jpeg;base64,'+base64.b64encode(buffer.getvalue()).decode('ascii')
    panels=[]
    for key,label in [('baseline','Before · baseline'),('refined','After · guarded GrabCut')]:
        paths=[]
        for shape in result[key]:
            for ring in [shape['outer']]+shape['holes']:
                if ring:
                    path='M '+' L '.join(f"{p['x']:.3f} {p['y']:.3f}" for p in ring)+' Z'
                    paths.append(f'<path class="boundary" d="{path}"/>')
        panels.append(f'<figure><figcaption>{label}</figcaption><svg role="img" aria-label="{label}" viewBox="0 0 {c["width"]} {c["height"]}"><image href="{uri}" width="{c["width"]}" height="{c["height"]}"/>{"".join(paths)}</svg></figure>')
    note=notes.get(c['name'],{}).get('note','No full reference mask is available; inspect the photographed boundary.')
    verdict=notes.get(c['name'],{}).get('assessment','Unscored')
    group=category(c);ref=c['refinement'];status=ref['status'];title=c['name'].replace('-',' ')
    cards.append(f'''<article id="{c['name']}" data-group="{group}" data-status="{status}" data-name="{html.escape(title)}">
<h2>{html.escape(title)}</h2><p class="meta">{group} · {c['width']} × {c['height']} px · {status}: {html.escape(ref['reason'])}</p>
<div class="pair">{''.join(panels)}</div><p><strong>{html.escape(verdict)}.</strong> {html.escape(note)}</p>
<p class="cost">Warm median: {c['baselineMedianMs']:.1f} → {c['grabcutMedianMs']:.1f} ms · +{c['addedMedianMs']:.1f} ms · {c['ratio']:.2f}× · {changed:,} mask pixels removed</p>
<details><summary>Source and test details</summary><p>{html.escape(c['sourceFile'])}</p><p>SHA-256: <code>{c['sourceSha256']}</code></p><p>ROI in working frame: {html.escape(str(c['region']))}. Working frame: {c['workingSize']}. Seven alternating warm runs per method; same pixels, sensitivity and simplification. Cyan shows shells and holes; normal UI can hide holes.</p></details></article>''')
summary=[]
for group in ['original','legacy','published']:
    rows=[c for c in cases if category(c)==group]
    if rows:
        adds=sorted(c['addedMedianMs'] for c in rows)
        summary.append(dict(group=group,cases=len(rows),accepted=sum(c['refinement']['status']=='accepted' for c in rows),fallback=sum(c['refinement']['status']=='fallback' for c in rows),baselineMedianMs=stat(group,'baselineMedianMs'),refinedMedianMs=stat(group,'grabcutMedianMs'),addedMedianMs=stat(group,'addedMedianMs'),medianRatio=stat(group,'ratio'),p95AddedMs=float(np.percentile(adds,95)),maxAddedMs=max(adds)))
table=''.join(f'<tr><td>{r["group"]}</td><td>{r["cases"]}</td><td>{r["accepted"]} / {r["fallback"]}</td><td>{r["baselineMedianMs"]:.1f} → {r["refinedMedianMs"]:.1f} ms</td><td>+{r["addedMedianMs"]:.1f} ms</td><td>{r["medianRatio"]:.2f}×</td></tr>' for r in summary)
page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pocketry · GrabCut library comparison</title>
<style>body{margin:0;background:#f3f5f8;color:#142033;font:16px/1.55 system-ui,sans-serif}main{max-width:1260px;margin:auto;padding:30px}h1{font-size:36px;line-height:1.15}h2{font-size:22px;margin:0}header,article{background:white;border:1px solid #d5dce5;border-radius:12px;padding:24px;margin-bottom:24px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}figure{margin:0;background:#edf0f4}figcaption{font-weight:650;padding:10px 14px}svg{display:block;width:100%;height:500px}.boundary{fill:none;stroke:#00d6ff;stroke-width:1.25;vector-effect:non-scaling-stroke}.hide-outlines .boundary{display:none}.meta,.cost{color:#47566c}.toolbar{position:sticky;top:0;z-index:2;background:#e8edf4;padding:15px;display:flex;flex-wrap:wrap;gap:10px;border-radius:8px;margin-bottom:24px}select,input,button{font:inherit;padding:7px 10px;border:1px solid #a8b4c4;border-radius:5px}input{min-width:180px;flex:1}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}td,th{text-align:left;padding:10px;border-bottom:1px solid #d5dce5}code{overflow-wrap:anywhere}details{font-size:14px}article[hidden]{display:none}@media(max-width:700px){main{padding:10px}header,article{padding:14px}.pair{gap:6px}svg{height:350px}h1{font-size:28px}table{font-size:12px}td,th{padding:5px}}@media print{.toolbar{display:none}article{break-inside:avoid}svg{height:400px}}</style><main><header>
<h1>Before and after GrabCut</h1><p>Pocketry example-library evaluation · 5 November 2026</p>
<p><strong>CASE_COUNT paired detections:</strong> PUBLISHED_COUNT published library photos, ORIGINAL_COUNT available tool-photo crops and LEGACY_COUNT older checkerboard-background photos. Each pair uses identical pixels and settings. The after panel includes the production fallback: rejected proposals show the original outline.</p>
<p>Visible gains are concentrated in shadow/noise cleanup, especially the close Gerber shot. Many accepted changes are small. Existing missed reflective shafts and false interior holes can remain. Acceptance and fewer pixels/vertices are not accuracy scores.</p>
<table><thead><tr><th>Set</th><th>Photos</th><th>Accepted / fallback</th><th>Median baseline → refined</th><th>Median extra time</th><th>Median slowdown</th></tr></thead><tbody>'''+table+'''</tbody></table>
<p>CPU/WASM, Node 22.22.2 on macOS arm64. Seven warm runs per method, alternating order. These are detector timings, not phone or browser benchmarks. The worker preserves responsiveness; it does not eliminate the added CPU time. Legacy backgrounds and print photos are stress cases; many do not expose a complete tool silhouette.</p>
<p>All CASE_COUNT cases passed checks for no foreground growth, unchanged shell/hole counts, bounded iterations and exact fallback output. A visual review is included per case. There are no full ground-truth masks, so no library-wide accuracy percentage is claimed. Separate original DeWalt/Klein tracing photographs were not located; their published photos are included. The mini-socket example uses a drawn rectangular recess.</p>
<p>Runtime initialization in three Node processes took 149–156 ms. WASM capacity stayed at 128 MiB; the maximum sampled whole-process RSS was 480 MiB, including the batch harness and retained results. This is not a measured incremental GrabCut peak or a phone memory result. The earlier application build comparison added 13.8 KB gzip across JavaScript assets; no model or new inference runtime ships. Report images are documentation, not application downloads.</p>
<p>This file is self-contained and makes no network requests. Hide outlines to inspect original image evidence. Pinch/browser zoom can enlarge the paired panels.</p></header>
<div class="toolbar"><input id="search" aria-label="Filter by name" placeholder="Filter by tool name"><select id="group" aria-label="Photo set"><option value="">All photo sets</option><option value="original">Tool photos</option><option value="legacy">Legacy checkerboard photos</option><option value="published">Published print photos</option></select><select id="status" aria-label="Refinement result"><option value="">All results</option><option value="accepted">Accepted</option><option value="fallback">Fallback</option></select><button id="toggle">Hide outlines</button><span id="count"></span></div>
'''+''.join(cards)+'''</main><script>
const search=document.getElementById('search'),group=document.getElementById('group'),status=document.getElementById('status');
function filter(){let shown=0;document.querySelectorAll('article').forEach(c=>{c.hidden=!(c.dataset.name.includes(search.value.toLowerCase())&&(!group.value||c.dataset.group===group.value)&&(!status.value||c.dataset.status===status.value));if(!c.hidden)shown++});document.getElementById('count').textContent=shown+(shown===1?' comparison':' comparisons')}
[search,group,status].forEach(c=>c.addEventListener('input',filter));document.getElementById('toggle').onclick=function(){const hidden=document.body.classList.toggle('hide-outlines');this.textContent=hidden?'Show outlines':'Hide outlines'};filter();</script></html>'''
for key,value in [('CASE_COUNT',len(cases)),('PUBLISHED_COUNT',counts['published']),('ORIGINAL_COUNT',counts['original']),('LEGACY_COUNT',counts['legacy'])]:
    page=page.replace(key,str(value))
args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(page)
(args.output.parent/'validation.json').write_text(json.dumps(dict(caseCount=len(cases),passed=True,checks=['mask-size','no-growth','shell-and-hole-topology','two-iteration-budget','exact-fallback'],summary=summary,cases=checks),indent=2)+'\n')
print(json.dumps(summary,indent=2));print('Report bytes',args.output.stat().st_size)
