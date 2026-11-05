# Learned outer outlines and curves

Local implementation and evaluation, 2026-11-05. This record does not claim deployment or phone qualification.

In Trace, select a region with white paper around the entire tool, then enable **Learned outer outline** in Outline settings. It is off by default. The setting is retained in browser recovery and across photo changes. This mode fills interior lettering/reflections as material and disables interior-hole detection. Use color detection when actual holes are needed. Re-detection asks before replacing manual edits, and Undo retains the previous outline.

The crop is drawn directly from original photo pixels into a canvas capped at 1024 pixels on its longest side. It respects the current rotation and perspective/alignment transform. It does not allocate a full-resolution temporary image. Detection coordinates map back per axis into the existing working image; calibration, photo-relative placement and the single export conversion stay in that frame.

## Edge map to silhouette

The worker imports a fixed 512 × 512 FP32 TEED graph through the already shipped OpenCV DNN runtime. The optional model is 248,782 bytes. No npm dependency or second inference runtime is added. Input uses letterboxed BGR byte values minus the upstream channel means, without division by 255. Replicated borders avoid a synthetic padding edge.

Thresholded learned edges form barriers. One model-pixel morphological closing repairs small gaps; exterior white paper floods from the selection border. Enclosed regions with color-mask support become candidate tools, including reflective shafts beyond the old color mask. Unsupported print/edge islands are removed. A narrow-band distance blend places the contour near the middle of a thick edge band. The existing interpolating tracer, smoothing, simplification and normalization then produce editable rings. This does not use a convex hull or invent a smooth contour across large open gaps.

A selection with no supported enclosure or nearly full foreground retains the normal color pipeline, including guarded GrabCut and its topology checks. A mask clipped at opposite selection sides is rejected as too tight. A learned result that splits an existing connected silhouette into more outer components is also rejected. This guard can conservatively reject real details; acceptance is not an accuracy certificate. Missing/corrupt model assets or unavailable DNN retain color detection and surface a notice. Alpha silhouettes remain authoritative. Recognized occlusion carriers skip learned reconstruction.

The sensitivity control changes the edge-barrier threshold; a lower barrier threshold admits more edge evidence. Detail/smoothing reuse the dense polygon cache. Sensitivity adjustments reuse a single exact-byte BGR frame/edge cache, rebuilding the mask without inference. The worker retains one net; it releases per-inference Mats in `finally`, disposes the net on errors, and terminates after 30 seconds idle. Cancellation/supersession terminates synchronous WASM work. Model loading has exact size and SHA-256 checks before import.

## Editable curves

Learned detection produces a polygon. Curve fitting remains explicitly opt-in: **Edit Contour → Edit curves (prototype) → Auto-fit contour → Apply fit**. Keep Trace margin at zero. The preview has an adjustable maximum deviation and preserves sharp corners. Apply is one undoable edit; rejected previews do not change the source. Handles survive Trace recovery, separate pocket/hole transfer with photo positions, Bin revisions, and project backups. Project schema 60 accepts schema 59 and earlier supported files; Trace draft schema 2 accepts schema 1.

The fitting bound is against the current polygon, not the photograph. A tight bound and corner preservation can leave many anchors. Native cubic curves are retained in Trace SVG when no hole/material boolean is needed. Mesh/DXF paths use adaptive polygon samples. See [curve behavior, sampling and limitations](contour-curves-prototype.md).

## White-sheet evaluation and reproduction

The evaluation uses 19 existing white-sheet crops plus eight views cropped from original pixels first (27 views, not 27 distinct tools). Historical mat/checkerboard images are excluded. Compare color plus guarded GrabCut with TEED outer silhouettes, then preview explicit fitting at 0.6 input pixels. The same `outsideSilhouettes` function used by Trace removes holes/islands before fitting. Different input resolutions are not equivalent physical error bounds. No complete ground-truth masks are available.

Run with Node 22 from the repository root, supplying the local photo manifest rather than committing personal photo paths:

```
node --import tsx scripts/evaluate-teed-outline.ts CASES_JSON RESULTS_DIR
python scripts/render-teed-report.py RESULTS_DIR REPORT_HTML BROWSER_VALIDATION_JSON
```

The manifest has `name`, `path` (RGBA bytes), `width`, `height`, and `group: "original"`; historical names contain `-mat-`. A PNG with the same stem supplies the report photo. The evaluator makes three sequential corpus passes, evicting its single-frame cache between fresh inferences, then measures one cached reconstruction per pass. Model import and OpenCV initialization are listed separately. The renderer embeds every before/after image, native cubic preview, acceptance/fallback status, point/anchor counts, timing samples and visual review notes in one offline HTML file.

Per-view timing records, browser validation and observed limits accompany this document in `photo-refinement-evaluation/teed-integration/`. Mac CPU/WASM timings do not establish iPhone/Android speed or memory. WASM heap capacity is reported separately from live allocation/RSS. The browser retains a separate 128 MiB calibration heap alongside the detection worker; this cost must be included in phone qualification. Review tiny shafts, tool tips, cast shadows and sheet markings manually. Slicer and physical fit checks remain separate.

## Measured results

Final Mac arm64 Node 22 CPU/WASM run: **22/27 learned reconstructions accepted**, with five normal-color fallbacks. All 27 views have before/after overlays and per-view performance records; 25 curve previews pass the fitting guard. These counts are software acceptance, not a claim of 22 clean/accurate outlines. Two rejected fits (stapler and tiny Wiha 40 crop) retain their polygons.

Median of each view’s three-run medians: color + guarded GrabCut **60.5 ms**, fresh learned pipeline **747.7 ms**, cached learned reconstruction **73.2 ms**, explicit curve fitting **0.2 ms**. Initialization was 109.6 ms; first learned call including model import was 871.2 ms. Chrome 156 also ran one sequential pass over all 27 views through the real worker. The JSON records every sample; browser times are separate from Node measurements.

The five fallback views are the stapler, distant Gerber, original-pixel caliper crop and both five-driver Wiha group crops. The opposite-side crop guard is deliberately conservative: it can reject useful edge evidence when an enclosure reaches both selection sides. Expand the selection, especially for the caliper. The Wiha group crops connect through sheet printing and remain unsuitable for automatic multi-tool extraction; select each driver separately. The distant mouldline tip and wire-stripper shadow spur also need review despite acceptance. Larger source crops improve individual screwdriver shafts, but small spurs/jagged tips are not eliminated.

Observed detection-worker heap capacity reached **265.5 MiB**, alongside a **128 MiB** main-thread calibration heap in Chrome: about **393.5 MiB** of combined WASM capacity before photo/JS/other process memory. This is capacity, not live bytes or total RSS. No iPhone/Android memory or timing result is claimed. The tiny model download does not mean tiny runtime memory.

The browser checks include identical-frame caching, cancellation and retry, blocked-model fallback, applying a curve preview, one-step undo/redo, handle recovery after reload, and a compiled-production UI run. A real Trace SVG retained two cubic segments; the corresponding binary STL had 688 triangles and two incident faces on every undirected edge. A synthetic ruler length was used for workflow/export validation; that file is not a dimensionally calibrated manufacturing example.

## Dependency and provenance review

Only the fixed TEED ONNX model and upstream MIT license are added; no npm dependency/transitive version changes. TEED source revision `40fa4b1391dc6424f88989d0ca75d5b592c8681d` distributes `checkpoints/BIPED/5/5_model.pth` alongside its MIT license (copyright 2022 Xavier Soria Poma). It provides no separate weights license or model card. The integration relies on that repository-level license; it does not imply a separate audit of training-data rights. No dataset or Python implementation is redistributed. MIT permits AGPL and proprietary integration with retained attribution; it does not expand third-party rights through Pocketry's CLA. Full license, source/checkpoint/export hashes and conversion details are in `NOTICE` and the served model license. Generated `NOTICE.txt` must retain this section in the production build.

## Local verification

- `npm run check && npm test -- --maxWorkers=4`: 220 files, 3,483 tests passed on Node 22.
- `npm run test:workflows -- --maxWorkers=2`: all 18 files, 611 tests passed. An initial asynchronous focus-scope teardown error was isolated; the affected export workflow and the final complete workflow run both passed cleanly.
- `npm run test:geometry`: all 25 files, 329 tests passed (325 seconds).
- `npm run build` and `git diff --check`: passed. The emitted model matches the pinned SHA-256; `dist/public/NOTICE.txt` contains the complete TEED MIT notice and the model license is served separately.
- Real Chrome source and compiled-production checks, serialized SVG/STL inspection, and the 27-view offline/browser evaluations are described above. No hosted CI was run. No publication/deployment, phone run, slicer check or physical print is claimed.
