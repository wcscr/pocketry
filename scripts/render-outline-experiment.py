"""Render a report-only experiment alongside the unchanged PR and original detector.
Usage: python scripts/render-outline-experiment.py RESULTS_JSON REVIEW_JSON OUTPUT_HTML
The experiment runs outside the application; this renderer only publishes its results.
"""
import base64
import html
import io
import json
import statistics
import sys
from collections import Counter
from pathlib import Path
from PIL import Image

results = json.loads(Path(sys.argv[1]).read_text())
review = json.loads(Path(sys.argv[2]).read_text())
cases = results['cases']
experiment_label = results.get('experimentLabel', 'Combined experiment')
has_previous = all('previousExperiment' in c for c in cases)
if any('previousExperiment' in c for c in cases) and not has_previous:
    raise ValueError('The previous experiment must cover every subject.')
if not results.get('completePipeline') or not results.get('experiment'):
    raise ValueError('Complete, measured experimental pipeline results are required.')
if len(cases) != 36 or len({c['toolId'] for c in cases}) != 36:
    raise ValueError('Expected the 36 distinct white-sheet subjects, once each.')
if set(review['cases']) != {c['name'] for c in cases}:
    raise ValueError('Every displayed subject needs an explicit comparison review.')
for c in cases:
    if any(len(c['samples'][side]) != 3 for side in ('current', 'experimental')):
        raise ValueError('Three fresh full-pipeline timings are required for each side.')
    if c.get('background') != 'white':
        raise ValueError('This report is restricted to the white-sheet set.')

esc = html.escape
counts = Counter(review['cases'][c['name']]['status'] for c in cases)
changed = sum(c['changed'] for c in cases)
loss_cases = sum(any(p['before']['present'] and not p['after']['present'] for p in c['audit']['probes']) for c in cases)
gain_cases = sum(any(not p['before']['present'] and p['after']['present'] for p in c['audit']['probes']) for c in cases)
labels = {'improved': 'Improved · limitations remain', 'mixed': 'Mixed result', 'regressed': 'Regression', 'unchanged': 'Unchanged'}
styles = {'improved': 'good', 'mixed': 'warn', 'regressed': 'bad', 'unchanged': 'neutral'}
cards = []
for index, c in enumerate(cases, 1):
    assessment = review['cases'][c['name']]
    if assessment['status'] not in labels:
        raise ValueError('Unknown review status')
    photo = Image.frombytes('RGBA', (c['width'], c['height']), Path(c['path']).read_bytes()).convert('RGB')
    buf = io.BytesIO()
    photo.save(buf, 'JPEG', quality=90)
    url = 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()
    figures = []
    sides = [('original', 'Original detector · before PR', '#8a4cad'), ('current', 'Current PR default', '#c02c7f')]
    if has_previous:
        sides.append(('previousExperiment', 'Previous experiment · with color fusion', '#2863b3'))
    sides.append(('experimental', experiment_label + ' · not enabled', '#008866'))
    for side, label, color in sides:
        record = c[side]
        paths = ''.join('<path d="M' + ' L'.join(f"{p['x']:.2f},{p['y']:.2f}" for p in shape['outer']) + 'Z"/>' for shape in record['outline'])
        aids = ''.join('<polygon points="' + ' '.join(f"{p['x']:.2f},{p['y']:.2f}" for p in ring) + '" fill="#edb32822" stroke="#ac6e00" stroke-dasharray="5 4"/>' for ring in record.get('estimatedEdgeRegions', []))
        samples = c['previousSamples']['before'] if side == 'original' else c['previousExperimentSamples'] if side == 'previousExperiment' else c['samples'][side]
        timing = f'{round(statistics.median(samples))} ms'
        if side == 'original':
            caption = f'{timing} · historical measurement'
        else:
            fallback = record.get('refinement', {}).get('status') == 'fallback'
            method = 'Color fallback' if fallback else 'Learned outline'
            cleanup = 'cleanup applied' if record.get('cleanup', {}).get('applied') else 'detected boundary retained'
            caption = f'{timing} · {method} · {cleanup}'
            if side == 'previousExperiment':
                caption += ' · historical timing'
        figures.append(f'<figure data-side="{side}"><figcaption style="color:{color}">{label}<small>{caption}</small></figcaption><svg viewBox="0 0 {c["width"]} {c["height"]}" role="img" aria-label="{esc(c["title"] + " — " + label, quote=True)}"><image href="{url}" width="{c["width"]}" height="{c["height"]}"/>{aids}<g fill="none" stroke="{color}" stroke-width="2" stroke-linejoin="round">{paths}</g></svg></figure>')
    probes = c['audit']['probes']
    present_before = sum(p['before']['present'] for p in probes)
    present_after = sum(p['after']['present'] for p in probes)
    lost = [p['name'] for p in probes if p['before']['present'] and not p['after']['present']]
    gained = [p['name'] for p in probes if not p['before']['present'] and p['after']['present']]
    missing = [p['name'] for p in probes if not p['after']['present']]
    metrics = f'Annotated feature checks: {present_before}/{len(probes)} → {present_after}/{len(probes)} present. Contours: {len(c["current"]["outline"])} → {len(c["experimental"]["outline"])}.'
    if lost:
        metrics += f' Newly missing: {len(lost)} checks.'
    if gained:
        metrics += f' Newly covered: {len(gained)} checks.'
    if missing:
        metrics += f' Still missing in experiment: {len(missing)} checks.'
    negatives = c.get('featureAudit', {}).get('negativeProbes', [])
    if negatives:
        old_false = sum(p['beforeIncluded'] for p in negatives)
        new_false = sum(p['afterIncluded'] for p in negatives)
        metrics += f' Paper/recess points wrongly included: {old_false}/{len(negatives)} → {new_false}/{len(negatives)}.'
    current_ms = statistics.median(c['samples']['current'])
    experimental_ms = statistics.median(c['samples']['experimental'])
    delta = experimental_ms - current_ms
    timing_note = f'Full detection + automatic cleanup: {round(current_ms)} → {round(experimental_ms)} ms ({delta:+.0f} ms).'
    audit_note = assessment['note']
    if c.get('previousReviewStatus') == 'regressed' and not c['changed']:
        audit_note += ' The previous experiment’s regression is gone; this matches the current default exactly.'
    elif c.get('previousReviewStatus') == 'improved' and not c['changed']:
        audit_note += ' The improvement from the previous experiment is also lost.'
    if c.get('note') and c['name'] == 'deburring-tool-tight-region':
        audit_note += ' ' + c['note']
    research = c.get('research', {})
    # Metadata is escaped text, never executable HTML. Keep detailed candidate logs local.
    route = research.get('route', 'current result retained')
    evidence = assessment.get('evidence', '')
    paths_summary = ' '.join(f'{p["name"]}: {p["beforeCovered"]}/{p["samples"]} → {p["afterCovered"]}/{p["samples"]} sampled positions covered.' for p in c.get('featureAudit', {}).get('paths', []))
    diagnostics = f'<details><summary>Processing and comparison details</summary><p>{esc(evidence)}</p><p>{esc(paths_summary)}</p><p>Experimental decision: {esc(str(route))}. The same automatic line/curve cleanup follows both detections, with Editable curves off.</p><p>Current reconstruction stage: {statistics.median(c["samples"]["currentReconstruct"]):.1f} ms; experimental: {statistics.median(c["samples"]["experimentalReconstruct"]):.1f} ms. These stages are included in the total, not additional time.</p></details>'
    state = assessment['status']
    cards.append(f'<article id="photo-{index}" data-tool="{esc(c["toolId"], quote=True)}" data-status="{state}" data-changed="{str(c["changed"]).lower()}" data-loss="{str(bool(lost)).lower()}"><div class="title"><span>{index:02d}</span><h2>{esc(c["title"])}</h2><button class="enlarge" type="button" aria-pressed="false" title="Show larger outlines; on a phone, stack the comparisons">Enlarge</button></div><p><span class="badge {styles[state]}">{labels[state]}</span></p><p class="note">{esc(audit_note)}</p><p class="meta">{esc(timing_note)}<br>{esc(metrics)}</p><div class="comparison">'+''.join(figures)+f'</div>{diagnostics}</article>')

css = '''*{box-sizing:border-box}body{margin:0;background:#f4f6f8;color:#172431;font:16px/1.55 system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:36px 24px}header{max-width:900px;margin-bottom:28px}h1{font-size:clamp(30px,5vw,44px);line-height:1.12;letter-spacing:-.025em;margin:12px 0 20px}h2{font-size:22px;line-height:1.25;margin:0}.eyebrow,.meta{font-size:13px;color:#526271}.eyebrow{text-transform:uppercase;letter-spacing:.07em}a{color:#17619c}nav{display:flex;gap:14px;align-items:end;flex-wrap:wrap;margin:24px 0}button,select{background:white;border:1px solid #c4cfd8;border-radius:5px;padding:6px 12px;color:#23394c;font:inherit;cursor:pointer}nav label{display:flex;flex-direction:column;gap:6px;max-width:100%}nav label.toggle{display:block;padding-bottom:6px}select{max-width:100%}article{background:white;border:1px solid #d8dfe5;border-radius:9px;padding:22px;margin:24px 0;scroll-margin-top:16px}.title{display:flex;align-items:center;gap:12px}.title span{color:#7a8793;font-variant-numeric:tabular-nums}.title button{margin-left:auto;font-size:13px}.meta{margin:0 0 18px}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;min-width:0;background:#e9edf1}figure[data-side=original],figure[data-side=previousExperiment]{display:none}.show-original figure[data-side=original],.show-previous figure[data-side=previousExperiment]{display:block}.show-original .comparison,.show-previous .comparison{grid-template-columns:1fr 1fr 1fr}figcaption{padding:10px 12px;font-size:14px;font-weight:650;background:#f7f9fa}figcaption small{display:block;font-size:12px;color:#526271;font-weight:400;margin-top:4px}svg{width:100%;height:540px;display:block}svg path,svg polygon{vector-effect:non-scaling-stroke}article.enlarged{position:relative;margin-left:calc((100% - min(96vw,1700px))/2);width:min(96vw,1700px)}article.enlarged svg{height:78vh}details{background:#edf1f5;border-radius:7px;padding:12px 16px;margin:18px 0 0;font-size:14px}summary{cursor:pointer;font-weight:600}.banner{border:1px solid #d7ba67;background:#fff7dc;padding:14px 18px;border-radius:8px}.badge{display:inline-block;padding:3px 9px;border-radius:4px;font-size:13px;font-weight:650}.good{background:#def0e5;color:#17593c}.warn{background:#fff1c9;color:#6e4e00}.bad{background:#fce2e3;color:#872328}.neutral{background:#e8edf2;color:#435363}.summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.summary-grid div{border:1px solid #d8dfe5;background:white;border-radius:6px;padding:12px}.summary-grid b{display:block;font-size:25px}.small,footer{color:#526271;font-size:13px;overflow-wrap:anywhere}footer{margin-top:32px}article[hidden]{display:none}@media(max-width:700px){main{padding:24px 12px}article{padding:14px}.title{flex-wrap:wrap}h2{font-size:19px}.comparison,.show-original .comparison{gap:8px}svg{height:360px}figcaption{font-size:12px;padding:8px;min-height:110px}figcaption small{font-size:11px}article.enlarged{margin-left:0;width:auto}article.enlarged .comparison{grid-template-columns:1fr}article.enlarged svg{height:78vh}.summary-grid{grid-template-columns:1fr 1fr}.show-original .comparison,.show-previous .comparison{grid-template-columns:1fr}nav{align-items:start}nav label{width:100%}}'''
summary = ''.join(f'<div><b>{counts[k]}</b>{label}</div>' for k, label in [('improved', 'Improved'), ('mixed', 'Mixed'), ('regressed', 'Regressed'), ('unchanged', 'Unchanged')])
options = ''.join(f'<option value="photo-{i}">{i:02d} · {esc(c["title"])}</option>' for i,c in enumerate(cases,1))
page = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pocketry · Full experimental outline comparison</title><style>'+css+'</style><main>'
page += '<header><p class="eyebrow">Pocketry · 6 November 2026 · research evaluation</p><h1>'+esc(results.get('reportTitle', 'Current outlines versus the combined experiment'))+'</h1><p class="banner"><b>Report-only prototype.</b> The experiment is not enabled in the preview app. The app still uses the current PR default.</p><p>All <b>36 distinct tools and attachments</b> on white Pocketry sheets, one selected region per subject. Current defaults appear in magenta and the experiment in green. “Extra comparison” can add an earlier result.</p><p>'+esc(results.get('methodSummary', 'The experiment combines raw and repaired edge regions, a finer bounded sensitivity search, guarded foreground evidence, and local preservation checks.'))+' Every subject uses the same rules and automatic point cleanup. No manual outline edits or per-photo tuning are used.</p></header>'
page += '<div class="summary-grid">'+summary+'</div>'
page += f'<p>{changed} final outlines changed; {len(cases)-changed} stayed identical. Foreground checkpoints show new coverage in {gain_cases} of the 36 subjects and new losses in {loss_cases}. These checks do not establish correct recesses or exclude shadows; visual review supplements them.</p>'
current_median = statistics.median(statistics.median(c['samples']['current']) for c in cases)
experimental_median = statistics.median(statistics.median(c['samples']['experimental']) for c in cases)
page += f'<p>Median per-tool desktop time: <b>{current_median / 1000:.2f} → {experimental_median / 1000:.2f} seconds</b>. Per-tool timings below include unchanged results that became slower. Phone performance remains untested.</p>'
page += '<p>'+esc(review['summary'])+'</p>'
if has_previous:
    old = results['previousReviewCounts']
    page += f'<p class="small">Previous experiment with color fusion: {old["improved"]} improved, {old["mixed"]} mixed, {old["regressed"]} regressed, {old["unchanged"]} unchanged. Classifications compare each experiment against the current default.</p>'
extra_options = '<option value="none">None · current vs experiment</option>'
if has_previous:
    extra_options += '<option value="previous">Previous experiment · with color fusion</option>'
extra_options += '<option value="original">Original detector · before PR</option>'
page += '<nav aria-label="Comparison controls"><label for="photo-select">Jump to tool<select id="photo-select"><option value="">Choose a tool</option>'+options+'</select></label><label for="filter">Show<select id="filter"><option value="all">All 36 subjects</option><option value="changed">Changed results</option><option value="warnings">Mixed results and regressions</option><option value="loss">New annotated feature losses</option></select></label><label for="extra-comparison">Extra comparison<select id="extra-comparison" title="Add one historical result using the identical photo crop">'+extra_options+'</select></label></nav>'
page += ''.join(cards)
page += '''<details><summary>Method, timing and limitations</summary><p>Current means the unchanged application implementation at <code>5ce47e25</code>. Experimental means an isolated evaluation-only selector; it is not imported by the app. Both receive identical perspective-corrected crop pixels, calibration, reference-strip regions, Auto sensitivity and default smoothing. The deburring tool’s support wire is excluded by the same close region on both sides. Each Wiha from the group photo is selected individually. Reference-strip estimates are marked amber.</p><p>Current and experimental times are medians of three fresh full detections, including TEED inference, reconstruction, any color fallback and automatic line/curve cleanup. Runs alternate order on the same desktop using Node 22 and the shipped OpenCV CPU/WASM. Runtime initialization, model download, photo loading and calibration are excluded. Inference is not reused between measured runs. Original-detector and previous-experiment times are retained historical measurements from earlier runs and are labeled accordingly; only the current default and new experiment were timed together in this run.</p><p>Additional checks replayed 115 cached views; all 36 fresh experimental outputs matched those replays exactly. The report’s findings combine those checks with visual review; preserving sampled foreground does not prove the boundary is correct. A synthetic unseeded thin shaft remains a known failing case. These checks do not qualify the prototype for adoption.</p><p>These are desktop measurements. Phone performance, peak memory and physical fit remain untested. The experimental policy was frozen before this full comparison. Development photos overlap the evaluation set, so this is not a held-out accuracy benchmark. Added probes check named features at specific locations, not exact widths or the entire boundary. Visual review and explicit missing-feature checks supplement contour counts and overlap metrics.</p><p>Unsupported experimental proposals retain the existing result; the report does not replace them with individually chosen diagnostic successes. Brighter material can remain confused with paper, attached printing can remain visible, and transparent parts or unseeded tips remain unresolved. A successful curve fit does not establish a correct silhouette.</p></details>'''
page += '<footer><a href="/">Open Pocketry · current default</a> · <a href="https://github.com/wcscr/pocketry/pull/226">PR #226</a><p>Dependencies and shipped third-party assets: none added or changed. Report crops are maintainer-provided photos with EXIF metadata removed. Detailed research records remain local.</p></footer></main>'
page += '''<script>const filter=document.getElementById('filter');function applyFilter(){for(const a of document.querySelectorAll('article'))a.hidden=filter.value==='changed'?a.dataset.changed!=='true':filter.value==='warnings'?!['mixed','regressed'].includes(a.dataset.status):filter.value==='loss'?a.dataset.loss!=='true':false}filter.addEventListener('change',applyFilter);document.getElementById('photo-select').addEventListener('change',e=>{if(e.target.value){filter.value='all';applyFilter();location.hash=e.target.value}});document.getElementById('extra-comparison').addEventListener('change',e=>{document.body.classList.toggle('show-original',e.target.value==='original');document.body.classList.toggle('show-previous',e.target.value==='previous')});for(const b of document.querySelectorAll('.enlarge'))b.addEventListener('click',()=>{const a=b.closest('article'),on=a.classList.toggle('enlarged');b.textContent=on?'Normal size':'Enlarge';b.setAttribute('aria-pressed',String(on))});</script></html>'''
Path(sys.argv[3]).write_text(page)
print(sys.argv[3])
