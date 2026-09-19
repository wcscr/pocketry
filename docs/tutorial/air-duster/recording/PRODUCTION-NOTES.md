# Recording production notes

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
