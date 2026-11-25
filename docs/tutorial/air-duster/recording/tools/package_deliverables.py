"""Collect the revised capture and its verified, replaceable output artifacts."""
from pathlib import Path
import json,shutil,hashlib
r=Path('/private/tmp/pocketry-tutorial-revision-20260915');take=r/'final-take';d=r/'deliverables';rec=d/'recording'
for name in ['originals','checkpoints','frames','exports','tools','qa']:(rec/name).mkdir(parents=True,exist_ok=True)
for name in ['continuous-original.webm','marks.json','downloads.json']:shutil.copy2(take/name,rec/'originals'/name)
for f in take.glob('checkpoint-*.json'):shutil.copy2(f,rec/'checkpoints'/f.name)
for f in take.glob('*.png'):shutil.copy2(f,rec/'frames'/f.name)
for pattern in ['*.stl','*.3mf','*multicolor*.pocketry.json']:
 for f in take.glob(pattern):shutil.copy2(f,rec/'exports'/f.name)
for f in ['capture.mjs','serve-preview.mjs','trace-editor.mjs','bin-job.js','fit-job.js','finish-job.js','render_video.py','verify_final.py','qa_video.py','package_deliverables.py']:shutil.copy2(r/f,rec/'tools'/f)
for f in take.glob('trace-*.json'):shutil.copy2(f,rec/'qa'/f.name)
for src,dst in [('final-geometry-verification.json','geometry-verification.json'),('video-verification.json','video-verification.json'),('served-build-verification.json','served-build-verification.json')]:shutil.copy2(r/src,rec/dst)
for f in ['check.log','tests.log','build.log']:shutil.copy2(r/f,rec/'qa'/f)
for name in ['contact-sheet.jpg','calipers-depth.png','usb-caption.png','cross-section-actual.png']:shutil.copy2(r/'final-video-qa'/name,rec/'qa'/name)
g=json.loads((r/'final-geometry-verification.json').read_text());v=json.loads((r/'video-verification.json').read_text());timeline=json.loads((d/'timeline.json').read_text())
length=f"{int(v['durationSeconds'])//60}:{int(v['durationSeconds'])%60:02}"
readme=(d/'README.md').read_text();readme=readme.replace('The video is silent,',f"The {length} video is silent,");(d/'README.md').write_text(readme)
notes='''# Recording production notes

## Capture

This revision follows the September 15 feedback. It uses headless Playwright with an isolated Chrome context, a dedicated local preview, real UI gestures, and actual downloads. No visible browser, desktop capture, user browser profile, or system cursor is used.

The complete video comes from one continuous take and one newly created Air Duster Tutorial project. Numbered segments are cuts of that same take. No project restoration or finished-layout substitution occurs during the capture. The three edited tool shape IDs remain unchanged in all later project checkpoints.

The source recording is 25 fps; the final 1440 × 900 encode is 30 fps and contains no audio. Accelerated sections are labeled. Ruler results, fit-check export, the photo placeholder, warnings, inspection, and final export remain at normal speed.

## Contour preparation and UI edits

The supplied editable geometry is an internal production reference only. Its shape is mapped to each detected photo contour's original bounding box, so the first Trace editing session corrects shape without applying the later overall sizing correction. A 0.12 mm simplification tolerance removes redundant reference vertices while preserving the shape extrema. Planned deletions, moves, and additions are executed through the real point-editing UI. No outline coordinates or application state are injected.

Each tool has one Edit points session: duster 46 → 31 points, adapters 66 → 57, nozzle 33 → 22. The video does not enter the Bin contour editor. Later sizing uses independent width and length fields. Captions and the viewer guide refer to the real tools, measurements, and physical fit checks; they do not mention the private production reference.

## Inputs

Only three photographic inputs are imported: air-duster.jpg, adapter-stack.jpg, and angled-nozzle.jpg. All use the detected sheet calibration. Corrected-image regions are (265,260)–(700,950), (330,335)–(530,885), and (320,515)–(560,785), respectively, in an 865 × 1119 image. Detail is 3 px, smoothing is off, and Trace margin is 0 mm. Adapter sensitivity is −24.

USB Cable is created through Finger access as a flat-ended, flat-bottom slot. It is not a traced photo or imported outline. The final project contains three traced cutouts and three Finger access objects: the cable pocket and two lifting scoops.

## Fit-check sequence

The duster is measured once at three locations: vertical at 55.63% of width, handle at 51.65% of height from the top, and head at 15% of height. The recorded readings are retained in timeline.json. All three traced tools are sized next, followed immediately by fit-check export.

Tool outlines checks the three traced cutouts. Full surface includes the cable slot. These early exports precede the two later lifting scoops. Both actual STL downloads are retained. Physical fit and seating depth remain unverified until checked with the real tools.

Segment 09 is the replaceable photo insert. It explicitly says PLACEHOLDER / Fit-check photo / Photo with the real tools to be added. Replace this segment with the user's actual image while retaining the physical-fit captions, then regenerate the master, chapter timing, and captions. Do not fabricate a fit-check photograph.

## Files and replacement workflow

- originals/: full continuous browser recording, source timing, and download list.
- segments/: numbered chapter videos.
- checkpoints/: read-only project/library snapshots from this same recording.
- frames/: captured UI evidence and placeholder card.
- exports/: actual two fit-check STL files, completed multicolor bin, and editable project.
- tools/: capture, gesture planning, assembly, and verification sources. Runtime paths refer to the original local recording environment; adjust them to reuse elsewhere. Start serve-preview.mjs before capture.mjs.
- qa/: contour plans/results, full test logs, and sampled video contact sheet.
- geometry-verification.json: shape comparison, dimensions, project lineage, and mesh/package checks.
- video-verification.json: duration, frame rate, audio, caption spelling, decoding, motion samples, and video hash.
- served-build-verification.json: hashes proving the isolated preview matches the current production build.

The prior tutorial and its production files were preserved before replacing the current deliverables in /private/tmp/pocketry-tutorial-revision-20260915/previous-version/.

## Application checks

No application code or dependency changes were required. Application source matches commit 3b72a380b6d24e0213194b34138f4e359fcf48b1; tutorial baseline is abd16087d71e2c3dc67576c9ebdfb7a5edd122bb. Type check, all 83 test files / 1,417 tests, and production build passed. Tests ran with local loopback permission. The build reports its existing large-bundle advisory.
'''
(rec/'PRODUCTION-NOTES.md').write_text(notes)
report=f'''# Tutorial verification

Revised September 15, 2026.

- **Video:** {length}, 1440 × 900, 30 fps, no audio; full decode passed.
- **Workflow:** One newly created project; three real photo imports; one initial contour-editing session per tool; no later contour replacements.
- **USB cable:** Created and named through Finger access; no cable image used.
- **Sizing:** Three ruler measurements total, then independent X/Y sizing and immediate fit-check export.
- **Fit check:** Two actual downloads, Tool outlines and Full surface. A clearly labeled photo placeholder follows the exports.
- **Depth guidance:** Captions instruct viewers to measure each real tool and use calipers. The duster floor-color warning clears after the shown depth change.
- **Captions:** American English spelling scan passed; no mention of the private production reference.
- **Project:** Three traced cutouts and three Finger access objects; shape IDs remain consistent across later checkpoints.
- **Exports:** Both 1.2 mm fit-check meshes were parsed; the final bin package and mesh edge usage were checked; an editable project backup was downloaded.
- **Application:** Type check, 83 test files / 1,417 tests, production build, and matching served-build asset hashes passed.
- **Physical validation:** Pending. The placeholder will be replaced when the real-tool fit-check photo is supplied. The video does not claim physical fit or seating has been validated.

Video SHA-256: `{v['sha256']}`

Detailed evidence is retained in [production notes](recording/PRODUCTION-NOTES.md), [video verification](recording/video-verification.json), and [geometry verification](recording/geometry-verification.json).
'''
(d/'verification.md').write_text(report)
files=[]
for f in sorted(d.rglob('*')):
 if f.is_file():files.append({'path':str(f.relative_to(d)),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()})
(r/'deliverable-manifest.json').write_text(json.dumps(files,indent=2)+'\n')
print('Packaged',len(files),'files; video',length)
