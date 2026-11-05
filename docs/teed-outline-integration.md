# Learned outer outlines and curves

Local implementation and evaluation, 2026-11-05. This record does not claim deployment or phone qualification.

In Trace, select a region with white paper around the entire tool, then enable **Learned outer outline** in Outline settings. It is off by default. The setting is retained in browser recovery and across photo changes. This mode fills interior lettering/reflections as material and disables interior-hole detection. Use color detection when actual holes are needed. Re-detection asks before replacing manual edits, and Undo retains the previous outline.

The crop is drawn directly from original photo pixels into a canvas capped at 1024 pixels on its longest side. It respects the current rotation and perspective/alignment transform. It does not allocate a full-resolution temporary image. Detection coordinates map back per axis into the existing working image; calibration, photo-relative placement and the single export conversion stay in that frame.

## Edge map to silhouette

The worker imports a fixed 512 × 512 FP32 TEED graph through the already shipped OpenCV DNN runtime. The optional model is 248,782 bytes. No npm dependency or second inference runtime is added. Input uses letterboxed BGR byte values minus the upstream channel means, without division by 255. Replicated borders avoid a synthetic padding edge.

Thresholded learned edges form barriers. One model-pixel morphological closing repairs small gaps; exterior white paper floods from the selection border. Enclosed regions with color-mask support become candidate tools, including reflective shafts beyond the old color mask. Unsupported print/edge islands are removed. A class-preserving interpolation kernel softens pixel crossings without cutting new background slits into the filled mask. The existing interpolating tracer, smoothing, simplification and normalization then produce editable rings. This does not use a convex hull or invent a smooth contour across large open gaps.

A selection with no supported enclosure or nearly full foreground retains the normal color pipeline, including guarded GrabCut and its topology checks. A mask clipped at opposite selection sides is rejected as too tight. A learned result that splits an existing connected silhouette into more outer components is also rejected. This guard can conservatively reject real details; acceptance is not an accuracy certificate. Missing/corrupt model assets or unavailable DNN retain color detection and surface a notice. Alpha silhouettes remain authoritative. Recognized occlusion carriers skip learned reconstruction.

The sensitivity control changes the edge-barrier threshold; a lower barrier threshold admits more edge evidence. Detail/smoothing reuse the dense polygon cache. Sensitivity adjustments reuse a single exact-byte BGR frame/edge cache, rebuilding the mask without inference. The worker retains one net; it releases per-inference Mats in `finally`, disposes the net on errors, and terminates after 30 seconds idle. Cancellation/supersession terminates synchronous WASM work. Model loading has exact size and SHA-256 checks before import.

## Editable curves

Learned detection produces a polygon. Curve fitting remains explicitly opt-in: **Edit Contour → Edit curves (prototype) → Auto-fit contour → Apply fit**. Keep Trace margin at zero. The preview has an adjustable maximum deviation and preserves sharp corners. Apply is one undoable edit; rejected previews do not change the source. Handles survive Trace recovery, separate pocket/hole transfer with photo positions, Bin revisions, and project backups. Project schema 60 accepts schema 59 and earlier supported files; Trace draft schema 2 accepts schema 1.

The fitting bound is against the current polygon, not the photograph. A tight bound and corner preservation can leave many anchors. Native cubic curves are retained in Trace SVG when no hole/material boolean is needed. Mesh/DXF paths use adaptive polygon samples. See [curve behavior, sampling and limitations](contour-curves-prototype.md).

## White-sheet evaluation and reproduction

The evaluation uses 19 existing white-sheet crops plus eight views cropped from original pixels first (27 views, not 27 distinct tools). Historical mat/checkerboard images are excluded. Compare color plus guarded GrabCut with TEED outer silhouettes, then preview explicit fitting at 0.6 input pixels. The same `outsideSilhouettes` function used by Trace removes holes/islands before fitting. Different input resolutions are not equivalent physical error bounds. No complete ground-truth masks are available.

Run with Node 22 from the repository root, supplying the local photo manifest rather than committing personal photo paths:

```
node --import tsx scripts/evaluate-teed-outline.ts CASES_JSON RESULTS_DIR [PREVIOUS_RESULTS_DIR]
python scripts/render-teed-report.py RESULTS_DIR REPORT_HTML BROWSER_VALIDATION_JSON
```

The manifest has `name`, `path` (RGBA bytes), `width`, `height`, and `group: "original"`; historical names contain `-mat-`. A PNG with the same stem supplies the report photo. The evaluator makes three sequential corpus passes, evicting its single-frame cache between fresh inferences, then measures one cached reconstruction per pass. Model import and OpenCV initialization are listed separately. The renderer embeds every before/after image, native cubic preview, acceptance/fallback status, point/anchor counts, timing samples and visual review notes in one offline HTML file.

When previous results are supplied, the report also retains previous-TEED/corrected-TEED overlays for every view. Reconstruction timing is included separately within total learned-detection time.

Per-view timing records, browser validation and observed limits accompany this document in `photo-refinement-evaluation/teed-integration/`. Mac CPU/WASM timings do not establish iPhone/Android speed or memory. WASM heap capacity is reported separately from live allocation/RSS. The browser retains a separate 128 MiB calibration heap alongside the detection worker; this cost must be included in phone qualification. Review tiny shafts, tool tips, cast shadows and sheet markings manually. Slicer and physical fit checks remain separate.

## General soft-mask correction

A maintainer screenshot exposed a long doubled-back segment on the airduster handle. Stage-by-stage reproduction showed that the filled mask was continuous; the artifact appeared in the score-field conversion, before polygon simplification or cubic fitting. The old interior/exterior distance blend had a hard three-model-pixel cutoff. A four-pixel-wide learned edge band could become foreground/background/foreground across its width, creating an artificial slit and an outer sliver. The existing corner preservation then retained the false sharp turns.

The replacement uses the same symmetric separable `[1, 6, 1]` interpolation kernel for every image. Its center weight is 36/64 (>1/2), so every original foreground sample remains above iso 128 and every background sample remains below it, including single-pixel features. This is a general class-preservation rule, not a coordinate, tool category or preferred-direction heuristic. The changing-thickness regression runs at all four quarter-turns, alongside recess, gap, shaft and multiple-object tests.

The existing tolerance-based straight-line simplification now operates on a coherent silhouette. No extra inference model, convex hull, symmetry, global line detection or forced straightening is added. The airduster polygon drops from 44 to 32 points (41 to 29 fitted anchors), the crop-first Ryobi from 171 to 94 points, and close Gerber from 149 to 92 points. The same 22/27 views pass learned reconstruction guards; curve previews improve from 25/27 to 26/27. The stapler retains its rejected curve preview and original polygon. All 27 unchanged white-sheet inputs were re-evaluated, including all existing fallbacks, and visually compared with the prior TEED result.

The correction follows the filled mask rather than the previous edge-centering heuristic. It therefore changes boundary placement slightly: the median enclosed-area change over accepted views is +4.0% (maximum +10.5%), recorded per view as a diagnostic, not a quality score. Thin-shaft masks can show larger relative area changes. No ground-truth dimensional validation is available, and remaining model-edge/shadow spurs need review. Future line/curve recognition should use an explicit deviation bound and preserve genuine corners and recesses; fewer vertices alone is not a success criterion.

## Updated measurements

Mac arm64 Node 22 CPU/WASM, three sequential corpus passes: median per-view color total **71.3 ms**, fresh learned total **867.2 ms**, cached learned total **45.8 ms**, reconstruction inside that total **15.5 ms**, and curve fitting **0.3 ms**. OpenCV initialization was 121.2 ms; the first learned call including model import was 990.2 ms. Chrome 156’s separate single corpus pass measured medians of **750.7 ms** fresh, **33.0 ms** cached and **11.2 ms** reconstruction. These are separate local runs, not a controlled speedup comparison with the earlier build or phone timings.

Observed worker WASM capacity remains **265.5 MiB**, with **128 MiB** in the separate main-thread calibration runtime. Model download and inference architecture are unchanged. The combined heap-capacity caveat and unmeasured phone behavior still apply.

## Dependency and provenance review

For the soft-mask follow-up, dependencies and third-party assets: **None added or changed**. The interpolation code and synthetic regression are original Pocketry work.

Only the fixed TEED ONNX model and upstream MIT license are added; no npm dependency/transitive version changes. TEED source revision `40fa4b1391dc6424f88989d0ca75d5b592c8681d` distributes `checkpoints/BIPED/5/5_model.pth` alongside its MIT license (copyright 2022 Xavier Soria Poma). It provides no separate weights license or model card. The integration relies on that repository-level license; it does not imply a separate audit of training-data rights. No dataset or Python implementation is redistributed. MIT permits AGPL and proprietary integration with retained attribution; it does not expand third-party rights through Pocketry's CLA. Full license, source/checkpoint/export hashes and conversion details are in `NOTICE` and the served model license. Generated `NOTICE.txt` must retain this section in the production build.

## Local verification

- Soft-mask follow-up: `npm run check && npm test -- --maxWorkers=4`: 220 files, 3,487 tests passed on Node 22; `npm run build` and `git diff --check` passed. The full workflow and CAD suites below passed for the preceding integration; this follow-up changes only detector reconstruction and diagnostic reporting, and does not rerun those unchanged paths.
- `npm run test:workflows -- --maxWorkers=2`: all 18 files, 611 tests passed. An initial asynchronous focus-scope teardown error was isolated; the affected export workflow and the final complete workflow run both passed cleanly.
- `npm run test:geometry`: all 25 files, 329 tests passed (325 seconds).
- `npm run build` and `git diff --check`: passed. The emitted model matches the pinned SHA-256; `dist/public/NOTICE.txt` contains the complete TEED MIT notice and the model license is served separately.
- Real Chrome source and compiled-production checks, serialized SVG/STL inspection, and the 27-view offline/browser evaluations are described above. No hosted CI was run. No publication/deployment, phone run, slicer check or physical print is claimed.


Follow-up browser verification covered re-detection, explicit 0.3 mm curve preview, Apply, one-step undo/redo and handle recovery. At the synthetic ruler's default 0.1 mm bound, no curve change was needed; the disabled Apply button was verified as the expected no-op. The source and compiled production UI both passed at the explicit preview setting. The resulting SVG retained six cubic edges; the binary STL had 440 triangles, positive signed volume and two faces on every undirected edge. These are workflow/serialization checks with a synthetic ruler, not physical-fit qualification.
