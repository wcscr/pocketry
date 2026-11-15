"""Focused local aid report; does not rerun or regenerate the historical corpus.
Usage: python scripts/render-aid-report.py RESULTS_DIR PREPARED_CASES_JSON MAIN_REPORT [BROWSER_JSON]
"""
import base64
import html
import json
import re
import statistics
import sys
from pathlib import Path

root, manifest, main = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
summary = json.loads((root / 'summary.json').read_text())
browser = json.loads(Path(sys.argv[4]).read_text()) if len(sys.argv) > 4 else None
inputs = {c['name']: c for c in json.loads(manifest.read_text())}
esc = html.escape


def path(ring):
    result = f"M{ring[0]['point']['x']},{ring[0]['point']['y']}"
    for i, a in enumerate(ring):
        b = ring[(i + 1) % len(ring)]
        if a.get('out') or b.get('in'):
            p, q = a['point'], b['point']
            c = a.get('out', {k: (2*p[k]+q[k])/3 for k in p})
            d = b.get('in', {k: (p[k]+2*q[k])/3 for k in p})
            result += f"C{c['x']},{c['y']} {d['x']},{d['y']} {q['x']},{q['y']}"
        else:
            result += f"L{b['point']['x']},{b['point']['y']}"
    return result + 'Z'


def as_curves(outline):
    return [{'outer': [{'point': p} for p in s['outer']], 'holes': []} for s in outline]


def picture(c, curves):
    photo = Path(inputs[c['name']]['path']).with_suffix('.png')
    encoded = base64.b64encode(photo.read_bytes()).decode()
    shapes = ''.join(f'<path d="{path(s["outer"])}" fill="none" stroke="#00c98d" stroke-width="2" vector-effect="non-scaling-stroke"/>' for s in curves)
    patches = ''.join(f'<polygon points="'+ ' '.join(f'{p["x"]},{p["y"]}' for p in r) + '" fill="none" stroke="#e5a51a" stroke-width="2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>' for r in c['occlusions'])
    return f'<svg viewBox="0 0 {c["width"]} {c["height"]}" role="img" aria-label="{esc(c["name"])} outline comparison"><image href="data:image/png;base64,{encoded}" width="{c["width"]}" height="{c["height"]}"/>{shapes}{patches}</svg>'


def metric(values):
    return f'{statistics.median(values):.1f} ({min(values):.1f}–{max(values):.1f})'


cards, rows, comparisons = [], [], []
for item in summary['cases']:
    c = json.loads((root / (item['name'] + '.json')).read_text())
    # The evaluator stores the actual app-facing silhouette explicitly.
    before = c['beforeSilhouette']
    panes = [('Before · requested Tool edges', as_curves(before)), ('After · detected boundary', as_curves(c['afterSilhouette']))]
    for key, title in [('points', 'After Auto-simplify · points'), ('curves', 'After Auto-simplify · editable curves')]:
        geometry = c['geometry'][key]
        if geometry.get('curves'):
            panes.append((title, geometry['curves']))
    figures = ''.join(f'<figure><figcaption>{esc(title)}</figcaption>{picture(c, curves)}</figure>' for title, curves in panes)
    samples = c['samples']
    rows.append('<tr><th>'+esc(c['sourceFile'])+'</th>'+''.join('<td>'+metric(samples[key])+'</td>' for key in ['beforeMs', 'afterMs', 'cachedMs', 'repairMs', 'pointMs', 'curveMs'])+'</tr>')
    note = ('Before: the aid disabled TEED globally. After: TEED remains active; only the recognized footprint is unknown. The lower-right continuation is estimated and remains amber for review.'
            if c['occlusions'] else 'No-aid control: detected outline is exactly unchanged from the before runtime. The photograph differs in camera position and calibration plane; it is not pixel-aligned ground truth for the hidden edge.')
    geometry = {k: {field: value.get(field) for field in ['before', 'after', 'lines', 'cubics', 'maxDeviation', 'tolerance', 'error']} for k, value in c['geometry'].items()}
    cards.append(f'<article><h2>{esc(c["sourceFile"])}</h2><p>{esc(note)}</p><div class="panes">{figures}</div><p>Calibration: {esc(c["calibrationKind"])}; {c["mmPerPx"]:.6f} mm/input px. Fitting allowance is measured against the repaired detected boundary, not physical ground truth.</p><details><summary>Geometry / timing records</summary><pre>{esc(json.dumps({"geometry": geometry, "samplesMs": samples, "beforeStatus": c["before"]["refinement"], "afterStatus": c["after"]["refinement"], "sourceSha256": c["sourceSha256"]}, indent=2))}</pre></details></article>')
    if c['occlusions']:
        comparisons = [picture(c, as_curves(before)), picture(c, as_curves(c['afterSilhouette']))]

table = '<div class="scroll"><table><thead><tr><th>Photo</th><th>Before detection ms</th><th>After fresh ms</th><th>After cached ms</th><th>Local continuation ms*</th><th>Point simplification ms</th><th>Curve reconstruction ms</th></tr></thead><tbody>'+''.join(rows)+'</tbody></table></div>'
ui = main.parent / 'craftsman-repair-controls.png'
ui_html = '<figure><figcaption>Repair section · actual built browser</figcaption><img style="width:100%;max-height:650px;object-fit:contain" src="data:image/png;base64,'+base64.b64encode(ui.read_bytes()).decode()+'"/></figure>' if ui.exists() else ''
browser_html = ''
if browser:
    browser_html = '<section><h2>Built-browser checks and remaining limitation</h2><p>The original JPEGs were tested with recommended paper perspective correction and aid/paper scale. Both pass line/curve preview, signed Bend, Cancel, one-step Apply/Undo/Redo, and calibration/photo/review-region preservation in point and native-curve modes. The compact layout was checked at 390 px, not on a physical phone.</p><p><b>The corrected no-strip photo still splits into two parts at Auto sensitivity.</b> The existing <b>+30 Sensitivity</b> setting returns one outline and was used for that photo’s editing checks. The unchanged no-aid comparison above uses the original, unrectified crop. Localized aid handling does not solve all sensitivity/resampling failures; no global defaults or photo-specific rules were changed.</p><details><summary>Browser verification record</summary><pre>'+esc(json.dumps(browser, indent=2))+'</pre></details></section>'
    limitation = main.parent / 'craftsman-corrected-control-default.png'
    if limitation.exists():
        browser_html += '<details><summary>Perspective-corrected control at Auto sensitivity · unresolved split</summary><img alt="No-strip corrected photo split at Auto sensitivity" style="width:100%" src="data:image/png;base64,'+base64.b64encode(limitation.read_bytes()).decode()+'"/></details>'
body = '<h1>Localized measurement-aid handling · Craftsman review</h1><p>5 November 2026 · two white-sheet photographs only. The full set was not rerun.</p><section><p>Recognized aids no longer disable TEED. Aid pixels cannot select an enclosure; the recognized footprint is restored as unknown, and a short missing boundary can continue from two reliable visible tangents. Multiple crossings, long gaps, inconsistent tangents, an escaping curve or invalid topology retain the local estimate and amber review region.</p><p><b>Repair section</b> is available after selecting two endpoints or a continuous group. Preview Line or Smooth curve, adjust the signed midpoint Bend if needed, then Apply repair or Cancel. Endpoints and outside geometry stay fixed; Apply creates one Undo step. Ordinary sampled points are the default; Editable curves preserves native handles. Calibration is unchanged.</p>'+table+f'<p>Mac arm64 Node {esc(summary["node"])} / shipped CPU WASM. Three sequential alternating passes; table shows median (min–max). Before revision {esc(summary["beforeRevision"])}. Before strip result is color fallback; no-aid before timings explicitly evict the old image cache without timing the eviction. Current cached detection includes mask restoration and tracing. *Local continuation is already included in detection; do not add it twice. OpenCV initialization {summary["initializeMs"]:.1f} ms is separate. First strip call, including model import: {summary["cases"][0]["samples"]["afterMs"][0]:.1f} ms. Calibration, photo decoding, UI scheduling and subsequent Auto-simplify are separate. These desktop measurements do not qualify phone performance or physical fit.</p><p>Original photograph crops are sampled with Pillow at at most 1024 px, matching the app’s crop-first budget. Browser workflow checks additionally use the original JPEGs, recommended perspective correction and automatic scale.</p></section>'+browser_html+''.join(cards)+ui_html
page = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pocketry · Localized aid review</title><style>body{font:15px/1.5 system-ui;background:#f3f6fa;color:#142139;max-width:1650px;margin:24px auto;padding:0 18px}section,article{background:white;padding:20px;border:1px solid #d8e0eb;border-radius:10px;margin:20px 0}h1{font-size:28px}h2{font-size:20px}.panes{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}figure{margin:0;background:#e8edf2}figcaption{font-size:13px;font-weight:600;padding:9px}svg{display:block;width:100%;height:440px}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:9px;border-bottom:1px solid #d8e0eb}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}@media(max-width:1000px){.panes{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:550px){.panes{grid-template-columns:1fr}}</style>'+body+'</html>'
target = main.parent / 'craftsman-reference-strip.html'
target.write_text(page)
start, end = '<!-- LOCAL_AID_UPDATE_START -->', '<!-- LOCAL_AID_UPDATE_END -->'
old = main.read_text()
old = re.sub(re.escape(start)+'.*?'+re.escape(end), '', old, flags=re.S)
section = start+'<section class="summary" id="localized-aid-update"><h2>Latest focused update · reference strip and local repair</h2><p>Only the two Craftsman tape-measure photos were retested. The remaining corpus below is the preceding evaluation and was not rerun.</p><p>TEED now stays active with a recognized aid. Short supported gaps get local line/curve continuation; estimated areas remain amber. Select two points → Repair section previews a Line or Smooth curve, with one Undo step and point output by default.</p><div class="pair">'+''.join('<figure><figcaption>'+title+'</figcaption>'+svg+'</figure>' for title, svg in zip(['Before · global fallback', 'After · localized aid handling'], comparisons))+'</div>'+table+'<p>The perspective-corrected no-strip control still splits at Auto sensitivity; +30 returns one outline for editing. This limitation and both representation-mode browser checks are recorded in the <a href="craftsman-reference-strip.html">complete two-photo comparison, controls and timing notes</a>. Desktop CPU/WASM measurements; no phone or physical-fit qualification.</p></section>'+end
old = old.replace('</h1>', '</h1>'+section, 1)
main.write_text(old)
print(target)
