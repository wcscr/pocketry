# Combined detector comparison — November 11, 2026

This records the **initial** combined version (`b907790c`). The
[Craftsman regression follow-up](outline-craftsman-fix-2026-11-11.md) supersedes
these automatic comparison results and adds the previously untested on-sheet
Craftsman photo and manual slider checks.

Local worktree: `codex/outline-combined`, based on Claude's
`5aefd8048a02fe2d7c3e0f2e816f246beeef0f26`. The combined implementation keeps
Claude's automatic detector and sheet-print removal. It adds the geometric
preservation contract, explicit corrections, source sampling, and evaluator
checks described in [the implementation reference](outline-combined-detector.md).
The printing-uncertainty mask and experimental source-edge fitting are absent.

## Matched automatic comparison

Both branches were rerun sequentially under Node 22.23.4 on darwin/arm64 with
`--outer-smoothing on --sheet-ink on`. They consumed the same 36 RGBA crops and
36 **draft** reference outlines. No user correction marks or clearance were
applied. Input/source hashes are recorded in the local comparison directory;
no source file changed during either evaluation run.

| Measure | Claude | Combined |
| --- | ---: | ---: |
| Accepted / fallback | 34 / 2 | 34 / 2 |
| Empty results | 0 | 0 |
| Multiple shells | 2 | 2 |
| Automatic cleanup applied | 36 | 36 |
| Omission ≥1 mm | 7 | 7 |
| Excess ≥1 mm | 18 | 19 |
| Cases with loopbacks | 5 | 4 |
| Cases with ≥10% jagged edge | 0 | 1 |
| Median detection time | 849 ms | 900.5 ms |
| Worst detection time | 1323 ms | 1438 ms |
| Peak OpenCV WASM heap | 184.4 MB | 184.4 MB |
| Peak process RSS | 621.1 MB | 601.1 MB |
| Median signed offset | 0.461 mm | 0.462 mm |

Detector acceptance and fallback reasons match in all 36 cases. The lost
loopback classification is the clear-hub needle; it remains fragmented and
still misses about 3 mm. The main automatic failure modes remain: pale tube
caps, transparent syringe parts, and attached shadows. Keeping the same number
of ≥1 mm omissions does not establish correct physical fit.

Detection is about 6% slower in this desktop run. These times exclude subsequent
curve cleanup, original-photo decoding/reprojection, and calibration. RSS is a
single-run process measurement, not evidence of a reliable memory improvement.

## Regression signals

The table flags increases of at least 0.1 mm in omission or excess, any newly
crossed 1 mm threshold, an F@0.5 drop of at least 0.02, an increased loopback
count, or a newly ≥10% jagged edge. Smaller changes are retained in the full
36-case table below. F@0.5 measures reference-boundary agreement within 0.5 mm;
higher is better. These sparse draft references are not independent ground truth.

| Case | Regression | Visual/metric context |
| --- | --- | --- |
| Fanttik soldering iron (s10) | Excess 0.996 → 1.061 mm | Small shift crosses the 1 mm threshold; no missing material in either result. |
| Fanttik stand base (s12) | F@0.5 0.142 → 0.075 | Small contour shift; maximum excess improves 0.843 → 0.826 mm. |
| Rub ’n Buff (s18) | Jagged share 0 → 14.4% | Visibly rougher boundary and a retained bottom spike. Both versions miss the pale cap by about 9.8 mm. |
| Ryobi cutter (s19) | F@0.5 0.087 → 0.049 | Maximum excess improves 1.525 → 1.377 mm; the printing spur from the uncertainty-mask experiment is absent. |
| Flux syringe (s21) | Omission 7.772 → 7.878 mm | Existing omitted transparent part becomes 0.106 mm worse. |
| Tarkit mould-line remover (s23) | Omission 1.054 → 1.155 mm | 0.101 mm worse against the draft reference. |
| Wiha single B (s27) | F@0.5 0.770 → 0.693 | Maximum excess improves 1.129 → 1.095 mm; the narrow shaft remains present. |
| Wiha single C (s28) | Omission 0 → 0.108 mm | New small omission; maximum excess improves 1.127 → 1.095 mm. |

The stricter preservation checks can retain roughness in the accepted silhouette
that Claude's smoothing removed. They protect that silhouette rather than
identifying the true physical object. No per-photo exceptions or tuned thresholds
were added to hide these regressions.

## Additional checks and limits

A synthetic 30 mm pointed extension with a 0.5 mm base loses 0.762 mm under
Claude's smoothing and zero under the combined guard. Tests also cover holes,
separate tools, short notches between vertices, work-budget rejection, and
bounds on inward/outward movement. A 4-pixel notch that passed the previous
P95-only replay check is now rejected; an empty result is counted as a miss.

Integration tests recover an object removed by a solid printed region using
its original RGB through both color detection and the TEED fallback. They do
not establish that correction strokes solve every real photograph. Sheet-print
removal itself is unchanged and can still erase objects inside printing.

These captures predate the exact raster-transform recording and contain already
rectified crops. This comparison therefore does **not** validate original-photo
reprojection or exact final app replay. Source mapping, bounded resampling,
worker cancellation, correction interactions, draft recovery, and rotation are
covered by local automated tests. Fresh browser captures, phone performance,
independently reviewed outlines, and physical fit remain unqualified.

Local generated artifacts (gitignored): `exports/comparison/comparison.html`
contains all 36 paired photographs with toggleable outlines and regression
links. `regression-examples-1.png`, `regression-examples-2.png`, and
`rub-n-buff-comparison.png` show the inspected regressions. `regressions.json`
contains every delta; `input-manifest.json`, `source-manifest.json`, and
`run-manifest.json` record provenance. `contracts.json` records the synthetic
comparison.

## Local verification

- `npm run check`: passed under Node 22.23.4.
- `npm test`: 255 files, 3,950 passed and 1 existing expected failure.
- `npm run test:workflows`: all 18 files and 627 tests passed.
- `npm run build`: passed; existing large-chunk advisory remains.
- `git diff --check`: passed.
- Two fresh 36-case detector evaluations and the synthetic comparison completed.

A post-evaluation correction ensures brush width keeps its physical size when a
photo quarter-turn resizes the working raster. Its reducer test and the complete
quick suite pass. It does not change the detector or evaluator used above.
Detailed CAD/export qualification was not rerun: kernel, pocket construction,
printable aids, and serialized export implementations are unchanged. No physical
print or browser/device qualification is claimed.

Dependency and provenance review: **None added or changed.** Existing project
code and attribution are preserved; no third-party code/assets, package versions,
hosted CI, PR, push, or deployment are included.

## All 36 paired results

| Case | Omission before → after | Excess before → after | Δ F@0.5 | Jagged before → after | Flags |
| --- | --- | --- | --- | --- | --- |
| s01-black-click-pen | 0.276 → 0.176 | 1.097 → 1.064 | +0.022 | 0.9% → 4.6% | — |
| s02-brass-nameplate | 0.000 → 0.000 | 0.992 → 0.844 | +0.030 | 0.0% → 0.0% | — |
| s03-craftsman-hex-keys | 0.000 → 0.000 | 0.730 → 0.687 | +0.060 | 0.0% → 0.0% | — |
| s04-craftsman-tape-measure | 0.020 → 0.007 | 0.703 → 0.690 | +0.037 | 0.7% → 0.6% | — |
| s05-dewalt-screwdriver | 1.595 → 1.617 | 2.335 → 2.383 | +0.009 | 0.0% → 0.0% | — |
| s06-digital-calipers | 0.220 → 0.134 | 1.418 → 1.351 | -0.015 | 0.0% → 0.5% | — |
| s07-needle-clear-hub | 2.968 → 2.943 | 0.406 → 0.431 | +0.012 | 3.1% → 3.0% | — |
| s08-needle-pink-hub | 0.138 → 0.061 | 0.458 → 0.450 | +0.000 | 0.0% → 0.0% | — |
| s09-fanttik-desoldering-pump | 0.000 → 0.000 | 1.212 → 1.174 | -0.002 | 0.0% → 0.0% | — |
| s10-fanttik-soldering-iron | 0.000 → 0.000 | 0.996 → 1.061 | -0.012 | 0.0% → 0.0% | new excess >=1 mm |
| s11-fanttik-stand-arm | 0.000 → 0.000 | 0.860 → 0.831 | +0.008 | 0.3% → 0.3% | — |
| s12-fanttik-stand-base | 0.000 → 0.000 | 0.843 → 0.826 | -0.067 | 0.0% → 0.0% | F@0.5 -0.067 |
| s13-flipper-zero | 0.000 → 0.000 | 0.708 → 0.653 | +0.024 | 0.0% → 0.0% | — |
| s14-folding-knife | 0.044 → 0.037 | 0.803 → 0.610 | +0.005 | 0.9% → 0.8% | — |
| s15-gerber-multitool | 0.094 → 0.000 | 3.806 → 3.805 | +0.001 | 0.0% → 0.0% | — |
| s16-gray-click-pen | 0.000 → 0.000 | 0.797 → 0.795 | -0.018 | 0.0% → 0.0% | — |
| s17-mini-ratchet | 0.084 → 0.003 | 0.611 → 0.577 | +0.049 | 0.0% → 0.0% | — |
| s18-rub-n-buff | 9.760 → 9.797 | 1.159 → 1.220 | +0.064 | 0.0% → 14.4% | new >=10% jagged edge |
| s19-ryobi-cutter | 0.000 → 0.000 | 1.525 → 1.377 | -0.038 | 0.0% → 0.0% | F@0.5 -0.038 |
| s20-flux-syringe-plunger | 4.832 → 4.846 | 0.896 → 0.683 | +0.102 | 1.7% → 4.8% | — |
| s21-flux-syringe | 7.772 → 7.878 | 1.389 → 1.389 | -0.019 | 2.5% → 3.3% | omission +0.106 mm |
| s22-stapler | 0.000 → 0.000 | 3.056 → 3.039 | +0.006 | 0.3% → 0.7% | — |
| s23-tarkit-mould-line-remover | 1.054 → 1.155 | 1.715 → 1.718 | -0.004 | 0.0% → 0.0% | omission +0.101 mm |
| s24-deburring-tool | 0.000 → 0.000 | 9.951 → 9.903 | +0.026 | 0.0% → 0.0% | — |
| s25-tweezers | 0.047 → 0.000 | 0.844 → 0.831 | +0.004 | 0.0% → 0.0% | — |
| s26-wiha-single-a | 0.000 → 0.000 | 1.342 → 1.279 | -0.006 | 0.0% → 0.0% | — |
| s27-wiha-single-b | 0.000 → 0.000 | 1.129 → 1.095 | -0.077 | 0.0% → 0.0% | F@0.5 -0.077 |
| s28-wiha-single-c | 0.000 → 0.108 | 1.127 → 1.095 | +0.001 | 0.0% → 0.0% | omission +0.108 mm |
| s29-wiha-150mm-1 | 3.000 → 2.992 | 0.595 → 0.685 | -0.001 | 2.0% → 2.6% | — |
| s30-wiha-150mm-2 | 0.850 → 0.848 | 1.356 → 1.359 | +0.002 | 0.6% → 0.5% | — |
| s31-wiha-150mm-3 | 0.000 → 0.000 | 6.166 → 6.181 | +0.005 | 0.0% → 0.0% | — |
| s32-wiha-150mm-4 | 0.000 → 0.000 | 2.280 → 2.293 | +0.018 | 0.0% → 0.0% | — |
| s33-wiha-150mm-5 | 0.000 → 0.000 | 1.495 → 1.420 | +0.009 | 0.0% → 0.0% | — |
| s34-wolfbox-air-duster | 0.000 → 0.000 | 0.931 → 0.780 | +0.010 | 0.0% → 0.0% | — |
| s35-wolfbox-cone-nozzle | 0.009 → 0.000 | 0.518 → 0.421 | +0.002 | 0.0% → 0.0% | — |
| s36-wolfbox-long-nozzle | 0.000 → 0.000 | 0.898 → 0.858 | +0.011 | 0.0% → 0.9% | — |
