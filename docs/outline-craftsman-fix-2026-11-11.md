# Craftsman and manual controls follow-up — November 11, 2026

The initial combined version introduced both reported regressions. Its geometry
guards rejected useful smoothing and restored dense contours. The same fixed
0.1 mm budget silently rejected explicit manual simplification, so changing the
slider could have no visible effect. The changes below are local to the
independent `codex/outline-combined` worktree, following `b907790c`.

## Changes

- Automatic smoothing, simplification, and final cleanup share the requested
  detail allowance, with a minimum of 0.1 mm. Previously, smoothing used a
  different tighter allowance and final cleanup was capped at only 40% of the
  fixed limit. Exceeding either could restore the dense staircase.
- The outward check measures the proposed boundary's displacement. It no
  longer treats filling a thin recess as outward growth equal to that recess's
  depth. Inward material and contour topology checks remain.
- Manual simplification honors the user-selected tolerance. The controls are
  labeled **Manual**. Existing refinement, margin and authored-ring handling
  remain in place.
- The offline evaluator uses the same automatic allowance as the app. The
  uncertainty mask remains absent.

## Craftsman reproduction

The reported photo is `20261017_102135`, on the Pocketry sheet. The original
36-case set used a different Craftsman photo (`20261017_102958`) with a reference
strip. That coverage gap hid this regression. The on-sheet crop is now a
maintainer-photo fixture with source hash and preparation recorded in
`client/src/lib/detect/fixtures/README.md`.

On identical prepared pixels at default detail (1.2 px), the corrected result
matches Claude in all four tested combinations:

| Detector / sensitivity | Initial combined points | Fixed points | Claude points |
| --- | ---: | ---: | ---: |
| Color / auto | 780 | 229 | 229 |
| Color / +56 | 1,662 | 301 | 301 |
| Tool edges / auto | 638 | 157 | 157 |
| Tool edges / +56 | 620 | 159 | 159 |

Segmentation decisions match; the change is cleanup. Fewer points alone are
not an accuracy measure. The new app-entry tests run actual OpenCV/TEED and
cleanup, replace only worker transport, and independently measure retained
material along the contour. They also exercise manual simplification.

In the live browser draft, color detection at +56 and 2.3 px detail changed
from 1,647 to 204 points after re-detection. Automatic mode produced a smooth
153-point boundary, including the small top-left tab. Changing manual
simplification from 2.3 to 2.4 px reduced that outline to 33 points. The
browser uses its existing working image; its resampling and detail setting
differ from the prepared test crop. Color detection still misses the little
tab in this photo, as Claude's color path does; automatic/tool-edge detection
captures it.

## Repeated 36-case comparison

The corrected combined detector was rerun over all 36 unchanged RGBA inputs
with `--outer-smoothing on --sheet-ink on`. Claude's earlier results at
`5aefd804` were reused after checking its source hashes and all input hashes.
**All 36 final contour arrays are exactly equal to Claude's.** There are no
regression flags or nonzero contour-metric deltas. The original eight flagged
changes are gone.

| Measure | Claude | Corrected combined |
| --- | ---: | ---: |
| Accepted / fallback | 34 / 2 | 34 / 2 |
| Automatic cleanup applied | 36 | 36 |
| Omission ≥1 mm | 7 | 7 |
| Excess ≥1 mm | 18 | 18 |
| Cases with loopbacks | 5 | 5 |
| Cases with ≥10% jagged edge | 0 | 0 |
| Median detection time | 849 ms | 837 ms |

Timing is from separate desktop runs and excludes final curve cleanup. It is
not evidence of a speed improvement. References remain draft; equality to
Claude preserves its known limitations on transparent parts, pale caps and
shadows. This comparison does not qualify original-photo reprojection, phone
performance or physical fit. Automatic cleanup now permits the selected
detail tolerance, so features smaller than that tolerance can change.

Local artifacts are under `exports/craftsman-fix-comparison/`: the portable
`comparison.html`, all per-case contours, `regressions.json`, and input/source/run
manifests. The four-mode photo reproduction is in `exports/craftsman-regression/`.
Initial artifacts under `exports/comparison/` are retained unchanged.

## Local verification and provenance

- `npm run check`: passed with Node 22.23.4.
- `npm test`: 256 files; 3,954 passed and 1 existing expected failure.
- `npm run test:workflows -- bin-designer.pockets bin-designer.navigation`:
  2 files, 119 passed.
- `npm run build`: passed; existing large-chunk advisory remains.
- `git diff --check`: passed.
- Browser: actual on-sheet photo, color and automatic detection, responsive
  manual simplification, and the Manual label verified locally.

Detailed CAD/export qualification was not rerun because kernel, construction
and export implementations are unchanged. No physical print test was performed.

Dependencies and third-party code/assets: **None added or changed.** The new
fixture derives from the maintainer's photo; no EXIF metadata is retained.
Existing notices and Claude's branch ancestry are preserved. No push, PR,
hosted CI, package version change or deployment is included.
