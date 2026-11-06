"""Render ten paired detector results as one portable HTML report.
Usage: python scripts/render-outline-comparison.py RESULTS_JSON OUTPUT_HTML
Input photos are local RGBA crops; JPEG copies omit EXIF metadata.
"""
import base64
import html
import io
import json
import statistics
import sys
from pathlib import Path
from PIL import Image

results = json.loads(Path(sys.argv[1]).read_text())
esc = html.escape
cards = []
for index, case in enumerate(results['cases'], 1):
    photo = Image.frombytes('RGBA', (case['width'], case['height']), Path(case['path']).read_bytes()).convert('RGB')
    data = io.BytesIO()
    photo.save(data, 'JPEG', quality=90)
    url = 'data:image/jpeg;base64,' + base64.b64encode(data.getvalue()).decode()
    paper = case['automaticWhitePaper']
    after = case['after'] if paper else case['color']
    mode = 'Tool edges' if paper else 'Color contrast'
    fallback = paper and after.get('refinement', {}).get('status') == 'fallback'
    if fallback:
        mode += ' → color fallback'
    figures = []
    for side, record, color, label in [('before', case['before'], '#b327b8', 'Before · original detector'), ('after', after, '#009c70', 'After · Automatic')]:
        lines = ''.join('<path d="M' + ' L'.join(f"{p['x']:.2f},{p['y']:.2f}" for p in shape['outer']) + 'Z"/>' for shape in record['outline'])
        unknown = ''
        if side == 'after':
            for ring in record.get('estimatedEdgeRegions', []):
                points = ' '.join(f"{p['x']:.2f},{p['y']:.2f}" for p in ring)
                unknown += f'<polygon points="{points}" fill="#edb32822" stroke="#ac6e00" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>'
        figures.append(f'<figure data-side="{side}"><figcaption style="color:{color}">{label}</figcaption><svg viewBox="0 0 {case["width"]} {case["height"]}" role="img" aria-label="{esc(case["title"])} — {label}"><image href="{url}" width="{case["width"]}" height="{case["height"]}"/>{unknown}<g fill="none" stroke="{color}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke">{lines}</g></svg></figure>')
    before_ms = round(statistics.median(case['samples']['before']))
    after_ms = round(statistics.median(case['samples']['after' if paper else 'color']))
    cards.append(f'<article id="photo-{index}"><div class="title"><span>{index:02d}</span><h2>{esc(case["title"])}</h2><button type="button" class="enlarge" aria-pressed="false">Enlarge</button></div><p class="note">{esc(case["note"])}</p><p class="meta">Automatic chose <b>{mode}</b> · Detection: <b>{before_ms} → {after_ms} ms</b></p><div class="pair">'+''.join(figures)+'</div></article>')
css = '''*{box-sizing:border-box}body{margin:0;background:#f4f6f8;color:#172431;font:16px/1.55 system-ui,sans-serif}main{max-width:1160px;margin:auto;padding:40px 24px}header{max-width:820px;margin-bottom:32px}h1{font-size:clamp(30px,5vw,46px);line-height:1.1;letter-spacing:-.025em;margin:12px 0 20px}h2{font-size:22px;line-height:1.25;margin:0}.eyebrow,.meta{font-size:13px;color:#526271}.eyebrow{text-transform:uppercase;letter-spacing:.1em}a{color:#17619c}nav{display:flex;gap:8px;flex-wrap:wrap;margin:24px 0}nav a,button{background:white;border:1px solid #ccd5dd;border-radius:5px;padding:6px 12px;color:#23394c;font:inherit;cursor:pointer}nav a{text-decoration:none;font-size:13px}article{background:white;border:1px solid #d8dfe5;border-radius:9px;padding:22px;margin:24px 0;scroll-margin-top:16px}.title{display:flex;align-items:center;gap:12px}.title span{color:#7a8793;font-variant-numeric:tabular-nums}.title button{margin-left:auto;font-size:13px}.note{margin:14px 0 6px}.meta{margin:0 0 18px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}figure{margin:0;min-width:0;background:#e9edf1}figcaption{padding:10px 12px;font-size:14px;font-weight:650;background:#f7f9fa}svg{width:100%;height:510px;display:block}svg path{vector-effect:non-scaling-stroke}article.enlarged{position:relative;margin-left:calc((1120px - min(96vw,1700px))/2);width:min(96vw,1700px)}article.enlarged svg{height:78vh}details{background:#e9eef2;border-radius:7px;padding:16px 20px;margin:24px 0}summary{cursor:pointer;font-weight:600}footer{color:#526271;font-size:13px;margin-top:32px}@media(max-width:700px){main{padding:24px 12px}article{padding:14px}.title{flex-wrap:wrap}h2{font-size:19px}.pair{gap:10px}svg{height:360px}figcaption{font-size:12px;padding:8px;min-height:54px;display:flex;align-items:center}article.enlarged{margin-left:0;width:auto}article.enlarged .pair{grid-template-columns:1fr}article.enlarged svg{height:78vh}}'''
page = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pocketry · Outline detection before and after</title><style>'''+css+'''</style><main><header><p class="eyebrow">Pocketry · 6 November 2026</p><h1>Tool outlines, before and after</h1><p>Ten photos of tools on white Pocketry calibration sheets, followed by two wood-background checks. The same crop appears in both columns: the original detector in magenta, and the new default <b>Automatic</b> mode in green. No hand edits, symmetry or photo-specific sensitivity tuning.</p><p>We tested color-mask refinement with GrabCut, learned edges with TEED, and line/curve reconstruction. The result combines automatic background selection, guarded learned outlines and sensitivity, local reference-strip handling, and optional outline simplification. Editable curves stays off by default.</p></header><nav aria-label="Photo comparisons">'''+''.join(f'<a href="#photo-{i}">{i:02d}</a>' for i in range(1,len(cards)+1))+'''</nav>'''+''.join(cards[:10])+'''<section><h2>Wood-background checks</h2><p>The same Automatic default, with a region around each loose tool rather than its neighboring bin.</p></section>'''+''.join(cards[10:])+'''<details><summary>How to read this comparison</summary><p>Before uses Pocketry’s original color detector from commit <code>6b9eb60a</code>, before the GrabCut, TEED and reconstruction changes. After uses the current Automatic default: light neutral paper selects Tool edges, while other or uncertain backgrounds select Color contrast with guarded GrabCut. Unreliable learned outlines fall back to color detection. The caption names the method actually chosen.</p><p>Both versions receive identical perspective-corrected crop pixels and default sensitivity (Auto), simplification and smoothing. Interior holes and Editable curves are off. These are initial detected boundaries: Auto-simplify is a separate preview, and clearance is excluded. Amber marks an estimated edge hidden by a reference strip.</p><p>Times are medians of three fresh detections on a Mac using Node 22 and the shipped CPU/WASM runtime. They include inference but exclude photo loading, calibration and downloads. The OpenCV runtime is already initialized. These are desktop measurements, not phone timings or physical-fit validation.</p><p>These selected examples show improvements and remaining limitations; they are not a contour-accuracy benchmark. Full source photos are not included; report crops omit EXIF metadata.</p></details><footer><a href="/">Open Pocketry</a> · <a href="https://github.com/wcscr/pocketry/pull/226">PR #226</a></footer></main><script>for(const b of document.querySelectorAll('.enlarge'))b.addEventListener('click',()=>{const a=b.closest('article'),on=a.classList.toggle('enlarged');b.textContent=on?'Normal size':'Enlarge';b.setAttribute('aria-pressed',String(on))});</script></html>'''
Path(sys.argv[2]).write_text(page)
print(sys.argv[2])
