"""Render offline white-sheet benchmark JSONs as a self-contained HTML report.
Usage: python render-teed-report.py RESULTS_DIR OUTPUT_HTML [BROWSER_JSON]
Requires Pillow; no photographs leave the machine.
"""
import base64
import html
import io
import json
import statistics
import sys
from pathlib import Path
from PIL import Image

root, destination = Path(sys.argv[1]), Path(sys.argv[2])
summary = json.loads((root / 'summary.json').read_text())
browser = json.loads(Path(sys.argv[3]).read_text()) if len(sys.argv) > 3 else None
esc = html.escape
colors = ['#ea1688', '#009bff', '#00be73']

def xy(p): return f"{p['x']:.3f} {p['y']:.3f}"
def polygon(r): return 'M' + 'L'.join(xy(p) for p in r) + 'Z'
def cubic(r):
    path = 'M' + xy(r[0]['point'])
    for i, a in enumerate(r):
        b = r[(i + 1) % len(r)]
        if a.get('out') or b.get('in'):
            def lerp(t): return {k: a['point'][k] * (1-t) + b['point'][k] * t for k in ['x','y']}
            path += 'C' + ' '.join(xy(p) for p in [a.get('out', lerp(1/3)), b.get('in', lerp(2/3)), b['point']])
        else: path += 'L' + xy(b['point'])
    return path + 'Z'

def picture(c, data, key=None, color=None):
    path = ''
    if key:
        for shape in c[key] if key == 'curves' else c[key]['outline']:
            path += (cubic if key == 'curves' else polygon)(shape['outer'])
    return f'<svg viewBox="0 0 {c["width"]} {c["height"]}" role="img" aria-label="{esc(key or "photo")}"><image width="{c["width"]}" height="{c["height"]}" href="data:image/jpeg;base64,{data}"/><path d="{path}" fill="none" stroke="{color or "none"}" stroke-width="1.7" vector-effect="non-scaling-stroke"/></svg>'

def metric(samples):
    return f'{statistics.median(samples):.1f} <small>({min(samples):.1f}–{max(samples):.1f})</small>'

def note(c):
    n = c['name']
    if n.startswith('wiha-150'):
        return 'Group crop is too tight: sheet printing and crop edges link five drivers. Learned reconstruction is rejected; color detection still misses shafts. Select each driver separately with white paper around it.'
    if n == 'mouldline-distant': return 'Very small crop: the bright hooked tip is not faithfully recovered. Select a larger original-pixel crop before using this outline.'
    if c['result'].get('refinement', {}).get('status') == 'fallback':
        return ('Color fallback: the learned enclosure touches opposite selection sides. Expand the region to include white paper around the complete tool.' if c['result']['refinement']['reason'] == 'selection-too-tight' else 'Color fallback: the learned mask fragmented an existing connected outline. Review the crop and sensitivity.')
    if c.get('fitError'): return 'Curve preview rejected by the topology guard; retain the detected polygon or try a smaller deviation.'
    if n in ['wire-strippers-original', 'wiha-50-original']:
        return 'Outer silhouette improves, but a narrow shadow/edge spur remains. Review the tip and trim manually.'
    if n == 'caliper-original': return 'The metal beam improves substantially. The tiny source crop still limits jaw/beam detail; prefer the crop-first view below.'
    if n.startswith('wiha-') and not n.endswith('cropfirst'): return 'Shaft recovery is sensitive to source resolution. Compare the larger crop-first view when available.'
    if n == 'gerber-close': return 'Both end recesses are retained; small shadow/edge spurs remain near the lower recess. Inspect before exporting.'
    if n == 'wire-strippers-original-cropfirst': return 'Body and handles are connected correctly, but a shadow spur reaches the crop border below the left handle. Expand the selection and trim that spur.'
    if n.endswith('cropfirst'): return 'Cropped from original pixels before reduction. This is the input strategy used by the new browser option.'
    return 'Review the complete boundary at full size before exporting; no ground-truth accuracy score is available.'

cards, table, records = [], [], []
for row in summary['cases']:
    c = json.loads((root / (row['name'] + '.json')).read_text())
    image = Image.open(Path(c['path']).with_suffix('.png')).convert('RGB')
    image.thumbnail((650,650))
    encoded = io.BytesIO(); image.save(encoded, 'JPEG', quality=88)
    data = base64.b64encode(encoded.getvalue()).decode()
    status = c['result']['refinement']['status']
    fit = 'rejected' if c.get('fitError') else 'preview available'
    count = lambda o: sum(len(s['outer']) for s in o)
    base_count = count(c['baseline']['outline'])
    p_count = count(c['result']['outline'])
    anchors = count(c['curves'])
    samples = c['samples']
    # First model import belongs to the separately listed cold-start result.
    warm = samples['learnedMs'][1:] if row['name'] == summary['coldFirstRun']['case'] else samples['learnedMs']
    records.append({**row, 'baselinePoints':base_count, 'warmLearnedMs':warm, 'notes':note(c), 'heapCapacityBytes':c['wasmHeapCapacityBytes']})
    browser_row = next((b for b in (browser or {}).get('corpus', {}).get('cases', []) if b['name'] == row['name']), None)
    browser_cell = f"{browser_row['learnedMs']:.1f} / {browser_row['cachedMs']:.1f}" if browser_row else 'pending'
    browser_line = f"Chrome worker: color {browser_row['colorMs']:.1f} ms · fresh TEED {browser_row['learnedMs']:.1f} ms · cached {browser_row['cachedMs']:.1f} ms · fit {browser_row['fitMs']:.1f} ms (one pass)." if browser_row else ''
    identifier = row['name']
    table.append(f'<tr><th><a href="#{identifier}">{esc(identifier)}</a></th><td>{metric(samples["baselineMs"])}</td><td>{metric(warm)}</td><td>{metric(samples["cachedMs"])}</td><td>{metric(samples["fitMs"])}</td><td>{browser_cell}</td><td>{base_count} → {p_count} → {anchors}</td><td>{status}; fit {fit}</td></tr>')
    panes=''.join(f'<figure><figcaption>{title}</figcaption>{picture(c,data,key,color)}</figure>' for title,key,color in [
        ('Photo',None,None),('Before · color + guarded GrabCut','baseline',colors[0]),
        ('After · retained color fallback' if status == 'fallback' else 'After · learned outer outline','result',colors[1]),('Fit rejected · polygon retained' if c.get('fitError') else 'Curve preview · 0.6 input px','curves',colors[2])])
    cards.append(f'<article id="{identifier}"><h2>{esc(identifier)}</h2><p>{c["width"]} × {c["height"]} input pixels · {status} · fit {fit} · {p_count} polygon points → {anchors} curve anchors</p><div class="panes">{panes}</div><p>{browser_line}</p><p class="note">{esc(note(c))}</p><details><summary>Timing samples and checks</summary><pre>{esc(json.dumps({"nodeSamplesMs":samples,"browserSinglePassMs":browser_row,"refinement":c["result"]["refinement"],"fitError":c.get("fitError"),"WASMHeapCapacityBytes":c["wasmHeapCapacityBytes"]},indent=2))}</pre></details></article>')

median = lambda key: statistics.median(statistics.median(r['samples'][key]) for r in records)
accepted = sum(r['status']['status']=='accepted' for r in records)
fits = sum(not r.get('fitError') for r in records)
heap = max(r['heapCapacityBytes'] for r in records)/2**20
browser_block = '<p>Browser timings pending.</p>' if browser is None else '<pre>'+esc(json.dumps(browser,indent=2))+'</pre>'
page = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pocketry · TEED outer outlines and curves</title>
<style>body{{font:15px/1.5 system-ui;max-width:1700px;margin:32px auto;padding:0 24px;background:#f4f6fa;color:#142139}}h1{{font-size:30px}}h2{{font-size:20px}}a{{color:#1260a5}}.summary,article{{background:white;border:1px solid #d9e0eb;border-radius:10px;padding:20px;margin:22px 0}}.panes{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}}figure{{margin:0;background:#e8edf2;border-radius:5px}}figcaption{{padding:8px;font-weight:600;font-size:13px}}svg{{display:block;width:100%;height:460px}}.note{{background:#f2f5fb;padding:12px}}table{{border-collapse:collapse;width:100%;font-size:13px}}th,td{{text-align:left;padding:8px;border-bottom:1px solid #d9e0eb}}small{{color:#607088;white-space:nowrap}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}}.scroll{{overflow-x:auto}}@media(max-width:950px){{.panes{{grid-template-columns:repeat(2,minmax(0,1fr))}}svg{{height:360px}}}}@media(max-width:500px){{.panes{{grid-template-columns:1fr}}body{{padding:0 10px}}}}</style>
<h1>TEED outer outlines → editable curves</h1><p>Pocketry local integration review · 5 November 2026 · white calibration sheets only</p>
<div class="summary"><p><b>{accepted}/27 learned reconstructions accepted; {27-accepted} color fallbacks. {fits}/27 curve previews available.</b> The tight five-driver group crops remain unsuitable, and some accepted results still need manual cleanup. These are 19 existing white-sheet crops plus 8 views cropped from original pixels first. Historical mat/checkerboard photos are excluded. Counts describe software acceptance, not 27 independently photographed tools or a ground-truth accuracy score.</p>
<p><b>Mac Node {esc(summary['node'])}, shipped OpenCV CPU/WASM, three full corpus passes:</b> median per-case color time {median('baselineMs'):.1f} ms; fresh learned pipeline {median('learnedMs'):.1f} ms; cached adjustment {median('cachedMs'):.1f} ms; curve fitting {median('fitMs'):.1f} ms. Table cells show median (min–max), in milliseconds. This is one process, sequential tests; occasional OS/browser activity can affect samples.</p>
<p>OpenCV initialization: {summary['initializeMs']:.1f} ms, measured separately. First learned call including model import: {summary['coldFirstRun']['ms']:.1f} ms ({esc(summary['coldFirstRun']['case'])}); excluded from that row’s warm samples. All other fresh calls reuse the net but evict the single-image edge cache between corpus passes. Cached calls repeat the same frame, skipping inference while rebuilding the silhouette. Detail/smoothing use the existing polygon cache and need no model call.</p>
<p>Model: 248,782 bytes (243 KiB), FP32, fixed 512 × 512. No additional inference runtime; uses Pocketry’s existing OpenCV WASM. Peak observed detection-worker WASM heap <em>capacity</em>: {heap:.0f} MiB; this is not live allocations, process RSS, or a phone measurement. Browser workers release after 30 seconds idle; cancellation terminates the worker. The browser also retains its main-thread calibration OpenCV heap (128 MiB), so the two observed heap capacities together reach about 394 MiB before images/JS. Actual iPhone/Android speed and memory remain unmeasured.</p>
<p>Curve fitting is explicit and previewed; this report uses a conservative 0.6 <em>input-pixel</em> deviation against the detected polygon. It does not measure error against the photographed tool. Sharp corners remain, so anchor reductions may be modest. Rejected fits leave the polygon untouched. SVG can retain cubic curves; mesh/DXF exports use adaptive samples. No physical print or dimensional-fit qualification is claimed.</p>
<p><a href="raw-edges.html">Earlier raw-edge comparison</a> · The learned option is off by default. Select a region with paper around the complete tool, enable <b>Learned outer outline</b>, then use <b>Edit Contour → Edit curves (prototype) → Auto-fit contour</b>.</p></div>
<p>Chrome columns use one sequential pass through the real browser worker on this Mac. The first row includes model import; all later fresh rows reuse the net but run inference. Per-photo panels also list browser color and curve-fit time. These are separate runs from the three-pass Node measurements.</p><h2>Every white-sheet case · before / after and performance</h2><div class="scroll"><table><thead><tr><th>Tool / photo</th><th>Color ms</th><th>Fresh TEED ms</th><th>Cached ms</th><th>Fit ms</th><th>Chrome fresh / cached ms</th><th>Color points → TEED points → anchors</th><th>Result</th></tr></thead><tbody>{''.join(table)}</tbody></table></div>
<details class="summary"><summary>Real browser worker / UI validation</summary><p>The animation heartbeat covers worker detection; photo decoding and the existing calibration preflight are outside that measurement.</p>{browser_block}</details>
{''.join(cards)}<p>All images and results are embedded locally. No external photo upload is used.</p></html>'''
destination.parent.mkdir(parents=True,exist_ok=True)
destination.write_text(page)
(root/'report-records.json').write_text(json.dumps(records,indent=2))
print(destination, destination.stat().st_size, 'bytes')
