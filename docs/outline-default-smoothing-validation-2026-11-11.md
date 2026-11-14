# Default outline smoothing — original-photo UI comparison

Evaluated November 11, 2026 against PR head `f838c39b025412a577571e27abcabf1f20bd7370`.
This qualifies the finishing-pass change, not detection accuracy or physical fit.

## Method

All 36 original-photo cases started by importing the untouched calibration-sheet
JPEG, detecting markers, accepting the offered perspective/scale correction,
drawing the selected region, and waiting for default Tool edges detection.
Baseline and candidate ran sequentially in the same browser tab and viewport.
Original-photo SHA-256, selected region, ordered UI actions, applied settings and
exact detector-input pixel hashes were recorded. Every paired input hash matched.
Optional smoothing was opened only after Manual detection settings. No prepared
crop, saved calibration, saved outline or injected setting supplied a test input.
The final candidate was rerun through all 36 workflows after adding the broader
ripple safeguard. Three additional original-photo runs covered the reported
Craftsman selection and Rub ’n Buff sensitivity +31 and +56; defaults ran first.

Read-only development logging captured results of actual UI operations and was
removed before final checks. Local artifacts are under
`exports/original-photo-ui/default-smoothing/`: paired JSON observations,
screenshots, `metrics.json`, `report.html`, and rejected proposals in
`initial-attempt/`. Original photos and screenshots are not committed.

## Result

- 30 boundaries changed slightly; six are unchanged. Raw material silhouettes,
  separate shapes and holes are identical in all 36 pairs.
- Fifteen cases have fewer measured alternating bumps; none have more. No final
  case increases measured jagged length by more than 0.1 mm.
- Maximum sampled boundary movement: **0.196 mm**. Median per-tool P95 movement:
  **0.047 mm**. These measure change from the previous outline, not accuracy.
- Added desktop finishing time: median **289 ms**, maximum **671 ms**, including
  the additional material/ripple checks. Phone performance is unqualified.
- Whole-outline overlays and enlarged largest-change views were visually reviewed
  for all 36 cases and the additional reported regions. No new visible loss of a
  major feature was found. Small rounding is expected within the existing bounds.

The first attempt exposed one measured ripple regression on Wiha 150 mm #3:
2 → 3 alternating bumps, with jagged length 9.2 → 15.9 mm. Fanttik stand arm and
Tarkit had smaller jagged-length increases (23.9 → 24.1 and 7.9 → 8.2 mm).
The default now rejects those proposals and retains each previous outline exactly.
Wiha 150 mm #2 also retains its previous outline because the candidate exceeded
the combined material-detail allowance. These four fallbacks are included in the
six unchanged results; black click pen and clear-hub needle already plateaued.
The rejected proposals remain in the local comparison for review.

Metrics use 0.025 mm boundary samples, and roughness samples at 0.1 mm with a
1 mm smoothing scale and 0.1 mm minimum alternating amplitude. Shape guards are
conservative tests, not a proof that every tiny real feature is preserved.

| Case | Maximum movement (mm) | P95 (mm) | Alternating bumps | Result |
| --- | ---: | ---: | ---: | --- |
| s01-black-click-pen | 0.000 | 0.000 | 10 → 10 | Unchanged |
| s02-brass-nameplate | 0.193 | 0.068 | 8 → 6 | Smoothed |
| s03-craftsman-hex-keys | 0.105 | 0.039 | 0 → 0 | Smoothed |
| s04-craftsman-tape-measure | 0.173 | 0.077 | 3 → 2 | Smoothed |
| s05-dewalt-screwdriver | 0.174 | 0.054 | 3 → 1 | Smoothed |
| s06-digital-calipers | 0.173 | 0.066 | 4 → 3 | Smoothed |
| s07-needle-clear-hub | 0.000 | 0.000 | 13 → 13 | Unchanged |
| s08-needle-pink-hub | 0.191 | 0.127 | 1 → 0 | Smoothed |
| s09-fanttik-desoldering-pump | 0.163 | 0.055 | 0 → 0 | Smoothed |
| s10-fanttik-soldering-iron | 0.193 | 0.050 | 0 → 0 | Smoothed |
| s11-fanttik-stand-arm | 0.000 | 0.000 | 5 → 5 | Kept earlier boundary |
| s12-fanttik-stand-base | 0.047 | 0.018 | 0 → 0 | Smoothed |
| s13-flipper-zero | 0.067 | 0.035 | 0 → 0 | Smoothed |
| s14-folding-knife | 0.146 | 0.048 | 0 → 0 | Smoothed |
| s15-gerber-multitool | 0.192 | 0.064 | 1 → 0 | Smoothed |
| s16-gray-click-pen | 0.175 | 0.064 | 0 → 0 | Smoothed |
| s17-mini-ratchet | 0.076 | 0.040 | 1 → 0 | Smoothed |
| s18-rub-n-buff | 0.175 | 0.064 | 2 → 2 | Smoothed |
| s19-ryobi-cutter | 0.173 | 0.045 | 1 → 0 | Smoothed |
| s20-flux-syringe-plunger | 0.191 | 0.105 | 10 → 8 | Smoothed |
| s21-flux-syringe | 0.091 | 0.033 | 22 → 14 | Smoothed |
| s22-stapler | 0.178 | 0.047 | 5 → 5 | Smoothed |
| s23-tarkit-mould-line-remover | 0.000 | 0.000 | 2 → 2 | Kept earlier boundary |
| s24-deburring-tool | 0.186 | 0.074 | 2 → 1 | Smoothed |
| s25-tweezers | 0.174 | 0.051 | 2 → 0 | Smoothed |
| s26-wiha-single-a | 0.191 | 0.054 | 2 → 2 | Smoothed |
| s27-wiha-single-b | 0.175 | 0.043 | 2 → 2 | Smoothed |
| s28-wiha-single-c | 0.188 | 0.062 | 2 → 2 | Smoothed |
| s29-wiha-150mm-1 | 0.196 | 0.043 | 3 → 1 | Smoothed |
| s30-wiha-150mm-2 | 0.000 | 0.000 | 4 → 4 | Kept earlier boundary |
| s31-wiha-150mm-3 | 0.000 | 0.000 | 2 → 2 | Kept earlier boundary |
| s32-wiha-150mm-4 | 0.189 | 0.041 | 2 → 2 | Smoothed |
| s33-wiha-150mm-5 | 0.174 | 0.034 | 1 → 0 | Smoothed |
| s34-wolfbox-air-duster | 0.160 | 0.038 | 1 → 1 | Smoothed |
| s35-wolfbox-cone-nozzle | 0.175 | 0.085 | 4 → 4 | Smoothed |
| s36-wolfbox-long-nozzle | 0.175 | 0.083 | 11 → 9 | Smoothed |

## Reported selections and manual controls

The reported Craftsman region `(260,392,428,414)` remains one complete smooth
outline: maximum movement 0.172 mm, P95 0.072 mm, measured bumps 2 → 1.
Rub ’n Buff at `(327,521,372,158)` preserves the sensitivity-dependent cap/neck
capture: +31 and +56 retain the same raw material as the baseline. Maximum
movement is 0.192 mm for both; bumps change 6 → 2 and 6 → 4 respectively.
The +31 result still has the prior neck foldback. Default sensitivity still misses
the cap. The clear-hub needle and first 150 mm Wiha still have fragmented detections;
Gerber retains its shadow spur. These are pre-existing detector limitations.

Successful automatic smoothing shows the applied indicator and disables repeated
Apply. After Rub ’n Buff +56, changing Simplification from 1.2 to 1.3 px establishes
a new accepted outline. Optional Smooth outline produces a changed preview;
Apply and Undo were exercised and the restored SVG path matches exactly.
Synthetic checks separately cover material-guard and ripple-guard rejection,
metadata/history propagation, preserved raw evidence and control placement.

## Earlier detected contour

`materialOutline` is captured before geometric outer smoothing, simplification
and line/curve fitting. It already includes segmentation/refinement, tool/paper
corrections and accepted occlusion repair. `processImage` maps it to working-photo
coordinates as `rawOutline`; matching evidence survives history and draft recovery.
A read-only earlier-silhouette toggle is available in the local comparison report.
No raw-outline control was added to the application in this change.

This is a useful potential fallback when fitting loses detail, but cannot recover
a white lid absent from segmentation. It may expose pixel noise, shadow rails and
slits. The immediate pre-finishing outline is separately retained as the applied
smoothing source. A future UI should distinguish these stages and make replacement
explicit and undoable.

## Local verification

`npm run check`, `npm run build` and `git diff --check` passed. The quick suite
passed 3,991 assertions, with one existing expected failure and nine quarantined
cropped-photo assertions excluded. Its three server files initially failed because
the sandbox denied loopback listeners; rerunning those files outside the sandbox
passed all 67 assertions. All 627 workflow tests passed. Hosted CI remains disabled.
CAD/export qualification was not rerun: no mesh, export or pocket-construction code changed.
Dependencies, models, third-party code and assets: **None added or changed**.

## Detected-outline control follow-up

The subsequent UI change adds a presentation-only **Detected outline** switch
under Manual detection settings and in the compact Adjust tray. **Use detected
outline** appears only during comparison, retains margin, and creates one Undo
step. Hints appear on hover/focus, with compact pending/error/already-used icons.
The detection and smoothing algorithms are unchanged; the 36-case comparison
above was not rerun for this UI-only follow-up.

Two fresh original-photo workflows tested the controls: Craftsman at defaults,
and Rub ’n Buff at defaults followed by sensitivity +56. Each began with the
original calibration-sheet JPEG, auto-calibration/perspective correction and a
region drawn in the UI. The isolated test trace was reset through Start Over
before each import to avoid inherited settings. No state or prepared pixels were
injected. Original hashes, actual region rectangles, ordered actions, settings,
SVG paths and screenshots are saved locally in
`exports/original-photo-ui/detected-outline-review/`.

- Craftsman: toggling comparison preserves the accepted path; Use/Undo/Redo
  restores the expected paths exactly. Reopening the already-used contour
  disables replacement. The same flow preserves an explicitly selected 0.5 mm
  margin, and Undo restores the preceding offset outline exactly.
- Rub ’n Buff: Use after +56 sensitivity and Undo restores the adjusted outline
  exactly. Desktop and 390 × 844 compact layouts were inspected. Escape closes
  comparison while the switch has keyboard focus.
- Synthetic coverage checks preserved holes/separate contours, native curves and
  smoothing metadata through Undo/Redo and draft recovery; no preview geometry
  enters the saved draft. It also checks stale async margin results, settings and
  source changes, failure hints, and explicit replacement guards.

Final local checks: `npm run check`; `npm test` (4,006 passed, one existing expected
failure, nine quarantined cropped-photo checks excluded); all 627 workflow tests;
`npm run build`; `git diff --check`. Hosted CI stayed disabled. No dependencies,
models, third-party code or assets were added or changed.
