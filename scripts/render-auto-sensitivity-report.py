"""Focused automatic-sensitivity report; preserves the historical corpus.
python scripts/render-auto-sensitivity-report.py RESULTS CASES_JSON MAIN_REPORT BROWSER_JSON
"""
import base64
import html
import json
import re
import statistics
import sys
from pathlib import Path

root, manifest, main, browser_path = map(Path, sys.argv[1:5])
summary = json.loads((root / 'summary.json').read_text())
inputs = {c['name']: c for c in json.loads(manifest.read_text())}
browser = json.loads(browser_path.read_text())
esc = html.escape
records = [json.loads((root / (c['name'] + '.json')).read_text()) for c in summary['cases']]


def picture(c, key):
    photo = base64.b64encode(Path(inputs[c['name']]['path']).with_suffix('.png').read_bytes()).decode()
    paths = ''
    for s in c[key + 'Silhouette']:
        points = ' L'.join(f'{p["x"]},{p["y"]}' for p in s['outer'])
        paths += f'<path d="M{points}Z" fill="none" stroke="{"#c637ed" if key == "before" else "#00bf86"}" stroke-width="2" vector-effect="non-scaling-stroke"/>'
    patches = ''.join('<polygon points="'+' '.join(f'{p["x"]},{p["y"]}' for p in ring)+'" fill="none" stroke="#e5a51a" stroke-width="2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>' for ring in c['occlusions'])
    return f'<svg viewBox="0 0 {c["width"]} {c["height"]}" role="img" aria-label="{esc(c["name"])} {key} outline"><image href="data:image/png;base64,{photo}" width="{c["width"]}" height="{c["height"]}"/>{paths}{patches}</svg>'


def metric(values):
    return f'{statistics.median(values):.1f} ({min(values):.1f}–{max(values):.1f})'


rows, cards, controls = [], [], []
for c in records:
    r = c['after']['refinement']
    rows.append(f'<tr><th>{esc(c["name"])}</th><td>{len(c["beforeSilhouette"])} → {len(c["afterSilhouette"])}</td>'+''.join('<td>'+metric(c['samples'][key])+'</td>' for key in ['beforeMs', 'afterMs', 'cachedMs', 'beforeReconstructionMs', 'reconstructionMs'])+f'<td>{r["edgeThreshold"]:.2f} · {r["edgeThresholdTrials"]} trials</td></tr>')
    panes = '<div class="pair"><figure><figcaption>Before · Auto used a fixed threshold</figcaption>'+picture(c, 'before')+'</figure><figure><figcaption>After · Auto, no slider adjustment</figcaption>'+picture(c, 'after')+'</figure></div>'
    if c['name'].endswith('corrected'):
        cards.append(f'<article><h2>{esc(c["sourceFile"])}</h2><p>Exact crop from the built browser after paper perspective correction and aid/paper calibration. {len(c["beforeSilhouette"])} → {len(c["afterSilhouette"])} outer shapes; Auto remains selected.</p>'+panes+'<details><summary>Timing and selection record</summary><pre>'+esc(json.dumps({'samplesMs': c['samples'], 'before': c['before']['refinement'], 'after': r, 'rgbaSha256': c['rgbaSha256']}, indent=2))+'</pre></details></article>')
    else:
        controls.append(f'<details><summary>{esc(c["name"])} · unchanged original-crop control</summary>'+panes+'</details>')

table = '<div class="scroll"><table><thead><tr><th>View</th><th>Before → after shapes</th><th>Before fresh ms</th><th>After fresh ms</th><th>After cached ms</th><th>Before boundary step ms*</th><th>After boundary step ms*</th><th>Automatic selection</th></tr></thead><tbody>'+''.join(rows)+'</tbody></table></div>'
scope = '<p>Two Craftsman photographs only, each as its original crop and exact perspective-corrected browser crop: four views, not four tools. Three alternating passes evict each runtime’s single-image cache. Warm nets are reused. The full white-sheet corpus was not rerun.</p>'
method = '<p>Auto keeps an already complete boundary byte-identical. When substantial foreground evidence is missing, it checks a bounded threshold range on the same learned edge map, requiring near-complete foreground coverage and stability at the next threshold. Exterior-paper checks protect recesses; connected colour evidence and existing enclosures distinguish fragments from independent tools. It retains the initial result when the guards cannot support a replacement. Explicit sensitivity remains a manual override. The existing model-resolution limits, including tiny unresolved gaps, still apply.</p><p>One model inference per fresh image, no new model/dependency/runtime. Edge reconstruction checks at most five thresholds in the existing worker. Reference-strip masking, point/curve repair, calibration and Undo are retained. The threshold values below are diagnostic metadata; users keep the existing Auto setting.</p>'
timing = f'<p>Mac arm64 Node {esc(summary["node"])} / bundled CPU WASM; median (min–max) in milliseconds. *Boundary-step time includes all threshold checks and is already part of detection, not an additional total. OpenCV initialization {summary["initializeMs"]:.1f} ms is separate; first updated strip call including model import {summary["cases"][0]["samples"]["afterMs"][0]:.1f} ms. Timings exclude photo decoding, calibration, UI scheduling and subsequent simplification. Desktop measurements do not establish real-phone performance or physical fit.</p>'
checks = '<section><h2>Built-browser verification</h2><p>Both original JPEGs pass the recommended perspective/scale workflow at Auto sensitivity, with one outline each and no slider adjustment. Point and native-curve modes pass repair preview, signed Bend, Cancel, Apply/Undo/Redo and unchanged calibration, photo alignment and review regions. The strip keeps its amber estimate. Compact layout is checked at 390 px; this is not a physical-phone benchmark.</p><details><summary>Browser verification record</summary><pre>'+esc(json.dumps(browser, indent=2))+'</pre></details></section>'
page = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pocketry · Automatic sensitivity</title><style>body{font:15px/1.5 system-ui;background:#f3f6fa;color:#142139;max-width:1650px;margin:24px auto;padding:0 18px}section,article{background:white;padding:20px;border:1px solid #d8e0eb;border-radius:10px;margin:20px 0}h1{font-size:28px}h2{font-size:20px}.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}figure{margin:0;background:#e8edf2}figcaption{font-size:13px;font-weight:600;padding:9px}svg{display:block;width:100%;height:510px}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:9px;border-bottom:1px solid #d8e0eb}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}@media(max-width:650px){.pair{grid-template-columns:1fr}}</style><h1>Automatic sensitivity · two-photo review</h1><section>'+scope+method+table+timing+'</section>'+checks+''.join(cards)+'<section><h2>Original-crop controls</h2>'+''.join(controls)+'</section></html>'
target = main.parent / 'automatic-sensitivity.html'
target.write_text(page)

archive = main.parent / 'before-automatic-sensitivity-report.html'
if not archive.exists():
    archive.write_text(main.read_text())
start, end = '<!-- AUTO_SENSITIVITY_START -->', '<!-- AUTO_SENSITIVITY_END -->'
text = re.sub(re.escape(start)+'.*?'+re.escape(end), '', main.read_text(), flags=re.S)
focus = next(c for c in records if c['name'] == 'no-strip-corrected')
section = start+'<section class="summary" id="automatic-sensitivity-update"><h2>Latest update · automatic sensitivity</h2><p>Both Craftsman photographs now produce one outline at Auto, including the corrected no-strip photo that previously needed +30. No slider adjustment is required. Already complete original crops stay unchanged; only these two photographs were retested.</p><div class="pair"><figure><figcaption>Before · corrected no-strip photo split at Auto</figcaption>'+picture(focus, 'before')+'</figure><figure><figcaption>After · automatic recovery, one outline</figcaption>'+picture(focus, 'after')+'</figure></div>'+table+'<p><a href="automatic-sensitivity.html">Two-photo comparisons, timing method, safeguards and browser checks</a>. Threshold search reuses one model inference. The localized-aid review and 27-view corpus below are historical.</p></section>'+end
text = text.replace('</h1>', '</h1>'+section, 1)
text = text.replace('Latest focused update · reference strip and local repair', 'Previous focused update · reference strip and local repair')
text = text.replace('The perspective-corrected no-strip control still splits at Auto sensitivity; +30 returns one outline for editing.', 'At the preceding revision, the corrected no-strip control needed +30; the automatic update above resolves that limitation.')
main.write_text(text)
prior = main.parent / 'craftsman-reference-strip.html'
if prior.exists():
    notice = '<!-- AUTO_NOTICE_START --><p><b>Historical localized-aid review:</b> the +30 workaround described below is superseded. <a href="automatic-sensitivity.html">The current automatic-sensitivity build handles both photos at Auto.</a></p><!-- AUTO_NOTICE_END -->'
    old = re.sub('<!-- AUTO_NOTICE_START -->.*?<!-- AUTO_NOTICE_END -->', '', prior.read_text(), flags=re.S)
    prior.write_text(old.replace('</h1>', '</h1>'+notice, 1))
print(target)
