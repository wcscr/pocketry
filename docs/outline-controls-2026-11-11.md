# Outline controls follow-up — November 11, 2026

**Historical UI validation at `ab621029`.** The later [smoothing fix](outline-simplification-fix-2026-11-11.md) replaces the raw-evidence preview and Custom amount control described here.

Local work on `codex/outline-combined`, following the Craftsman fixes at
`f595eea`. This addresses the confusing simplification preview and control order.

- **Simplify outline** exposes More detail, Balanced and Smoother directly.
  Choices update the preview immediately; there is no Update preview step.
- **Custom amount** holds the optional exact distance. Typing updates after
  250 ms; changing the amount invalidates the previous Apply action immediately.
  Cancel, source changes and new requests abort queued or running work.
- **Original / Preview** compares the current outline with the proposed edit.
  Point counts use the same visible baseline, rather than the denser hidden
  detection evidence. Reconstruction still uses that evidence, so choosing more
  detail can add points to an already simplified outline.
- **Apply / Cancel** retain the explicit preview contract. Apply creates one
  Undo step; Cancel and Escape leave the saved outline unchanged.
- **Editable curves** moved below the main outline actions. Its existing
  confirmation before re-detection remains. Sensitivity and the point slider are
  grouped under **Manual detection settings**.
- New sessions explicitly default to **Tool edges · white sheet**. Automatic
  background selection and Color contrast remain available. Explicit saved
  choices and the legacy color-draft migration are preserved.

Verification under Node 22.23.4:

- `npm run check`: passed.
- `npm test`: 256 files, 3,955 passed and 1 existing expected failure.
- `npm run test:workflows`: all 18 files and 627 tests passed.
- `npm run build`: passed with the existing large-chunk advisory.
- `git diff --check`: passed.
- Local browser: presets, Original/Preview, custom amount, Cancel, Apply and
  Undo exercised on the actual Craftsman draft. Desktop and 390-pixel viewport
  layouts inspected; the viewport override was reset afterward. The final
  screenshot is `exports/craftsman-regression/outline-controls-redesign.jpg`.

The automatic detector and cleanup algorithms are unchanged by this UI follow-up;
the 36-case image comparison was not repeated. Its preceding results are in the
[Craftsman report](outline-craftsman-fix-2026-11-11.md). Detailed CAD/export and
physical-print qualification were not run for this controls-only change.

Dependencies and third-party code/assets: **None added or changed.** This is
maintainer-requested original UI work using existing components and dependencies.
No push, PR, hosted CI, version bump or deployment is included.
