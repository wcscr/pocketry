# Original-photo UI validation — 2026-11-11

This comparison uses baseline `9316de86` and the bounded area-sampling recovery change. It supersedes cropped-photo replay as end-to-end evidence. All verification ran locally; GitHub CI remained disabled.

## Method

For every case, load the original JPEG on its calibration sheet, accept **Correct perspective & use scale** (or **use aid scale** when offered), and draw the tool region with the UI. Defaults run first. Manual cases then open **Manual detection settings** and move its slider. Auto simplify cases open the preview, select More detail, Balanced and Smoother, wait for each result, and Cancel. No detector calls, prepared pixels, calibration injection or settings injection supply a test input.

Original file hashes, ordered UI actions, selected regions, applied settings, rendered preview paths and screenshots were retained locally. Temporary read-only development observations hashed the real detector input and recorded output geometry; those hooks were removed before delivery. Paired runs require identical detector-input hashes. Viewport/region mismatches were rerun, not counted as algorithm changes. The local browser driver uses only rendered controls and canvas drags.

## Detection

- All **36** original subjects have matched detector inputs and byte-identical final outlines before/after. This is a non-regression result, not an accuracy pass: the clear needle hub, tight screwdriver selections and other difficult boundaries still have known problems.
- The reported Craftsman selection `(260,392,428,414)` changes from a jagged **244-point color fallback** to a smooth **176-point tool-edge outline**. Moving its selection one pixel right changes **328 → 173 points**. Two already-good selections remain exactly unchanged (**180** and **167** points).
- Rub ’n Buff, region `(327,521,372,158)`, remains exactly unchanged at defaults, **+31**, and **+56**. At +31 the cap is included but the neck has a deep recess. +56 recovers the neck more completely; an upper-left foldback remains. This change does not solve all weak white-object boundaries.
- Edge and Chromium produced identical input hashes and all 244 outline points for the reported failing Craftsman selection. A one-pixel region change was enough to switch the old detector between accepted learned edges and color fallback; this reproduced without a browser or cache change.

The recovery keeps established bilinear sampling and manual sensitivity behavior. Only automatic, downscaled inputs with less than 95% seeded-material coverage get one area-averaged retry. Acceptance requires at least 98% coverage, preservation of already-covered seeds and unknown regions, no merging of independently seeded objects, and the existing downstream topology checks. A failed retry retains the primary result. Complete detections are unchanged. At most two inferences / 28 threshold trials are used, with two bounded cached edge maps. Phone latency and memory remain unqualified.

A global switch to area averaging was rejected: it improved Craftsman but introduced cap loopbacks for Rub ’n Buff at +31. The bounded retry avoids that regression.

## Auto simplify

Across **108 UI previews / 36 tools**, the largest More detail → Smoother boundary movement is **0.186 mm**. The median per-tool 95th-percentile movement is **0.049 mm**. These are differences between settings, not measurements against the physical tools. Distances use rendered polygons sampled every 0.025 mm.

The mini ratchet and syringe plunger produce identical boundaries for all three levels. Balanced and Smoother also coincide for digital calipers and the flux syringe. Most other changes are subpixel at the working image scale of 0.25 mm/px; enlarged views make them more visible. The pink needle hub, clear needle hub and Gerber illustrate some larger local changes.

The comparison supported one automatic preview using the smoothest candidate admitted by the existing safeguards, retaining Original/Preview, Apply and Cancel. The former Smoother computation already considers weaker candidates and keeps a smoother safe result. The user approved removing the selector after reviewing these results; the follow-up uses that computation without enlarging tolerances or changing the geometry algorithm. The table below records the earlier three-level comparison.

| Case | Detail → Smoother P95 (mm) | Maximum (mm) | Balanced → Smoother maximum (mm) |
| --- | ---: | ---: | ---: |
| s01-black-click-pen | 0.089 | 0.178 | 0.145 |
| s02-brass-nameplate | 0.101 | 0.166 | 0.120 |
| s03-craftsman-hex-keys | 0.039 | 0.060 | 0.046 |
| s04-craftsman-tape-measure | 0.074 | 0.154 | 0.118 |
| s05-dewalt-screwdriver | 0.047 | 0.157 | 0.117 |
| s06-digital-calipers | 0.019 | 0.061 | 0.000 |
| s07-needle-clear-hub | 0.141 | 0.177 | 0.145 |
| s08-needle-pink-hub | 0.091 | 0.185 | 0.141 |
| s09-fanttik-desoldering-pump | 0.055 | 0.160 | 0.120 |
| s10-fanttik-soldering-iron | 0.042 | 0.155 | 0.114 |
| s11-fanttik-stand-arm | 0.066 | 0.180 | 0.139 |
| s12-fanttik-stand-base | 0.018 | 0.041 | 0.045 |
| s13-flipper-zero | 0.038 | 0.051 | 0.048 |
| s14-folding-knife | 0.056 | 0.161 | 0.118 |
| s15-gerber-multitool | 0.064 | 0.180 | 0.150 |
| s16-gray-click-pen | 0.062 | 0.157 | 0.117 |
| s17-mini-ratchet | 0.000 | 0.000 | 0.000 |
| s18-rub-n-buff | 0.063 | 0.155 | 0.114 |
| s19-ryobi-cutter | 0.044 | 0.177 | 0.137 |
| s20-flux-syringe-plunger | 0.000 | 0.000 | 0.000 |
| s21-flux-syringe | 0.026 | 0.070 | 0.000 |
| s22-stapler | 0.048 | 0.167 | 0.135 |
| s23-tarkit-mould-line-remover | 0.051 | 0.147 | 0.112 |
| s24-deburring-tool | 0.076 | 0.179 | 0.151 |
| s25-tweezers | 0.054 | 0.159 | 0.118 |
| s26-wiha-single-a | 0.036 | 0.152 | 0.111 |
| s27-wiha-single-b | 0.062 | 0.166 | 0.138 |
| s28-wiha-single-c | 0.063 | 0.181 | 0.148 |
| s29-wiha-150mm-1 | 0.042 | 0.176 | 0.149 |
| s30-wiha-150mm-2 | 0.041 | 0.173 | 0.173 |
| s31-wiha-150mm-3 | 0.041 | 0.186 | 0.153 |
| s32-wiha-150mm-4 | 0.038 | 0.157 | 0.130 |
| s33-wiha-150mm-5 | 0.038 | 0.180 | 0.143 |
| s34-wolfbox-air-duster | 0.031 | 0.160 | 0.114 |
| s35-wolfbox-cone-nozzle | 0.059 | 0.159 | 0.120 |
| s36-wolfbox-long-nozzle | 0.084 | 0.165 | 0.130 |

## Single-preview follow-up

Auto simplify now opens one preview using the former Smoother search: up to
0.2 mm of movement, with weaker candidates retained when they produce a smoother
safe boundary. The geometry algorithm and safeguards are unchanged. Original /
Preview and Apply / Cancel remain. A checkmark marks an already-applied result;
a dash marks no change. Hover and keyboard focus explain the icons. Reopening
does not compound smoothing, including after Undo/Redo or saved-draft recovery.
Drafts saved with a weaker preset still use their retained original source.

Fresh original-photo UI checks repeated calibration and region selection for
Craftsman `(260,392,428,414)` and Rub ’n Buff `(327,521,372,158)`. Craftsman's
new preview path is byte-identical to the prior Smoother UI path. Cancel leaves
its detected outline unchanged; Apply makes one Undo step; reopening marks it
applied and disables Apply; Undo/Redo restore the exact displayed outlines.
Rub ’n Buff runs defaults before setting sensitivity to +31 with the slider.
Auto then changes that accepted manual result; Undo restores the exact +31
outline. Original hashes, ordered UI actions, region/settings, paths and
screenshots are retained locally as `single-auto-craftsman` and `single-auto-rub`
artifacts. No saved calibration or outline was used as a photo-test input.

Synthetic component/history tests cover saved legacy presets, one automatic
preview, no-change indicators and focus hints, pending cancellation, and
recovery/Undo with point and native-curve representations (65 focused checks).
The quick suite passed again (3,989 passed, one existing expected failure, nine
quarantined crop assertions), as did the 99 affected pocket-editing workflows,
type checking, production build and `git diff --check`.
The 36-photo level comparison above was not rerun for this UI-only follow-up;
its former Smoother output is the chosen automatic computation.

## Verification scope

The local quick suite keeps synthetic algorithm/component checks. Nine historical cropped-photo assertions (Craftsman, Gerber and Wiha) are explicitly quarantined with `skip`; they are not executed or counted as passes. The real-model/cache test now uses synthetic pixels. The original-photo UI runs above replace cropped replay as current photo evidence; old per-pixel crop assertions are retained only as historical diagnostics. Isolated calibration fixtures remain calibration-unit evidence, not outline-workflow qualification.

No dependency, model, third-party code, asset or license changes were added. The original model and notices remain unchanged. Local temporary screenshots and original photos are not published.

Local commands: `npm run check`, `npm test` (3,989 passed, one existing expected failure, nine quarantined crop assertions), `npm test -- teed.test trace-detection-controls trace-canvas-history` (78 passed), `npm run build`, and `git diff --check`. Production build retains the pre-existing large-chunk advisory. No hosted CI, phone benchmark, physical-fit check or CAD/export requalification was run for this detector/UI follow-up.
