"""Render paired detector results as one portable HTML report.
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
if not results.get('completePipeline'):
    raise ValueError('The report requires measured detection plus automatic cleanup, not initial detections.')
esc = html.escape
cards = []
sheet_cards = []
wood_cards = []
tool_ids = [case.get('toolId') for case in results['cases'] if case.get('toolId')]
if len(tool_ids) != len(set(tool_ids)):
    raise ValueError('Choose one view per tool; duplicate tool IDs were supplied.')
for index, case in enumerate(results['cases'], 1):
    photo = Image.frombytes('RGBA', (case['width'], case['height']), Path(case['path']).read_bytes()).convert('RGB')
    data = io.BytesIO()
    photo.save(data, 'JPEG', quality=90)
    url = 'data:image/jpeg;base64,' + base64.b64encode(data.getvalue()).decode()
    paper = case['automaticWhitePaper']
    after = case['after']
    mode = 'Tool edges' if paper else 'Color contrast'
    fallback = paper and after.get('refinement', {}).get('status') == 'fallback'
    if fallback:
        mode += ' → color fallback'
    figures = []
    for side, record, color, label in [('before', case['before'], '#b327b8', 'Before · original detector'), ('after', after, '#009c70', 'After · Automatic + cleanup')]:
        lines = ''.join('<path d="M' + ' L'.join(f"{p['x']:.2f},{p['y']:.2f}" for p in shape['outer']) + 'Z"/>' for shape in record['outline'])
        unknown = ''
        if side == 'after':
            for ring in record.get('estimatedEdgeRegions', []):
                points = ' '.join(f"{p['x']:.2f},{p['y']:.2f}" for p in ring)
                unknown += f'<polygon points="{points}" fill="#edb32822" stroke="#ac6e00" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>'
        figures.append(f'<figure data-side="{side}"><figcaption style="color:{color}">{label}</figcaption><svg viewBox="0 0 {case["width"]} {case["height"]}" role="img" aria-label="{esc(case["title"])} — {label}"><image href="{url}" width="{case["width"]}" height="{case["height"]}"/>{unknown}<g fill="none" stroke="{color}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke">{lines}</g></svg></figure>')
    before_ms = round(statistics.median(case['samples']['before']))
    after_ms = round(statistics.median(case['samples']['after']))
    cleanup_note = '' if after.get('cleanup', {}).get('applied') else ' · Cleanup kept the detected boundary'
    note = f'<p class="note">{esc(case["note"])}</p>' if case.get('note') else ''
    card = f'<article id="photo-{index}" data-tool="{esc(case.get("toolId", case["name"]), quote=True)}"><div class="title"><span>{index:02d}</span><h2>{esc(case["title"])}</h2><button type="button" class="enlarge" aria-pressed="false">Enlarge</button></div>{note}<p class="meta">Automatic chose <b>{mode}</b> · Detection + cleanup: <b>{before_ms} → {after_ms} ms</b>{cleanup_note}</p><div class="pair">'+''.join(figures)+'</div></article>'
    cards.append(card)
    (wood_cards if case.get('background') == 'wood' else sheet_cards).append(card)
css = '''*{box-sizing:border-box}body{margin:0;background:#f4f6f8;color:#172431;font:16px/1.55 system-ui,sans-serif}main{max-width:1160px;margin:auto;padding:40px 24px}header{max-width:820px;margin-bottom:32px}h1{font-size:clamp(30px,5vw,46px);line-height:1.1;letter-spacing:-.025em;margin:12px 0 20px}h2{font-size:22px;line-height:1.25;margin:0}.eyebrow,.meta{font-size:13px;color:#526271}.eyebrow{text-transform:uppercase;letter-spacing:.1em}a{color:#17619c}nav{display:flex;gap:8px;flex-wrap:wrap;margin:24px 0}nav a,button,select{background:white;border:1px solid #ccd5dd;border-radius:5px;padding:6px 12px;color:#23394c;font:inherit;cursor:pointer}nav a{text-decoration:none;font-size:13px}nav label{display:flex;flex-direction:column;gap:6px;max-width:100%}select{max-width:100%}article{background:white;border:1px solid #d8dfe5;border-radius:9px;padding:22px;margin:24px 0;scroll-margin-top:16px}.title{display:flex;align-items:center;gap:12px}.title span{color:#7a8793;font-variant-numeric:tabular-nums}.title button{margin-left:auto;font-size:13px}.note{margin:14px 0 6px}.meta{margin:0 0 18px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}figure{margin:0;min-width:0;background:#e9edf1}figcaption{padding:10px 12px;font-size:14px;font-weight:650;background:#f7f9fa}svg{width:100%;height:510px;display:block}svg path{vector-effect:non-scaling-stroke}article.enlarged{position:relative;margin-left:calc((1120px - min(96vw,1700px))/2);width:min(96vw,1700px)}article.enlarged svg{height:78vh}details{background:#e9eef2;border-radius:7px;padding:16px 20px;margin:24px 0}summary{cursor:pointer;font-weight:600}footer{color:#526271;font-size:13px;margin-top:32px}@media(max-width:700px){main{padding:24px 12px}article{padding:14px}.title{flex-wrap:wrap}h2{font-size:19px}.pair{gap:10px}svg{height:360px}figcaption{font-size:12px;padding:8px;min-height:54px;display:flex;align-items:center}article.enlarged{margin-left:0;width:auto}article.enlarged .pair{grid-template-columns:1fr}article.enlarged svg{height:78vh}}'''
scope = f'{len(sheet_cards)} distinct tools and attachments on white Pocketry calibration sheets, with one view per tool. Tools photographed together are selected individually.'
if wood_cards:
    scope += f' Followed by {len(wood_cards)} additional wood-background checks.'
wood_section = '<section><h2>Wood-background checks</h2><p>The same Automatic default, with one loose tool selected per region.</p></section>' + ''.join(wood_cards) if wood_cards else ''
page = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pocketry · Outline detection before and after</title><style>'''+css+'''</style><main><header><p class="eyebrow">Pocketry · 6 November 2026</p><h1>Tool outlines, before and after</h1><p>'''+scope+''' The same crop appears in both columns: the original detector in magenta, and the new default <b>Automatic detection + line/curve cleanup</b> in green. Cleanup runs automatically as part of detection. No manual outline edits, symmetry or photo-specific sensitivity tuning are used.</p><p>We tested color-mask refinement with GrabCut, learned edges with TEED, and line/curve reconstruction. The result combines automatic background selection, guarded learned outlines and sensitivity, local reference-strip and shadow-rail repair, and automatic line/curve reconstruction. Rounded sections are sampled into editable points; Editable curves stays off by default.</p></header><nav aria-label="Photo comparisons">'''+'<label for="photo-select">Jump to tool<select id="photo-select"><option value="">Choose a tool</option>'+''.join(f'<option value="photo-{i}">{i:02d} · {esc(c["title"])}</option>' for i,c in enumerate(results['cases'],1))+'</select></label>'+'''</nav>'''+''.join(sheet_cards)+wood_section+'''<details><summary>How to read this comparison</summary><p>Before uses Pocketry’s original color detector from commit <code>6b9eb60a</code>, before the GrabCut, TEED and reconstruction changes. After uses the current Automatic default: light neutral paper selects Tool edges, with recognized sheet markers also supporting shaded paper. Other or uncertain backgrounds select Color contrast with guarded GrabCut. Unreliable learned outlines fall back to color detection. The caption names the method actually chosen.</p><p>Both versions receive identical crop pixels (perspective-corrected for the white-sheet comparisons) and default sensitivity (Auto), simplification and smoothing. Interior holes and Editable curves are off. The after column includes automatic line-and-curve reconstruction, approximated with points. Adjust simplification can preview another allowance; clearance is excluded. If topology checks reject cleanup, the initial boundary is retained and the caption says so. Amber marks an estimated edge hidden by a reference strip.</p><p>Times are medians of three fresh detections on a Mac using Node 22 and the shipped CPU/WASM runtime. They include inference and automatic cleanup but exclude photo loading, calibration and downloads. The OpenCV runtime is already initialized. These are desktop measurements, not phone timings or physical-fit validation.</p><p>Repeated views of the same tool, trays, retail cases and foreign calibration sheets are omitted. Difficult and unsuccessful results are included; this is not a contour-accuracy benchmark. Full source photos are not included; report crops omit EXIF metadata.</p></details><footer><a href="/">Open Pocketry</a> · <a href="https://github.com/wcscr/pocketry/pull/226">PR #226</a></footer></main><script>document.getElementById('photo-select').addEventListener('change',e=>{if(e.target.value)location.hash=e.target.value});for(const b of document.querySelectorAll('.enlarge'))b.addEventListener('click',()=>{const a=b.closest('article'),on=a.classList.toggle('enlarged');b.textContent=on?'Normal size':'Enlarge';b.setAttribute('aria-pressed',String(on))});</script></html>'''
Path(sys.argv[2]).write_text(page)
print(sys.argv[2])
