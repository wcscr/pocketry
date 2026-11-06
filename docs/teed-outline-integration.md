# Learned outer outlines and curves

Local implementation and evaluation, 2026-11-05. This record does not claim deployment or phone qualification.

## PR #226 review follow-up

Review of published head `1ac1b8f4` reproduced and fixed five regressions:

| Trigger | Before | After |
| --- | --- | --- |
| Add contour after opting into native curves | The new contour was rejected and its nonexistent index selected. | Append a straight contour to the native source, preserving existing handles and one-step Undo/Redo. |
| Edit a hole shared by overlapping pockets, using curves or point multiselect | Duplicate references could diverge into separate exclusions. | Propagate the authored edit to every shared reference, including different winding/start points and the first curve edit. |
| Touch editing interrupted by focus or source changes | A stale finger could make later touches look like a permanent pinch. | Cancel the edit and reset touch tracking. |
| Recover an Undo frame that was explicitly uncalibrated | The current ruler incorrectly controlled its curve sampling. | Restore the frame using its own calibration, retaining the uncalibrated default when appropriate. |
| Recover a large tool beside a small independent one, with weak paper evidence | In a synthetic case, the small tool fell below a percentage of the combined support and was absorbed. | Measure support relative to the smaller evidence region and reject that merge; already enclosed color patches can still recover together. |

Nine focused regression cases were added. Local typecheck/build, **239 quick
files / 3,756 tests**, and **18 workflow files / 627 tests** pass. Both original
Craftsman JPEGs pass compiled-Chrome Auto detection, point/native curve repair,
Cancel/Apply/Undo/Redo and calibration checks. Adding a contour after native
simplification also passes Undo/Redo without changing the existing handles.

A quality-only pass rechecks all **90 in-scope white-sheet views**, verifying
identical input hashes against the preceding Auto snapshots. Every dense and
displayed outline is **exactly unchanged**. The no-strip corrected browser
control still returns one outline at 0.57 after three trials. This recheck adds
no new timing benchmark: the paired comparisons and timing samples below remain
the recorded performance evidence. The Wiha and other documented limitations
remain. The small-neighbor merge is a synthetic regression test, not a claimed
improvement on a photographed case.

See `photo-refinement-evaluation/teed-integration/pr-review-verification.json`
and `pr-review-white-sheet-regressions.json` for the checks and per-view results.
The earlier 78 selected CAD/export tests below were not repeated for these
editing, recovery and detection-guard fixes. No physical-phone or physical-fit
qualification was added. GitHub CI remains disabled. Dependencies and third-party
source/assets: **None added or changed** in this review follow-up.

## Initial PR integration verification

Integration verification uses main `6b9eb60a`, app **1.9.0** and project schema
**61**. The new schema migrates main's version-60 label ownership and the earlier
version-60 curve previews. Local typecheck/build pass, with **239 quick files /
3,747 tests**, **18 workflow files / 627 tests**, and **3 selected geometry/export
files / 78 tests** (`bin-worker-handlers`, `pocket-color`, `sideways-pocket-color`).
Both original Craftsman JPEGs pass the compiled-browser Auto, point/native-curve
repair and Undo checks again. Pinned model bytes, served license and built NOTICE
are verified. Full earlier corpus evidence is retained rather than rerun for this
main integration. See `photo-refinement-evaluation/teed-integration/pr-integration-verification.json`.

In Trace, select a region with white paper around the entire tool, then choose **Tool edges · white sheet** under **Find the outline using** in Outline settings. Color contrast is the default. The choice is retained in browser recovery and across photo changes. This mode fills interior lettering/reflections as material and disables interior-hole detection. Use color detection when actual holes are needed. Re-detection asks before replacing manual edits, and Undo retains the previous outline.

The crop is drawn directly from original photo pixels into a canvas capped at 1024 pixels on its longest side. It respects the current rotation and perspective/alignment transform. It does not allocate a full-resolution temporary image. Detection coordinates map back per axis into the existing working image; calibration, photo-relative placement and the single export conversion stay in that frame.

## Interaction review build

The visible **Editable curves** switch is off by default for new point traces. Auto-simplify normally produces a finite-chord-bounded point outline; curved sections are approximated by points. Enabling the switch opts into native cubic reconstruction and curve handles. Existing saved curves load intact; switching off converts to the displayed adaptive points in one undoable edit. Undo restores the original handles. The preference follows new photos and draft recovery without changing project schema 61.

Symmetry & straighten is visible beside Auto-simplify. Native Left/Right symmetry splits cubic axis crossings and mirrors controls exactly. Average rebuilds editable curves from an adaptively sampled width profile; topology/complexity guards retain the original on failure. Straightening rotates every anchor/handle, ruler and photo frame together. Symmetry with optional upright rotation commits once, and Undo/Redo restores the curve source and calibration.

The UI-first review build passed 161 targeted tests, typecheck/build, and one actual Wolfbox compiled-browser workflow covering both representation modes, all symmetry choices, straightening, calibration, conversion and Undo. The later corpus review below evaluates automatic sensitivity; it does not repeat every interactive editing workflow on every photograph. Older curve evaluations remain historical evidence for the preceding curve-only default.

## Automatic sensitivity: full white-sheet corpus

The current report focuses on actual tools directly on white Pocketry sheets:
**36 photos / 90 views**, including two exact browser controls. Eight tray,
packaging and mixed-tray views from the complete run are retained separately and
excluded from the primary comparison. The loose ratchet crop remains included.
Both compared columns already use TEED. **Only the corrected no-strip tape-measure
control changes substantially; the other 89 in-scope views are exactly unchanged.**
The benefit is automatic recovery from an occasional weak-boundary failure; the
large general improvement over colour/GrabCut came from TEED, not this sensitivity
selection step. The report highlights that sole improvement with before/after
images. The complete original run and its scope are recorded below.

The expanded review covers **all 40 unique local photos named “ON Pocketry
sheet”**. Forty main selections plus ten individual-tool crops produce 50
original views; current paper calibration supplies another 46 corrected views.
Four early/unrecognized sheets retain original views only. Two exact corrected
Craftsman browser crops from the preceding review are retained as controls:
**98 paired views, still 40 photographs**. The corpus includes 82 single-tool
views, eight group views and six printed-tray/retail-packaging context views;
the two browser controls are reported separately. The five-driver Wiha group
is diagnostic, not an adoption requirement.

**Recommendation: keep conservative Auto.** All **96 corpus views** have
byte-identical dense and displayed outlines before/after. This establishes no
new tool merging or feature loss in those selections; it does not establish
perfect detection. The exact no-strip browser control still improves **two
fragments → one outline**, choosing 0.57 after three trials. The strip control
is unchanged. Newly prepared Craftsman crops already produce one outline before
Auto: different selections/resampling do not reproduce every earlier failure.

The Wiha group returns **8 / 9 shapes** in original/corrected views, with two
handles already joined, a missed shaft and fragmented edges. Auto preserves
that result. Of five complete individual crops, only the fifth returns a clean
single outline in both views; the other four fall back with extra fragments.
Printing near the ends and neighboring-tool context remain problematic. Advising
one-tool-at-a-time cropping is sensible, but it is not a complete fix for this
particular photo. The three separately photographed Wiha drivers still each
return one outline and retain the reviewed shaft/bit feature points.

The two needle tips and Wolfbox body/cone remain separate in their group views.
The small loose bit by the ratchet remains missed; the translucent plunger and
some transparent-tip crops retain existing incomplete boundaries. Reviewed fine
hook/bit points remain covered in their single-tool views. All
corpus comparisons and flagged feature zooms were reviewed. The report separates
these limitations from regressions; manually placed probes are spot checks,
not exhaustive contour ground truth. Source-only review corrected imprecise
markers and incomplete crop margins before final qualification. No photo-specific
runtime logic or detector changes were needed in this evaluation.

Each view has three sequential before/after/cached samples on desktop CPU/WASM.
Both versions receive identical pixels, recognized-aid footprints, source-scaled
display tolerance and one smoothing pass. Cached/fresh outputs match exactly;
outputs are deterministic across passes. Warm nets are reused, with one inference
per fresh image. Across the 82 single-tool views, median per-view detection is
**827 → 858 ms**, with **96 ms** cached. Across all 98 views: **837 → 877 ms**,
**108 ms** cached. The slowest single-tool view is the stand base (**1,578 ms**
after); the wide packaging context is **2,288 → 2,495 ms**. Per-view samples and
boundary-step times are retained. Calibration, decoding, UI scheduling and later
Auto-simplify are excluded. These measurements do not qualify a real phone or
physical fit.

Reproduction artifacts are `white-sheet-selections.json`,
`white-sheet-automatic-sensitivity-summary.json` and
`white-sheet-automatic-sensitivity-review.json` under
`photo-refinement-evaluation/teed-integration/`. The manifest records source hashes,
EXIF-oriented dimensions, selection bounds, physical-object labels and feature
points; photos remain private/local. `scripts/prepare-white-sheet-inputs.py`
checks source hashes and prepares original crops and calibration frames;
`scripts/prepare-white-sheet-perspective.ts` uses the application calibration and
perspective code. Corpus preparation uses Pillow/OpenCV resampling; only the two
labeled browser controls contain the exact preceding Canvas pixels.
`scripts/evaluate-white-sheet-sensitivity.ts` compares against the separately
retained frozen pre-Auto bundle (hash recorded in the summary).
`scripts/refresh-white-sheet-audits.ts` rechecks stored geometry after source-only
annotation review without changing outputs/timings, and
`scripts/render-white-sheet-sensitivity.py` produces the searchable HTML report,
paired outlines, enlarged feature comparisons and every view's timings. The
current working tree alone cannot recreate the frozen baseline or private photos.

The main HTML report directly displays all 90 in-scope before/after comparisons,
with automatic-sensitivity outlines in green and timings for every view. Eight
excluded context comparisons are retained in `white-sheet-context.html`. Earlier
line/curve comparisons are retained in a separately linked historical report.
Local
verification passes typecheck, **229 files / 3,583 quick tests**, the evaluation-harness checks in
`scripts/test-white-sheet-audit.ts`, three deterministic paired samples for every
view, report browser checks and `git diff --check`. No GitHub CI was enabled or
triggered. Dependencies and third-party source/assets: **None added or changed**.

## Earlier automatic sensitivity review: the same two Craftsman photos

With Tool edges selected, the existing **Auto** sensitivity now checks boundary
completeness on the same learned edge map. Already complete, coherent results
remain byte-identical. Missing foreground or fragments sharing continuous colour
evidence trigger a bounded search at 0.60 / 0.57 / 0.54 / 0.51 / 0.48 edge
thresholds. A candidate must cover at least 98% of foreground seeds, recover a
meaningful share of missing material or resolve the supported fragmentation,
and remain stable at the next threshold (mask IoU at least 0.985). Independent
seeded objects cannot be merged just to reduce contour count.

Border-connected low-colour-evidence paper protects real recesses and separation
between tools, allowing only a one-pixel localization fringe near the existing
mask or strong learned edges. Source colour components and existing enclosures
distinguish fragments of one tool from separate objects, including a previously
missed tool. Unsupported, unstable, clipped or ambiguous cases retain the initial
result and its existing fallback. Existing model resolution / small-gap closing
limits still apply. Explicit non-Auto sensitivity remains a single-threshold
manual override. Alpha masks stay authoritative.

The search uses **one inference**, with at most five edge reconstructions in the
existing cancellable worker. Cached pixels reuse the same edge map. Raw colour
evidence remains available to this step even if optional GrabCut is disabled.
Diagnostic reports record the chosen threshold, trial count and seed coverage;
the UI keeps Auto selected and exposes the explanation in its hover/touch hint.
No project schema, model, dependency or runtime changes.

Evaluation uses only the two Craftsman photographs, with original crops and the
exact perspective-corrected browser crops (four views). The corrected no-strip
photo changes **two shapes → one** at Auto, selecting threshold 0.57 after three
trials. The strip stays at 0.60 / one trial, with its amber hidden-edge estimate.
Both original crops stay exactly unchanged. The built-browser checks retain
Auto for both JPEGs through recommended perspective/scale, point/native-curve
repair, Cancel, signed Bend and Apply/Undo/Redo; calibration, photo alignment and
review areas are preserved. The compact layout is checked at 390 px, not on a
physical phone. The full white-sheet corpus was not rerun.

Three alternating Mac CPU/WASM passes give corrected-crop median fresh detection
**934.0 ms** with the strip and **955.1 ms** without, with cached detection
**188.5 / 169.2 ms**. The no-strip boundary step changes **35.7 → 149.5 ms**,
already included in detection; total fresh time changes **844.3 → 955.1 ms**.
Strip boundary processing changes **31.7 → 35.2 ms**. The original-crop results
stay byte-identical; timing variation includes model inference and desktop
scheduling. Initialization is separate (**170.2 ms**). These are desktop timings,
not phone or physical-fit qualification.

Local verification passes: `npm run check`, `npm test -- --maxWorkers=4`
(**229 files / 3,583 tests**), `npm run test:workflows -- bin-designer.pockets
--maxWorkers=4` (**1 / 99**), `npm run build`, and `git diff --check`. Regressions
cover rotated weak edges, thin artificial splits despite >98% foreground
coverage, genuine open recesses, resolved paper gaps, two independent tools,
an entirely missed tool, unstable enclosures, manual overrides, optional-GrabCut
independence, exact cache reuse and one inference across threshold trials.

Timing samples and a hash of the frozen pre-change runtime are recorded in
`photo-refinement-evaluation/teed-integration/automatic-sensitivity-summary.json`;
browser records are in `automatic-sensitivity-browser.json`. Reproduce with
`scripts/evaluate-auto-sensitivity.ts` and `scripts/render-auto-sensitivity-report.py`.
The report places the current results above the historical aid/corpus reviews.
Dependencies and third-party source/assets: **None added or changed**. Selection,
connectivity guards, synthetic tests and reporting are original Pocketry code
using the existing runtime and edge reconstruction.

## Previous localized measurement-aid review: two Craftsman photos

Recognized carriers no longer disable TEED for the whole selection. Their pixels
cannot supply foreground support for a learned enclosure; the projected carrier
footprint is then restored as unknown. Footprint mapping respects both raster
scales, including rounded, non-square model crops. Outside observations remain
available to the learned detector.

After tracing, a single short hidden run may be continued from visible context
on both sides. Local quadratic regression estimates endpoint tangents; a
consistent forward-turning continuation becomes a line or quadratic Bézier
represented as a cubic and adaptively sampled into the detected boundary. Long
gaps (over 12% of the contour), multiple crossings, weak/inconsistent tangents,
curves escaping the unknown region, or topology failures keep the local score
estimate. All hidden transitions retain the amber review region; automatic
continuation is not a measurement of the concealed tool.

**Edit this edge** focuses the amber area and opens outline editing. Select two
endpoints or a continuous group for **Repair section**: Line / Smooth curve,
Other side, signed midpoint Bend, Apply / Cancel. Repair deliberately replaces a
faulty section rather than fitting it within the simplification allowance.
Endpoints, outside geometry and calibration remain fixed. The default result
uses ordinary points; Editable curves preserves native handles. Existing
history/recovery paths retain one-step Undo/Redo and the amber review region.

The focused evaluation uses only `20261017_102958` (50 mm strip) and
`20261017_102135` (without strip), both on Pocketry paper. The latter's detected
outline is exactly unchanged from revision `a959c22`. Three alternating local
Node/WASM passes give median fresh detection **1022.3 ms** with the strip and
**820.8 ms** without; cached detection **316.1 / 139.9 ms**. The strip's local
continuation adds **1.0 ms**, already included in detection. Subsequent point
simplification costs **1.4 / 1.4 ms**, native reconstruction **30.7 / 28.4 ms**.
OpenCV initialization is separate (**144.4 ms**); the first strip call including
model import is **1164.4 ms**. See
`photo-refinement-evaluation/teed-integration/reference-strip-summary.json` for
samples and image hashes. These are uncontrolled Mac desktop results, not phone
or dimensional qualification. The older 27-view corpus was not rerun.

The compiled Chrome checks use the original JPEGs with paper perspective and
aid/paper scale. Both pass Line / Smooth curve preview, signed Bend, Cancel,
one-step Apply/Undo/Redo and calibration/photo/review-region preservation, with
points and native curves. The 390 px layout is inspected separately from phone
performance. In that preceding build, **the corrected no-strip photo split at Auto sensitivity**;
the existing **+30 Sensitivity** setting returned one outline for its editing
checks. The automatic review above resolves that limitation. The exact unchanged no-aid comparison in this older review uses the original,
unrectified crop. No global sensitivity default or photo-specific rule changed.
Browser records are in `reference-strip-browser.json` beside the timing summary.

Local verification: `npm run check`, `npm test -- --maxWorkers=4` (**228 files /
3,570 tests**), `npm run test:workflows -- --maxWorkers=4` (**18 / 611**),
`npm run build`, and `git diff --check` pass. After adding the per-axis footprint
regression, `npm test -- occlusions.test --maxWorkers=4` passes **2 / 10**.
No hosted CI, full photo rerun, new detailed CAD/export qualification or physical
print is claimed.

Reproduce with `scripts/evaluate-aid-outline.ts` over prepared RGBA inputs and
`scripts/render-aid-report.py`. The report adds a focused two-photo section while
retaining the historical corpus unchanged. Dependencies, third-party source,
model and assets: **None added or changed**. Local continuation, repair geometry,
controls and evaluation code are original Pocketry work using existing helpers.

## Current interaction flow

Detection chooses **Color contrast** or **Tool edges · white sheet**. Both find a boundary; neither automatically authors editable curves. The opt-in switch described above controls the representation produced by Auto-simplify. **Auto-simplify outline** is a direct action in Outline settings, without entering manual editing. Its preview offers **More detail / Balanced / Smoother**, original/preview comparison, and Apply/Cancel. Numeric control lives under **Advanced: boundary allowance** with a hover/focus/touch hint.

**Maximum change from detected outline (mm)** bounds distance from the dense detected polygon before simplification, converted with the photo's calibration. A 0.2 mm allowance permits up to 0.2 mm of boundary movement; it does not add pocket clearance or certify true tool dimensions. Manual section fitting instead names its reference **current outline**, because it works on existing edited points.

**Edit outline** groups Points and **Bend edges** tools in one panel with Done. Click-to-add and right-click-to-delete work on curves as well as polygon points. Shift-click/box selection, a visible touch selection toggle, group movement/deletion, and adjacent-section fitting share the highlighted points. Escape clears selection; Space/hand navigation and pinch stay separate from editing. A group drag is one undo step; cancellation and selection are not edits. The contour list shows editable anchor counts, not export sample counts.

The earlier interaction-only follow-up left the reconstruction algorithm, numeric allowance and 27-view corpus unchanged. Those per-view comparisons remain historical evidence; the localized-aid revision above has only the requested two-photo evaluation. No new phone timing is claimed.

### Interaction follow-up verification and provenance

- `npm run check` passed; `npm test -- --maxWorkers=4` passed **223 files / 3,525 tests**; `npm run test:workflows -- --maxWorkers=2` passed **18 files / 611 tests**. `npm run build` and `git diff --check` passed. Verification remains local-only.
- New regressions cover group selection/movement in transformed coordinates and screen-space selection boxes on rotated, stretched pockets, wrapped/contiguous sections, atomic deletion with three-point minima, source/handle immutability, keyboard ownership, gesture cancellation, and a second finger taking over either a single-node or group edit. Existing Trace/Bin history, recovery, project and curve tests also pass.
- Actual Wolfbox source-browser checks passed the direct auto-simplify action without entering manual editing, presets, hidden advanced allowance and its reference hint, original comparison, unchanged Cancel, one-step Apply, Shift selection, group move/Undo, click-to-add, right-click-to-delete and deletion Undo. The 390 px viewport passed visible selection and native browser two-finger cancellation without an outline/history change or horizontal overflow. The rebuilt static interface also passed the direct action, presets, hints, and native cubic source. These are browser/emulated-touch checks, not a physical-phone benchmark.
- The previous local preview process stopped during an initial compiled check. After restarting the loopback preview, the compiled check passed; no detector or model changes were needed. The initial restricted test invocation could not open loopback ports; the final local run with port access passed completely.
- The 27-photo reconstruction comparison and detailed CAD/export qualification above/below remain the preceding geometry evidence; this UI follow-up does not rerun or relabel their timings. No slicer/physical-fit, real-phone speed, publication or deployment claim is added.
- Dependencies and third-party code/assets: **None added or changed**. Point selection and batch editing are original Pocketry code. The conventional Shift-click/box-selection interaction follows familiar vector editors without copying their implementation. The model and runtime are unchanged.

## Dense line-and-curve reconstruction — current behavior

The general reconstruction module is `shared/geometry/contour-reconstruction.ts`. It contains no tool names, photo coordinates, preferred axes or image-specific branches. It matches selected components to their dense sources by bounds, detects persistent corners with two arc-length support scales, prefers finite line segments with distance and reversal checks, then fits cubics elsewhere. A second pass constrains curved spans to shared tangents and adjacent line directions; any join adjustment is reverified against the same allowance. Some unresolved short joins may remain when stronger smoothing would exceed the bound.

Line error is bounded against finite chords; continuous projection covers the chord and source edges in both directions. Cubic error uses Bernstein control-hull bounds on the difference between each cubic subsegment and its original source edge, after monotone reparameterization. A successful preview reports a conservative continuous approximation bound. Adaptive topology checks additionally reject winding changes, crossings/touches and changed hole relationships; they are sampled checks, not a mathematical proof about arbitrarily tiny features.

The visible default allowance is at least 0.1 mm when calibrated (1 px otherwise), or the dense ring's 75th-percentile sample step if coarser. It is editable and is never silently increased. Reconstruction of all fresh detected contours is atomic: any failure retains the original source; no partial fit is applied. Manual/curve edits disable the command until Undo or re-detection restores the fresh source. The existing project schema and curve representation are unchanged.

The dedicated worker RPC reuses the detection worker when warm and supports termination, supersession, timeout, idle cleanup and retry. Geometry-only requests do not initialize OpenCV or download a model. Source, scale/ring/context changes, Cancel and Escape invalidate pending previews. Apply is one undoable edit; editable handles survive recovery and Trace → Bin transfer.

### Corpus and Wolfbox cap evidence

All **27 unchanged white-sheet views** were evaluated in three Node/WASM corpus passes and a separate real Chrome worker pass. **25/27** geometry previews validate; the original-pixel caliper and wire-stripper crops retain their detected polygons after topology rejection. The existing detector still accepts 22/27 learned silhouettes and keeps five color fallbacks. Successful fitting does not repair poor segmentation or establish accuracy against the photograph.

For the Wolfbox body, 1,602 dense samples reconstruct into **24 anchors: 3 lines and 21 cubic spans**, with 18 tangent-continuous joins and five persistent corners at a visible 1 input-pixel allowance. Its bottom evaluation spans are curved with smooth joins. The earlier body photograph also has a curved cap (22 anchors, 3 lines, 19 cubics). These photo-specific cap checks are validation landmarks only; they do not affect fitting. Synthetic rounded handles also pass at 0°, 37°, 90°, 137°, 180° and 270°, plus tests for scale, true straight corners, narrow recesses/shafts, holes, reordered objects, atomic rejection and preservation of authored geometry.

Median per-view Node timings: **939.1 ms** fresh TEED, **52.2 ms** cached detection, **12.9 ms** geometry reconstruction, and **951.9 ms** fresh TEED + geometry. OpenCV initialization (164.2 ms) is separate; the first learned call including model import was 1,078.5 ms. The separate Chrome corpus pass measured medians of **1,064.9 ms** learned detection and **15.4 ms** geometry RPC under local desktop load. Per-view samples and allowances are recorded in the adjacent benchmark/browser JSON. No phone timing is claimed.

A separate geometry-only Chrome heartbeat run performed 30 Wolfbox reconstructions after warmup, excluding fixture decoding, inference and import; its largest sampled frame gap was **16.8 ms**. That worker did not load OpenCV. The wider corpus heartbeat includes fixture conversion/import and is recorded with its different scope; it is not substituted for this focused responsiveness measurement.

The real Wolfbox source UI passed preview/cancel without source mutation, one-step Apply/Undo/Redo and handle recovery after reload. With a synthetic ruler for workflow testing, native SVG contained **21 cubic commands**, and the 1,276-triangle STL had positive volume and two incident faces at every undirected edge. The compiled production UI also passed reconstruction and native SVG download. These checks do not qualify physical fit or a printer/material combination.

### Reconstruction-stage verification and provenance

- `npm run check && npm test -- --maxWorkers=4`: **221 files, 3,505 tests passed**.
- `npm run test:workflows -- --maxWorkers=2`: **18 files, 611 tests passed**.
- `npm run test:geometry`: **25 files, 329 tests passed**. The quick suite also exports an analytic reconstructed rounded handle and verifies watertight topology and physical volume.
- `npm run build` and `git diff --check`: passed. Model hash and delivered MIT notice remain unchanged.
- Dependencies and third-party assets: **None added or changed**. The reconstruction is original Pocketry geometry code using the existing curve representation and validation helpers; no model or geometry library is added. No hosted CI, publication/deployment, slicer check or physical print is claimed.

## Edge map to silhouette

The worker imports a fixed 512 × 512 FP32 TEED graph through the already shipped OpenCV DNN runtime. The optional model is 248,782 bytes. No npm dependency or second inference runtime is added. Input uses letterboxed BGR byte values minus the upstream channel means, without division by 255. Replicated borders avoid a synthetic padding edge.

Thresholded learned edges form barriers. One model-pixel morphological closing repairs small gaps; exterior white paper floods from the selection border. Enclosed regions with color-mask support become candidate tools, including reflective shafts beyond the old color mask. Unsupported print/edge islands are removed. A class-preserving interpolation kernel softens pixel crossings without cutting new background slits into the filled mask. The existing interpolating tracer, smoothing, simplification and normalization then produce editable rings. This does not use a convex hull or invent a smooth contour across large open gaps.

A selection with no supported enclosure or nearly full foreground retains the normal color pipeline, including guarded GrabCut and its topology checks. A mask clipped at opposite selection sides is rejected as too tight. A learned result that splits an existing connected silhouette into more outer components is also rejected. This guard can conservatively reject real details; acceptance is not an accuracy certificate. Missing/corrupt model assets or unavailable DNN retain color detection and surface a notice. Alpha silhouettes remain authoritative. Recognized carriers use the localized handling described above.

The sensitivity control changes the edge-barrier threshold; a lower barrier threshold admits more edge evidence. Detail/smoothing reuse the dense polygon cache. Sensitivity adjustments reuse a single exact-byte BGR frame/edge cache, rebuilding the mask without inference. The worker retains one net; it releases per-inference Mats in `finally`, disposes the net on errors, and terminates after 30 seconds idle. Cancellation/supersession terminates synchronous WASM work. Model loading has exact size and SHA-256 checks before import.

## Editable curves

Learned detection keeps a dense boundary and a simplified polygon. Use **Outline → Auto-simplify outline → Apply simplified outline** to rebuild from dense evidence. The older Auto-fit contour and selected-point actions remain separate tools for the current polygon. Keep Trace margin at zero. The preview has an adjustable maximum deviation and preserves sharp corners. Apply is one undoable edit; rejected previews do not change the source. Handles survive Trace recovery, separate pocket/hole transfer with photo positions, Bin revisions, and project backups. Project schema 61 accepts schema 60 and earlier supported files; Trace draft schema 2 accepts schema 1.

Reconstruction bounds deviation against the dense detected boundary; the older Auto-fit contour and selected-point actions bound it against the current polygon. Neither reference is photographed ground truth. A tight bound and corner preservation can leave many anchors. Native cubic curves are retained in Trace SVG when no hole/material boolean is needed. Mesh/DXF paths use adaptive polygon samples. See [curve behavior, sampling and limitations](contour-curves-prototype.md).

## White-sheet evaluation and reproduction

The evaluation uses 19 existing white-sheet crops plus eight views cropped from original pixels first (27 views, not 27 distinct tools). Historical mat/checkerboard images are excluded. Compare color plus guarded GrabCut with TEED outer silhouettes, then reconstruct from dense evidence at the same visible default allowance used by the UI. The previous coarse-polygon fit used 0.6 input pixels and is preserved for comparison; its error reference and allowance differ. The same `outsideSilhouettes` function used by Trace removes holes/islands before fitting. Different input resolutions are not equivalent physical error bounds. No complete ground-truth masks are available.

Run with Node 22 from the repository root, supplying the local photo manifest rather than committing personal photo paths:

```
node --import tsx scripts/evaluate-teed-outline.ts CASES_JSON RESULTS_DIR [PREVIOUS_RESULTS_DIR]
python scripts/render-teed-report.py RESULTS_DIR REPORT_HTML BROWSER_VALIDATION_JSON
```

The manifest has `name`, `path` (RGBA bytes), `width`, `height`, and `group: "original"`; historical names contain `-mat-`. A PNG with the same stem supplies the report photo. The evaluator makes three sequential corpus passes, evicting its single-frame cache between fresh inferences, then measures one cached reconstruction per pass. Model import and OpenCV initialization are listed separately. The renderer embeds every before/after image, native cubic preview, acceptance/fallback status, point/anchor counts, timing samples and visual review notes in one offline HTML file.

When previous results are supplied, the report retains the previous curve preview for every view. Edge-mask reconstruction is measured within learned-detection time; dense line-and-curve reconstruction is measured separately and added for the combined timing.

Per-view timing records, browser validation and observed limits accompany this document in `photo-refinement-evaluation/teed-integration/`. Mac CPU/WASM timings do not establish iPhone/Android speed or memory. WASM heap capacity is reported separately from live allocation/RSS. The browser retains a separate 128 MiB calibration heap alongside the detection worker; this cost must be included in phone qualification. Review tiny shafts, tool tips, cast shadows and sheet markings manually. Slicer and physical fit checks remain separate.

## Earlier stage: general soft-mask correction

A maintainer screenshot exposed a long doubled-back segment on the airduster handle. Stage-by-stage reproduction showed that the filled mask was continuous; the artifact appeared in the score-field conversion, before polygon simplification or cubic fitting. The old interior/exterior distance blend had a hard three-model-pixel cutoff. A four-pixel-wide learned edge band could become foreground/background/foreground across its width, creating an artificial slit and an outer sliver. The existing corner preservation then retained the false sharp turns.

The replacement uses the same symmetric separable `[1, 6, 1]` interpolation kernel for every image. Its center weight is 36/64 (>1/2), so every original foreground sample remains above iso 128 and every background sample remains below it, including single-pixel features. This is a general class-preservation rule, not a coordinate, tool category or preferred-direction heuristic. The changing-thickness regression runs at all four quarter-turns, alongside recess, gap, shaft and multiple-object tests.

The existing tolerance-based straight-line simplification now operates on a coherent silhouette. No extra inference model, convex hull, symmetry, global line detection or forced straightening is added. The airduster polygon drops from 44 to 32 points (41 to 29 fitted anchors), the crop-first Ryobi from 171 to 94 points, and close Gerber from 149 to 92 points. The same 22/27 views pass learned reconstruction guards; curve previews improve from 25/27 to 26/27. The stapler retains its rejected curve preview and original polygon. All 27 unchanged white-sheet inputs were re-evaluated, including all existing fallbacks, and visually compared with the prior TEED result.

The correction follows the filled mask rather than the previous edge-centering heuristic. It therefore changes boundary placement slightly: the median enclosed-area change over accepted views is +4.0% (maximum +10.5%), recorded per view as a diagnostic, not a quality score. Thin-shaft masks can show larger relative area changes. No ground-truth dimensional validation is available, and remaining model-edge/shadow spurs need review. The dense reconstruction stage now uses an explicit deviation bound and preserves supported corners and recesses; fewer vertices alone is not a success criterion.

## Soft-mask baseline measurements (before dense reconstruction)

Mac arm64 Node 22 CPU/WASM, three sequential corpus passes: median per-view color total **71.3 ms**, fresh learned total **867.2 ms**, cached learned total **45.8 ms**, reconstruction inside that total **15.5 ms**, and curve fitting **0.3 ms**. OpenCV initialization was 121.2 ms; the first learned call including model import was 990.2 ms. Chrome 156’s separate single corpus pass measured medians of **750.7 ms** fresh, **33.0 ms** cached and **11.2 ms** reconstruction. These are separate local runs, not a controlled speedup comparison with the earlier build or phone timings.

Observed worker WASM capacity remains **265.5 MiB**, with **128 MiB** in the separate main-thread calibration runtime. Model download and inference architecture are unchanged. The combined heap-capacity caveat and unmeasured phone behavior still apply.

## Dependency and provenance review

For the soft-mask follow-up, dependencies and third-party assets: **None added or changed**. The interpolation code and synthetic regression are original Pocketry work.

Only the fixed TEED ONNX model and upstream MIT license are added; no npm dependency/transitive version changes. TEED source revision `40fa4b1391dc6424f88989d0ca75d5b592c8681d` distributes `checkpoints/BIPED/5/5_model.pth` alongside its MIT license (copyright 2022 Xavier Soria Poma). It provides no separate weights license or model card. The integration relies on that repository-level license; it does not imply a separate audit of training-data rights. No dataset or Python implementation is redistributed. MIT permits AGPL and proprietary integration with retained attribution; it does not expand third-party rights through Pocketry's CLA. Full license, source/checkpoint/export hashes and conversion details are in `NOTICE` and the served model license. Generated `NOTICE.txt` must retain this section in the production build.

## Earlier integration and soft-mask verification

- Soft-mask follow-up: `npm run check && npm test -- --maxWorkers=4`: 220 files, 3,487 tests passed on Node 22; `npm run build` and `git diff --check` passed. The full workflow and CAD suites below passed for the preceding integration; those measurements describe that earlier stage.
- `npm run test:workflows -- --maxWorkers=2`: all 18 files, 611 tests passed. An initial asynchronous focus-scope teardown error was isolated; the affected export workflow and the final complete workflow run both passed cleanly.
- `npm run test:geometry`: all 25 files, 329 tests passed (325 seconds).
- `npm run build` and `git diff --check`: passed. The emitted model matches the pinned SHA-256; `dist/public/NOTICE.txt` contains the complete TEED MIT notice and the model license is served separately.
- Real Chrome source and compiled-production checks, serialized SVG/STL inspection, and the 27-view offline/browser evaluations are described above. No hosted CI was run. No publication/deployment, phone run, slicer check or physical print is claimed.


Follow-up browser verification covered re-detection, explicit 0.3 mm curve preview, Apply, one-step undo/redo and handle recovery. At the synthetic ruler's default 0.1 mm bound, no curve change was needed; the disabled Apply button was verified as the expected no-op. The source and compiled production UI both passed at the explicit preview setting. The resulting SVG retained six cubic edges; the binary STL had 440 triangles, positive signed volume and two faces on every undirected edge. These are workflow/serialization checks with a synthetic ruler, not physical-fit qualification.
