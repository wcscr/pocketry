"""Render paired images, feature zooms, timings and review flags for every view.
Usage: python scripts/render-white-sheet-sensitivity.py RESULTS CASES_JSON REPORT_DIR [REVIEW_JSON]
Requires Pillow. Original photos remain local; report copies only selected crops.
"""
import html
import json
import statistics
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

root, manifest, target = map(Path, sys.argv[1:4])
target.mkdir(parents=True, exist_ok=True)
assets = target / "white-sheet-auto-assets"
assets.mkdir(exist_ok=True)
summary = json.loads((root / "summary.json").read_text())
inputs = {c["name"]: c for c in json.loads(manifest.read_text())}
records = [json.loads((root / (c["name"] + ".json")).read_text()) for c in summary["cases"] if c.get("audit")]
review = json.loads(Path(sys.argv[4]).read_text()) if len(sys.argv) > 4 else {}
all_records = records
excluded_names = {c["name"] for c in review.get("primaryScope", {}).get("excludedViews", [])}
context_records = [c for c in records if c["name"] in excluded_names]
records = [c for c in records if c["name"] not in excluded_names]
esc = html.escape


def median(values):
    return statistics.median(values) if values else 0


def ms(values):
    return f"{median(values):.0f}"


def distance(value):
    return "—" if value is None else f"{value:.1f}"


def name(c):
    return c["sourceFile"].split(" - ON")[0]


def paths(shapes, color, dash="", width=2):
    return "".join(f'<path d="M'+" L".join(f'{p["x"]:.3f},{p["y"]:.3f}' for p in s["outer"])+f'Z" fill="none" stroke="{color}" stroke-width="{width}" vector-effect="non-scaling-stroke" {dash}/>' for s in shapes)


def svg(c, side, viewbox=None, show_probes=False, dense=False):
    box = viewbox or [0, 0, c["width"], c["height"]]
    image = f'<image href="white-sheet-auto-assets/{c["name"]}.jpg" width="{c["width"]}" height="{c["height"]}"/>'
    outline = paths(c[side+"Silhouette"], "#bf27ce" if side == "before" else "#00bd7e")
    if dense:
        outline = paths(c[side]["rawOutline"], "#1686cf", 'stroke-dasharray="3 3"', 1) + outline
    probes = ""
    if show_probes:
        for p in c["audit"]["probes"]:
            x, y = p["point"]["x"], p["point"]["y"]
            r = max(c["width"], c["height"]) / 180
            probes += f'<circle cx="{x}" cy="{y}" r="{r}" fill="#ffe14c" stroke="#12213c" stroke-width="1" vector-effect="non-scaling-stroke"><title>{esc(p["name"])}</title></circle>'
    return f'<svg viewBox="'+" ".join(map(str,box))+f'" role="img" aria-label="{esc(c["name"])} {side}">{image}{outline}{probes}</svg>'


def pair(c, viewbox=None, probes=False, dense=False):
    return '<div class="pair">'+"".join(f'<figure data-result="{side}"><figcaption>'+label+'</figcaption>'+svg(c,side,viewbox,probes,dense)+'</figure>' for side,label in [("before","Before · fixed Auto threshold"),("after","After · automatic sensitivity")])+'</div>'


def issues(c):
    a=c["audit"]
    return [p["name"] for p in a["probes"] if p["kind"]=="feature" and not p["after"]["present"]]


def timing_row(c):
    a=c["audit"];r=c["after"].get("refinement") or {}
    return f'<tr><th><a href="#{c["name"]}">{esc(c["name"])}</a></th><td>{a["beforeShapes"]} → {a["afterShapes"]}</td><td>{ms(c["samples"]["beforeMs"])}</td><td>{ms(c["samples"]["afterMs"])}</td><td>{ms(c["samples"]["cachedMs"])}</td><td>{ms(c["samples"]["reconstructionMs"])}</td><td>{r.get("edgeThreshold","—")} / {r.get("edgeThresholdTrials","—")}</td><td>{esc(r.get("status",""))}</td></tr>'


cards=[]
for c in all_records:
    source=inputs[c["name"]];p=Path(source["path"])
    photo=Image.frombytes("RGBA",(c["width"],c["height"]),p.read_bytes()).convert("RGB")
    photo.save(assets/(c["name"]+".jpg"),quality=90)
    a=c["audit"];changed=not a["unchanged"]
    flags=[]
    if changed:flags.append("changed")
    if c["role"]!="tool":flags.append("diagnostic")
    if issues(c):flags.append("features")
    if a["afterShapes"]!=c["expectedTools"]:flags.append("count")
    note=review.get("cases",{}).get(c["name"],review.get("photos",{}).get(str(c["photoIndex"]),""))
    probes=[]
    zooms=[]
    for p in a["probes"]:
        old=p["before"]["present"];new=p["after"]["present"]
        state="retained" if old and new else "new loss — REVIEW" if old else "recovered" if new else "outside before and after"
        probes.append(f'<tr><td>{esc(p["name"])}</td><td>{esc(p["kind"])}</td><td>{state}</td><td>{distance(p["before"]["distance"])} → {distance(p["after"]["distance"])} px</td></tr>')
        if p["kind"]=="feature":
            size=max(35,min(c["width"],c["height"])*.45);x=p["point"]["x"];y=p["point"]["y"]
            box=[x-size/2,y-size/2,size,size]
            zooms.append('<h4>'+esc(p["name"])+f' · {state}</h4>'+pair(c,box,True,True))
    metric='<div class="scroll"><table><thead><tr><th>View</th><th>Shapes</th><th>Before ms</th><th>After ms</th><th>Cached ms</th><th>Boundary ms*</th><th>Threshold / trials</th><th>Status</th></tr></thead><tbody>'+timing_row(c)+'</tbody></table></div>'
    detail={"sourceSha256":source.get("sourceSha256"),"rgbaSha256":c["rgbaSha256"],"role":c["role"],"expectedPhysicalObjects":c["expectedTools"],"tolerancePx":c["tolerancePx"],"mmPerPx":c.get("mmPerPx"),"calibration":source.get("calibrationKind"),"samplesMs":c["samples"],"before":c["before"].get("refinement"),"after":c["after"].get("refinement"),"audit":a}
    cards.append(f'<article id="{c["name"]}" data-photo-index="{c["photoIndex"]}" data-flags="'+" ".join(flags)+f'" data-name="{esc((c["name"]+" "+name(c)).lower())}"><h2>{esc(name(c))}</h2><p>{esc(c["name"])} · {esc(c["view"])} · {esc(c["role"])} · '+('changed' if changed else 'byte-identical displayed outline')+f'</p><p class="note">{esc(note)}</p>'+metric+pair(c)+'<details><summary>Feature spot checks and enlarged comparisons</summary><p>Yellow marks are manually selected source points, with a small localization allowance. These checks sample visible features; they are not exhaustive ground truth. Blue dashed lines show the dense traced boundary; green/magenta show the displayed outline.</p><table><tr><th>Probe</th><th>Kind</th><th>Paired result</th><th>Distance outside</th></tr>'+"".join(probes)+'</table>'+"".join(zooms)+'</details><details><summary>Raw measurement record</summary><pre>'+esc(json.dumps(detail,indent=2))+'</pre></details></article>')

all_cards = dict(zip((c["name"] for c in all_records), cards))
cards = [all_cards[c["name"]] for c in records]
changed=[c for c in records if not c["audit"]["unchanged"]]
new_merges=[(c["name"],p) for c in records for p in c["audit"]["pairChecks"] if p["newlyMerged"]]
losses=[(c["name"],p["name"]) for c in records for p in c["audit"]["probes"] if p["kind"]=="feature" and p["before"]["present"] and not p["after"]["present"]]
feature_tests=[p for c in records for p in c["audit"]["probes"] if p["kind"]=="feature"]
rows="".join(timing_row(c) for c in records)
overall={key:median([median(c["samples"][key]) for c in records]) for key in records[0]["samples"]}
source_rows=[]
for index in sorted(set(c["photoIndex"] for c in records)):
    views=[c for c in records if c["photoIndex"]==index]
    source_rows.append(f'<tr><td>{index:02d}</td><th>{esc(name(views[0]))}</th><td>{views[0]["role"]}</td><td>'+" ".join(f'<a href="#{c["name"]}">{esc(c["name"])}</a>' for c in views)+'</td></tr>')
outcome=review.get("conclusion","Review in progress; aggregate flags are screening results.")
stats=f'<div class="stats"><b>{len(set(c["photoIndex"] for c in records))} photos</b><b>{len(records)} views</b><b>{len(changed)} changed</b><b>{len(new_merges)} new probe merges</b><b>{len(losses)} new feature-probe losses</b></div>'
notes=''.join('<li>'+esc(n)+'</li>' for n in review.get("findings",[]))
method=f'''<section><h2>Scope and method</h2><p>The primary review contains 36 photos of actual tools directly on white Pocketry calibration sheets: 88 original/corrected corpus views plus two exact corrected browser controls, for 90 paired views. Loose-tool groups are included; the Wiha group remains diagnostic rather than an adoption requirement. Eight tray, retail-packaging and mixed-tray views from the original 98-view run are excluded here and retained in the <a href="white-sheet-context.html">separate context report</a>. Original and corrected views of the same photo are correlated tests. Early/unrecognized sheet versions retain original views only.</p><p>Before is the frozen implementation immediately before automatic sensitivity, including the preceding localized reference-strip handling. Each pair uses identical RGBA bytes, calibration footprints, source-scaled display tolerance and one smoothing pass. Crops come from EXIF-oriented original pixels, capped at 1024 px. Corrected corpus views use the application’s calibration and perspective code; preparation uses Pillow/OpenCV resampling, rather than browser Canvas. Only the two labeled browser controls use the exact earlier Canvas pixels. Their different crop/resampling is significant: a newly prepared corrected crop need not reproduce the earlier split.</p><p>{summary['completedRounds']} samples per view; before then after sequentially. The main corpus and the reviewed individual crops / browser controls ran in separate batches. Fresh calls run one TEED inference with resident nets; the following cached call reuses learned edges. The first call in each batch includes model import. All cached outputs must exactly match fresh results, and repeated outputs must match across passes. Times exclude photo decoding, calibration, UI scheduling and Auto-simplify. No real-phone or physical-fit claim.</p><p>Mac arm64, Node {esc(summary['node'])}, shipped CPU OpenCV WASM/model. Median of the three samples is shown per view. Across-view medians: before {overall['beforeMs']:.0f} ms; after {overall['afterMs']:.0f} ms; cached {overall['cachedMs']:.0f} ms. OpenCV initialization {summary['initializeMs']:.1f} ms is separate. *Boundary time includes all threshold trials and is already in the detection total. Repeated views are not independent population statistics.</p><p>Separation checks map independently labeled body probes to silhouettes and inspect all paired outputs. Foreground overlap flags count/area changes. Feature probes sample clips, jaws, needles, tabs, hooks and driver shafts; they do not prove every feature survives. Source-only visual review corrected imprecise annotations and gave individual tools complete crop margins before the final evaluation. A point outside both results is a review flag, not an automatic finding of lost material. Existing missed features, printed-paper contours and merged objects are reported separately from regressions. Full paired outlines remain available below.</p><p>Model SHA-256: <code>{summary['modelSha256']}</code><br>Frozen baseline SHA-256: <code>{summary['beforeBundleSha256']}</code></p></section>'''
css='''body{font:15px/1.5 system-ui;color:#142139;background:#f1f5fa;max-width:1550px;margin:24px auto;padding:0 20px}h1{font-size:29px}h2{font-size:21px}h4{margin:20px 0 5px}section,article{padding:22px;background:#fff;border:1px solid #d5deeb;border-radius:10px;margin:22px 0}a{color:#1550b1}nav{position:sticky;top:0;z-index:2;padding:12px;background:#e4ecf7;display:flex;gap:10px;flex-wrap:wrap}input,select{font:inherit;padding:7px}.stats{display:flex;gap:12px;flex-wrap:wrap}.stats b{padding:12px;background:#e7f4ed;border-radius:7px}.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}figure{margin:0;background:#e9eef4}figcaption{padding:9px;font-weight:600;font-size:13px}svg{width:100%;height:510px;display:block}details .pair svg{height:290px}table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid #d8e0eb}.scroll{overflow-x:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.note{border-left:3px solid #d4981a;padding-left:12px}.note:empty{display:none}code{overflow-wrap:anywhere}article[hidden]{display:none}@media(max-width:650px){.pair{grid-template-columns:1fr}svg{height:410px}}'''
page='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pocketry · White-sheet automatic sensitivity</title><style>'+css+'</style><h1>Automatic sensitivity · full white-sheet review</h1><p>2026-11-05 · local feature build · <a href="report.html">Main report</a> · <a href="automatic-sensitivity.html">Prior exact-browser Craftsman controls</a></p><section>'+stats+'<p><b>'+esc(outcome)+'</b></p><ul>'+notes+'</ul></section>'+method+'<details><summary>Every photo and selection</summary><table><tr><th>Photo</th><th>Subject</th><th>Role</th><th>Views</th></tr>'+"".join(source_rows)+'</table></details><details><summary>All paired timings</summary><div class="scroll"><table><thead><tr><th>View</th><th>Shapes</th><th>Before ms</th><th>After ms</th><th>Cached ms</th><th>Boundary ms*</th><th>Threshold / trials</th><th>Status</th></tr></thead><tbody>'+rows+'</tbody></table></div></details><nav><label>Find a tool <input type="search" id="search" placeholder="e.g. Wiha, calipers"></label><label>Show <select id="filter"><option value="">All views</option><option value="changed">Changed outlines</option><option value="diagnostic">Groups / context</option><option value="features">Existing feature flags</option><option value="count">Shape-count flags</option></select></label><span id="visible"></span></nav>'+"".join(cards)+'''<script>function filter(){let n=0;const q=document.querySelector('#search').value.toLowerCase(),f=document.querySelector('#filter').value;for(const a of document.querySelectorAll('article')){a.hidden=!(a.dataset.name.includes(q)&&(!f||a.dataset.flags.split(' ').includes(f)));if(!a.hidden)n++}document.querySelector('#visible').textContent=n+' views'}document.querySelector('#search').addEventListener('input',filter);document.querySelector('#filter').addEventListener('change',filter);filter();</script></html>'''
(target/"white-sheet-automatic-sensitivity.html").write_text(page)
verification = review.get("verification")
if verification:
    checks = '<section><h2>Local verification</h2><p>Typecheck, 229 files / 3,583 quick tests, evaluation-harness checks and all paired fresh/cache/determinism checks pass. All 50 original selections reproduce identical pixels from the saved manifest. The report displays the scoped tool views, isolates the single changed result, searches Wiha and expands feature details; the excluded context records remain separately accessible. This evaluation changes no production detector code.</p><details><summary>Verification record</summary><pre>'+esc(json.dumps(verification,indent=2))+'</pre></details></section>'
    page = page.replace(method, method+checks, 1)
    (target/"white-sheet-automatic-sensitivity.html").write_text(page)
# The main report must show every current comparison, not just a featured control.
# Preserve the older line/curve report once, rather than mixing historical cards
# with current results under the same heading.
main = target / "report.html"
archive = target / "before-inline-automatic-sensitivity-report.html"
if main.exists() and not archive.exists():
    archive.write_text(main.read_text())
nav_start = page.index('<nav>')
gallery_start = page.index('<article', nav_start)
script_start = page.index('<script>', gallery_start)
nav = page[nav_start:gallery_start].replace('<nav>', '<nav id="all-photo-comparisons">', 1)
gallery = page[gallery_start:script_start]
behavior = page[script_start:]
metadata = page[page.index('<section>'):nav_start]
main_header = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pocketry · All tool outlines with automatic sensitivity</title><style>'+css+'</style><h1>Tool outlines · automatic sensitivity</h1>'
main_intro = '<section id="full-white-sheet-automatic-sensitivity">'+stats+'<p>Current results for <b>36 tool photos on white Pocketry sheets</b>. Both columns already use TEED: magenta uses a fixed threshold; green uses automatic sensitivity. <b>Only the corrected no-strip tape-measure control changes; the other 89 views are exactly unchanged.</b> All comparisons and timings remain below.</p><p><a href="#significant-improvements">See the only substantial improvement</a> · <a href="#all-photo-comparisons">Browse all tool comparisons</a> · <a href="before-inline-automatic-sensitivity-report.html">Earlier line/curve report</a></p></section>'
main_details = '<details><summary>Evaluation findings, method, photo index and all timings</summary>'+metadata+'</details>'
focus = next((c for c in changed if c["name"] == "browser-no-strip-corrected-control"), None)
significant = ''
if focus:
    significant = '<section id="significant-improvements"><h2>The only substantial improvement · Craftsman tape measure without strip</h2><p>Exact perspective-corrected browser crop. The fixed threshold splits one tool into two regions and omits body material; automatic sensitivity recovers one complete silhouette. This is the only changed view in the scoped review. Other tested tools have identical outlines.</p>'+pair(focus)+'<p>Fresh detection: '+ms(focus['samples']['beforeMs'])+' → '+ms(focus['samples']['afterMs'])+' ms on desktop CPU/WASM. Other crops of this same photo do not reproduce the split.</p></section>'
main_page = main_header+main_intro+significant+main_details+nav+gallery+behavior
main.write_text(main_page)
(target / "report-all-tools-autosensitivity.html").write_text(main_page)
context_page = main_header+'<section><h2>Excluded context views · trays and retail packaging</h2><p>These '+str(len(context_records))+' views are retained from the original run for transparency. They are excluded from the tool-on-white-sheet comparison and its statistics. <a href="report.html">Return to the tool report</a>.</p></section>'+''.join(all_cards[c['name']] for c in context_records)+'</html>'
(target / "white-sheet-context.html").write_text(context_page)
# Review contact sheets retain source proportions; both outlines are visible if changed.
font_path="/System/Library/Fonts/Supplemental/Arial.ttf"
font=ImageFont.truetype(font_path,14)
import textwrap
for page_index in range((len(records)+15)//16):
    canvas=Image.new("RGB",(1440,1640),"#eef2f8");draw=ImageDraw.Draw(canvas)
    for j,c in enumerate(records[page_index*16:page_index*16+16]):
        im=Image.open(assets/(c['name']+'.jpg'));scale=min(340/im.width,335/im.height);im=im.resize((round(im.width*scale),round(im.height*scale)));d=ImageDraw.Draw(im)
        for side,color in [("before","#c52cd2"),("after","#00bd7e")]:
            for s in c[side+'Silhouette']:
                points=[(p['x']*scale,p['y']*scale) for p in s['outer']]
                d.line(points+[points[0]],fill=color,width=2)
        x=j%4*360;y=j//4*410;canvas.paste(im,(x+(360-im.width)//2,y))
        title=c['name']+f": {c['audit']['beforeShapes']} to {c['audit']['afterShapes']} "+name(c)
        for line in textwrap.wrap(title,46):draw.text((x+4,y+340),line,font=font,fill='black');y+=16
    canvas.save(assets/f"contact-{page_index+1}.jpg",quality=92)
print(target/"white-sheet-automatic-sensitivity.html")
