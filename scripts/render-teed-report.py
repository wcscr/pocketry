"""Offline photo comparison report. Pillow required; no images leave the device.
python scripts/render-teed-report.py RESULTS_DIR OUTPUT_HTML [BROWSER_JSON]
"""
import base64
import html
import io
import json
import shutil
import statistics
import sys
from pathlib import Path
from PIL import Image
root, destination = Path(sys.argv[1]), Path(sys.argv[2])
summary = json.loads((root/'summary.json').read_text())
browser = json.loads(Path(sys.argv[3]).read_text()) if len(sys.argv)>3 else {}
esc = html.escape

def xy(p): return f"{p['x']:.4f},{p['y']:.4f}"
def controls(a,b):
    p,q=a['point'],b['point']
    return [p,a.get('out',{k:(2*p[k]+q[k])/3 for k in p}),b.get('in',{k:(p[k]+2*q[k])/3 for k in p}),q]
def curve_path(r):
    result='M'+xy(r[0]['point'])
    for i,a in enumerate(r):
        b=r[(i+1)%len(r)];cs=controls(a,b)
        result+=('C'+' '.join(xy(p) for p in cs[1:])) if a.get('out') or b.get('in') else 'L'+xy(b['point'])
    return result+'Z'
def polygon(r): return 'M'+'L'.join(xy(p) for p in r)+'Z'
def sampled(r):
    ps=[]
    for i,a in enumerate(r):
        b=r[(i+1)%len(r)];cs=controls(a,b)
        for j in range(40 if a.get('out') or b.get('in') else 1):
            t=j/40;s=1-t
            ps.append({k:s**3*cs[0][k]+3*s*s*t*cs[1][k]+3*s*t*t*cs[2][k]+t**3*cs[3][k] for k in ['x','y']})
    return ps

def area(curves):
    total=0
    for s in curves:
        for index,r in enumerate([s['outer'],*s.get('holes',[])]):
            ps=sampled(r);a=abs(sum(p['x']*q['y']-q['x']*p['y'] for p,q in zip(ps,ps[1:]+ps[:1])))/2
            total+=a if index==0 else -a
    return total

def as_curves(outline): return [{'outer':[{'point':p} for p in s['outer']],'holes':[[{'point':p} for p in r] for r in s.get('holes',[])]} for s in outline]
def count(curves): return sum(len(s['outer'])+sum(len(r) for r in s.get('holes',[])) for s in curves)
def picture(c,data,kind='photo',crop=False):
    vb=f'0 0 {c["width"]} {c["height"]}'
    if crop: vb=f'0 {c["height"]*.68} {c["width"]} {c["height"]*.34}'
    result=f'<svg viewBox="{vb}" role="img" aria-label="{esc(kind)}"><image href="data:image/jpeg;base64,{data}" width="{c["width"]}" height="{c["height"]}"/>'
    if kind=='previous':
        for s in c['oldCurves']:
            for r in [s['outer'],*s.get('holes',[])]: result+=f'<path d="{curve_path(r)}" fill="none" stroke="#e51686" stroke-width="1.7" vector-effect="non-scaling-stroke"/>'
    elif kind=='mixed':
        for s in c['curves']:
            for r in [s['outer'],*s.get('holes',[])]:
                for i,a in enumerate(r):
                    b=r[(i+1)%len(r)];cs=controls(a,b);curved=bool(a.get('out') or b.get('in'))
                    path='M'+xy(cs[0])+('C'+' '.join(xy(p) for p in cs[1:]) if curved else 'L'+xy(cs[3]))
                    color='#00ae65' if curved else '#006ef5'
                    result+=f'<path d="{path}" fill="none" stroke="{color}" stroke-width="2" vector-effect="non-scaling-stroke"/>'
    elif kind in ['baseline','dense','polygon']:
        outline=c['baseline']['outline'] if kind=='baseline' else c.get('reconstructionSource',c['result']['rawOutline']) if kind=='dense' else c['result']['outline']
        color='#e51686' if kind=='baseline' else '#69778a'
        for s in outline: result+=f'<path d="{polygon(s["outer"])}" fill="none" stroke="{color}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>'
    return result+'</svg>'

def metric(values): return f'{statistics.median(values):.1f} <small>({min(values):.1f}–{max(values):.1f})</small>'
def notes(c):
    messages=[]
    if c['name'].startswith('wiha-150'): messages.append('Tight five-driver group: color fallback still misses shafts/contains printing. Fitting cannot recover missing segmentation; select each driver with paper around it.')
    elif c['result']['refinement']['status']=='fallback': messages.append('TEED enclosure rejected; the original color detection is retained. Expand the selection or review the source photo.')
    if c.get('fitError'): messages.append('Geometry reconstruction rejected by validation. The detected polygon is retained; no partial fit is applied.')
    if c['name']=='mouldline-distant': messages.append('The tiny bright hooked tip remains a segmentation limitation.')
    if c['name'].startswith('wire-strippers'): messages.append('Review the shadow spur below the left handle; bounded fitting preserves evidence outside its allowance rather than deleting it arbitrarily.')
    if c['name']=='caliper-original': messages.append('Low-resolution metal beam/jaw detail remains limited.')
    return ' '.join(messages) or 'Review against the photograph. Acceptance verifies software contracts, not physical dimensional accuracy.'

cards=[];table=[];records=[];focus=''
svg_directory=destination.parent/'reconstructed-svg'
svg_directory.mkdir(parents=True,exist_ok=True)
for row in summary['cases']:
    c=json.loads((root/(row['name']+'.json')).read_text())
    shutil.copyfile(root/(row['name']+'.svg'),svg_directory/(row['name']+'.svg'))
    c['oldCurves']=c.get('previousLearned',{}).get('curves') or as_curves(c['result']['outline'])
    photo=Image.open(Path(c['path']).with_suffix('.png')).convert('RGB');photo.thumbnail((650,650));buf=io.BytesIO();photo.save(buf,'JPEG',quality=88);data=base64.b64encode(buf.getvalue()).decode()
    result=c.get('reconstruction');samples=c['samples'];status='retained polygon' if c.get('fitError') else 'reconstructed'
    old_count=count(c['oldCurves']);new_count=count(c['curves']);old_area=area(c['oldCurves']);area_change=100*(area(c['curves'])/old_area-1) if old_area else 0
    before_case=c.get('previousLearned',{});total=[a+b for a,b in zip(samples['learnedMs'],samples['fitMs'])]
    browser_row=next((r for r in browser.get('corpus',{}).get('cases',[]) if r['name']==row['name']),None)
    record={**row,'previousAnchors':old_count,'areaChangePercentVsPreviousCurves':area_change,'notes':notes(c),'totalMs':total,'heapCapacityBytes':c['wasmHeapCapacityBytes']};records.append(record)
    primitives=f'{result["lines"]} L / {result["cubics"]} C' if result else '—'
    table.append(f'<tr><th><a href="#{c["name"]}">{esc(c["name"])}</a></th><td>{metric(samples["learnedMs"])}</td><td>{metric(samples["cachedMs"])}</td><td>{metric(samples["fitMs"])}</td><td>{metric(total)}</td><td>{c["fitTolerancePx"]:.3f}</td><td>{old_count} → {new_count}</td><td>{primitives}</td><td>{status}</td></tr>')
    panes=''.join('<figure><figcaption>'+title+'</figcaption>'+picture(c,data,key)+'</figure>' for title,key in [('Photo','photo'),('Before · fitting the coarse polygon','previous'),('After · lines (blue) / cubics (green)','mixed'),('Dense detected source','dense')])
    extra=''.join('<figure><figcaption>'+title+'</figcaption>'+picture(c,data,key)+'</figure>' for title,key in [('Color + guarded GrabCut','baseline'),('Detected simplified polygon','polygon')])
    line=f'{result["before"]} dense samples → {new_count} anchors · {primitives} · {result["smoothJoins"]} smooth joins · verified error ≤ {result["maxDeviation"]:.4f} input px' if result else 'Reconstruction rejected: '+esc(c.get('fitError',''))
    browser_text='' if not browser_row else '<p>Chrome worker measurements: '+esc(json.dumps(browser_row))+'</p>'
    cards.append(f'<article id="{c["name"]}"><h2>{esc(c["name"])}</h2><p>{line}</p><div class="panes">{panes}</div><p class="note">{esc(notes(c))}</p><p>Area change vs previous curve preview: {area_change:+.2f}%. This is a boundary-change diagnostic, not an accuracy score.</p>{browser_text}<p><a href="reconstructed-svg/{c["name"]}.svg">Unscaled native SVG preview</a> · pixel coordinates, no physical size is assigned.</p><details><summary>Color baseline and polygon comparison</summary><div class="pair">{extra}</div></details><details><summary>Timings and checks</summary><pre>{esc(json.dumps({"currentSamplesMs":samples,"previousFitSamplesMs":before_case.get("samples",{}).get("fitMs"),"previousFitTolerancePx":before_case.get("fitTolerancePx"),"fitTolerancePx":c["fitTolerancePx"],"fitReference":c.get("fitReference"),"reconstruction":result,"detection":c["result"]["refinement"],"fitError":c.get("fitError"),"capDiagnostics":row.get("capDiagnostics")},indent=2))}</pre></details></article>')
    if c['name']=='airduster-body':
        focus='<section class="summary" id="wolfbox-curves"><h2>Wolfbox handle: true curves around the bottom</h2><p>'+line+'</p><div class="triple">'+''.join('<figure><figcaption>'+title+'</figcaption>'+picture(c,data,key,crop)+'</figure>' for title,key,crop in [('Previous polygon-based fit','previous',False),('New line-and-curve reconstruction','mixed',False),('Rounded bottom · native cubic spans','mixed',True)])+'</div><p>Green edges are actual cubic Bézier segments in the editable source and native SVG, not merely a smoothed display polygon. The same fitting rules apply to all photos. Photo-specific cap checks are evaluation landmarks only.</p></section>'

median=lambda k:statistics.median(statistics.median(r['samples'][k]) for r in records)
accepted=sum(r['status']['status']=='accepted' for r in records);fitted=sum(not r.get('fitError') for r in records);heap=max(r['heapCapacityBytes'] for r in records)/2**20
total=statistics.median(statistics.median(r['totalMs']) for r in records)
ui_panes=[]
for filename,title in [('outline-controls.png','Direct action in Outline settings'),('simplify-controls.png','Detail presets and an explicit preview'),('outline-editor-phone.png','Visible point selection · 390 px viewport')]:
    path=destination.parent/filename
    if path.exists():
        encoded=base64.b64encode(path.read_bytes()).decode()
        ui_panes.append(f'<figure><figcaption>{esc(title)}</figcaption><img alt="{esc(title)}" src="data:image/png;base64,{encoded}" style="width:100%;height:490px;object-fit:contain"/></figure>')
ui_section='<section class="summary" id="outline-controls"><h2>Updated outline controls</h2><p>Choose Color contrast or Tool edges to find the boundary, then use <b>Auto-simplify outline</b> directly. Detail presets and Show original outline make the preview reviewable. Advanced allowance is distance from the dense detected outline before simplification, using calibration; 0.2 mm permits up to 0.2 mm of boundary movement. It is not pocket clearance.</p><p>Edit outline retains click-to-add and right-click-to-delete. Bend edges turns an edge into a curve by dragging. Shift-click or box-select nodes, or use Select points on a phone; drag/delete a group or simplify an adjacent section. Space/hand navigation and pinch do not edit points. These screenshots use a synthetic ruler to check workflow, not physical size.</p><div class="triple">'+''.join(ui_panes)+'</div></section>' if ui_panes else ''
page=f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pocketry · Dense lines and curves</title><style>
body{{font:15px/1.5 system-ui;max-width:1700px;margin:28px auto;padding:0 22px;background:#f3f6fa;color:#142139}}a{{color:#1260a5}}h1{{font-size:30px}}h2{{font-size:21px}}.summary,article{{background:white;border:1px solid #d8e0eb;border-radius:10px;padding:20px;margin:22px 0}}.panes,.pair,.triple{{display:grid;gap:12px;grid-template-columns:repeat(4,minmax(0,1fr))}}.pair{{grid-template-columns:repeat(2,minmax(0,1fr))}}.triple{{grid-template-columns:repeat(3,minmax(0,1fr))}}figure{{margin:0;background:#e8edf2;border-radius:5px}}figcaption{{padding:8px;font-weight:600;font-size:13px}}svg{{display:block;width:100%;height:460px}}.note{{background:#f1f5fb;padding:12px}}.scroll{{overflow:auto}}table{{border-collapse:collapse;width:100%;font-size:13px}}th,td{{padding:8px;text-align:left;border-bottom:1px solid #d8e0eb}}small{{white-space:nowrap;color:#5e6e83}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}}@media(max-width:950px){{.panes{{grid-template-columns:repeat(2,minmax(0,1fr))}}.triple{{grid-template-columns:1fr}}}}@media(max-width:500px){{.panes,.pair{{grid-template-columns:1fr}}body{{padding:0 10px}}}}
</style><h1>Dense boundary → straight lines and true curves</h1><p>Pocketry local review · 5 November 2026 · white calibration sheets only</p>{focus}{ui_section}
<div class="summary"><p><b>{fitted}/27 geometry previews valid; {27-fitted} retain their detected polygon. {accepted}/27 TEED reconstructions accepted; {27-accepted} keep color detection.</b> The set is 19 existing white-sheet crops plus eight original-pixel crop-first views, not 27 distinct tools. Historical mat/checkerboard photos are excluded. Poor segmentation remains poor evidence; fitting does not establish accuracy.</p>
<p>The new explicit preview uses the dense boundary, finite straight-line checks, multiscale corner support and continuously verified cubic fitting. Curve joins are tangent-constrained and adjusted only within the selected allowance. Genuine corners remain. The visible default is at least 0.1 mm when calibrated (1 px otherwise), or the 75th-percentile dense sampling step when coarser. It never silently relaxes a selected tolerance. These uncalibrated report cases use input pixels; the older preview used 0.6 px against an already-simplified polygon, so the error references/budgets differ.</p>
<p><b>Mac arm64 Node {esc(summary['node'])}, shipped CPU/WASM, three sequential corpus passes:</b> median fresh TEED {median('learnedMs'):.1f} ms; cached detection {median('cachedMs'):.1f} ms; geometry reconstruction {median('fitMs'):.1f} ms; complete fresh detection + geometry {total:.1f} ms. Table cells show median (min–max), in milliseconds. Color baseline median {median('baselineMs'):.1f} ms and mask reconstruction {median('reconstructMs'):.1f} ms remain recorded separately in per-case data.</p>
<p>OpenCV initialization {summary['initializeMs']:.1f} ms is separate. First learned call including model import: {summary['coldFirstRun']['ms']:.1f} ms; other fresh calls reuse the net while evicting the image cache between corpus passes. Timing samples are local, uncontrolled desktop runs. Browser worker measurements are separate. Neither set establishes iPhone/Android speed.</p>
<p>TEED model: 243 KiB, fixed FP32 512 × 512, no additional ML runtime. Observed WASM heap capacity {heap:.1f} MiB in the detector plus 128 MiB in main-thread calibration; this is not live allocations or total RSS. Geometry reconstruction itself uses dependency-free TypeScript in a cancellable worker, and does not load OpenCV/model assets when invoked alone.</p>
<p>Use <b>Outline → Auto-simplify outline</b>, choose More detail / Balanced / Smoother, compare the original, then Apply simplified outline. The advanced allowance is maximum distance from the dense detected outline; it is not added pocket clearance. Trace margin must be zero and the source unedited. Apply creates one undo step. Native cubic SVG and editable project backups retain handles; mesh/DXF outputs use adaptive samples. Error is measured against detected geometry, not photographed ground truth or manufacturing fit. Some residual joins/spurs remain when stronger smoothing would exceed the allowance.</p>
<p><a href="before-line-curve-reconstruction.html">Previous soft-mask report</a> · <a href="before-soft-mask-fix.html">Earlier soft-mask baseline</a> · <a href="raw-edges.html">Raw edge comparison</a></p></div>
<h2>Every white-sheet comparison and timing</h2><div class="scroll"><table><thead><tr><th>Tool / view</th><th>Fresh TEED ms</th><th>Cached ms</th><th>Geometry ms</th><th>Fresh + geometry ms</th><th>Allowance input px</th><th>Before → after anchors</th><th>Lines / cubics</th><th>Geometry result</th></tr></thead><tbody>{''.join(table)}</tbody></table></div>
<details class="summary"><summary>Browser, export and local verification records</summary><pre>{esc(json.dumps(browser,indent=2))}</pre></details>{''.join(cards)}<p>All photographs and results are embedded locally. No photo upload is used. No slicer, physical-print or dimensional-fit qualification is claimed.</p></html>'''
destination.parent.mkdir(parents=True,exist_ok=True);destination.write_text(page);(root/'report-records.json').write_text(json.dumps(records,indent=2));print(destination,destination.stat().st_size,'bytes')
