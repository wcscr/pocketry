# Correction toolbar verification — November 12, 2026

Correct now opens visible Add/Remove tools, a pan tool, Clear and Done. Color,
pressed states and the brush cursor identify the current tool. Hover/focus hints
replace the persistent instructions. Each stroke still invokes the existing
detector; this follow-up changes interaction and history labels, not detection
algorithms or default geometry. The preceding 36-photo detector comparison was
not rerun for this UI change.

## Original-photo UI checks

Both cases started from the original JPEG on its calibration sheet, accepted
automatic perspective correction and scale, and selected a region by dragging
the UI. Defaults were exercised before any correction. Tests used an isolated
local origin and cleared the previous test trace through Start Over before each
import. No prepared pixels, calibration or application state were injected.

Original hashes, actual SVG region rectangles, ordered UI actions, resulting
paths/marks and screenshots remain local in
`exports/original-photo-ui/correction-workflow/`.

- **Rub ’n Buff:** Add and Remove strokes each committed one correction. Undo
  restored the exact Add result; Redo restored the exact Remove result. Done
  preserved the geometry and hid marks, with a check on Correct. Reopening
  restored both marks. Panning added no marks and changed no geometry. Clear
  restored the exact default outline; Undo restored both corrections. Escape
  worked from a focused brush button. Hints appeared on keyboard focus. The
  toolbar and Done were inspected at 390 × 844 CSS pixels.
- **Craftsman:** fresh default detection, entering/exiting Correct, and switching
  between Correct, Smooth outline and Detected outline preserved the exact
  accepted contour. Only the selected interaction was active at a time.

These are interaction checks, not a claim that corrections perfectly segment
the tool. In this Rub ’n Buff run, the Add stroke recovered part of the lid but
left a rough neck; Remove left a small separate fragment. The existing detector's
limitations remain. No physical-fit or phone-performance qualification occurred.

## Automated checks

Synthetic mouse/touch coverage verifies Add/Remove payloads, panning, canceled
and lost-capture strokes, region bounds, busy controls, Clear/Undo/Redo, mark
visibility, manual-edit protection and transition out of editing. Additional
coverage checks that raw-contour review and correction drawing are mutually
exclusive.

Local checks passed: `npm run check`; `npm test` (4,007 passed, one existing
expected failure, nine quarantined cropped-photo checks excluded); all 627
`test:workflows` tests; `npm run build`; `git diff --check`. Hosted CI remained
disabled. CAD/export qualification was not rerun; mesh/export construction is
unchanged. Dependencies, models, third-party code and assets: **None added or
changed**.
