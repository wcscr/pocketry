# Contour symmetry prototype

Available under **Outline → Symmetry & straighten**, and in the phone's
**Adjust** controls.

- Suggests a lengthwise centerline; its endpoints support dragging and arrow keys.
- Mirrors the left or right profile, or averages their widths around the axis.
- Overlays the original and proposed contours on the existing photo.
- **Align upright** optionally rotates the result so the chosen axis is vertical,
  with a separate upright preview. Rotation preserves size and calibration.
- Preserves lengthwise tapers and shoulder steps; does not rerun detection.
- Applies only to the chosen shape, with one manual-edit history entry.
- Cancel discards the preview; Undo and Redo preserve the original and result.

This prototype handles straight silhouettes with one continuous cross-section
at each point along the axis. It rejects holes, branched cross-sections, and
mirrored halves that split into pieces rather than inventing filled geometry.
The axis is a suggestion and can be biased by shadows. Symmetry is a manual
correction, not a measurement of the true photographed boundary. It centers the
profile about the chosen axis. Upright alignment rotates the contour about the
axis midpoint; the photo stays unchanged for comparing the original trace.

Local validation (Node 22): `npm run check`, `npm test` (2,767 tests in 156
files), `npm run build`, and `git diff --check` passed. Two existing 3D tests
timed out during a concurrent build; both passed alone and the full suite
passed on rerun without the build. New tests cover exact widths, shoulders, upright rotation
without resizing, axis estimation, unsupported geometry, selected
shape isolation, calibration preservation, stale previews, and pointer cancel.

In the live browser, the user's driver trace exercised side selection, endpoint
dragging, Apply, and Undo. Applied coordinates matched the preview; Undo and a
subsequent reload restored the original 22-point contour exactly. Phone layout
was checked at 390 × 844. Screenshots are local review artifacts under
`/private/tmp/pocketry-symmetry-prototype/`. No GitHub CI was run.

Upright alignment was also previewed on the user's current driver trace. The
photo comparison stayed fixed while the result rotated upright. Toggling the
option left the original contour unchanged. Apply and Undo are covered by the
component tests; this browser check left the user's current trace untouched.
