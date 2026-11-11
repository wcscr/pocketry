# Auto simplify smoothing fix — November 11, 2026

Local follow-up to `ab621029` on `codex/outline-combined`, in the independent
worktree. This supersedes the raw-evidence preview and numeric Auto controls in
[the earlier UI validation](outline-controls-2026-11-11.md).

## Problem and behavior

The preview reconstructed from the unsmoothed segmentation boundary, although
Original showed the already-cleaned outline. All levels could therefore restore
pixel noise and undo detection's rounding. Its larger allowances also increased
the error used to flatten curves into points. Earlier UI tests verified the
buttons and history, but did not establish that the resulting shape was smoother.

**Auto simplify outline** now provides only More detail, Balanced and Smoother,
Original/Preview, and Apply/Cancel. It has no separate smoothing/simplification
controls or numeric amount. The **Manual detection settings** button sits
immediately below Auto and expands the existing sensitivity and point slider.
Editable curves stays below Edit outline.

Auto uses only the current accepted outline. A separate worker operation makes
that contract explicit: it does not accept raw detection evidence. Each level
applies progressively wider arc-length Gaussian smoothing, with a displacement
cap and sharp-corner boundaries, followed by a tight curve fit. Source-curve
sampling, smoothing and fitting share one maximum movement budget. The levels
permit 0.05 / 0.1 / 0.2 mm, or 0.5 / 1 / 2 uncalibrated pixels. Point sampling
stays fine independently of the level. The resulting point count can increase;
fewer vertices alone do not establish smoothness.

Each stronger choice also considers the weaker safe results and retains one if
its proposed fit adds alternating bumps or violates topology. This can plateau
on an already smooth or constrained feature. All operations are bounded, leave
the source untouched, and apply as one undoable edit. The automatic detector and
its reconstruction defaults are unchanged. No uncertainty mask was added.

## Shape validation

The 36 accepted outlines from the preceding Craftsman-fix comparison were tested
at all three Auto levels: **108 previews**, zero errors, zero measured increases
in alternating bumps compared with the source or the weaker level, and zero
movement-limit violations. Maximum observed movement was 0.1914 mm; the largest
certified bound was below 0.2 mm. The fine flux-syringe-plunger result remained
unchanged; the other 107 previews changed the geometry.

| Result across 36 outlines | Alternating bumps | Boundary length in bumps |
| --- | ---: | ---: |
| Original | 19 | — |
| More detail | 14 | 35.1 mm |
| Balanced | 8 | 20.1 mm |
| Smoother | 6 | 14.4 mm |

Roughness uses 0.05 mm boundary sampling, 0.5 mm spatial scale and 0.05 mm minimum
amplitude; these measurements do not prove perceptual improvement at every scale
or accuracy against the physical tool. This reruns optional smoothing on the
frozen accepted outlines, not the unchanged image detector. Local inputs and
results are in `exports/craftsman-fix-comparison/combined/` and
`exports/simplify-smoothness/36-case-results.json`; the diagnostic script is beside
the latter. These artifacts are ignored and were not published.

The actual on-sheet Craftsman photo supplied in this chat is also exercised by
the real OpenCV/TEED image-processor regression, separately from the reference-strip
Craftsman image in the 36-case set. Both Color contrast and Tool edges keep their
accepted silhouette within each preset's bound without adding measured bumps.
A synthetic rippled circle independently measures RMS radial ripple rather than
point count: **0.0948 → 0.0772 → 0.0265** across the three levels. Tests also cover
native-curve bounds, fine tessellation, corners, holes, multiple shapes, worker
cancellation, the accepted-source contract, and the Manual button's order/toggle.

Local browser inspection used the on-sheet Craftsman draft with Tool edges and
+56 sensitivity. All levels, Original/Preview, Apply and Undo were exercised.
Undo restored the original 153 points. The Smoother result used 458 finely sampled
points. Desktop and 390-pixel viewport layouts were inspected and the viewport
was reset. Screenshots are in `exports/simplify-smoothness/`; `smoother.jpg` shows
the new sidebar order and preview, and `final-preview.jpg` shows the outline larger.

## Local verification and provenance

Node 22.23.4:

- `npm run check`: passed.
- `npm test`: 257 files; 3,964 passed, one existing expected failure.
- `npm run test:workflows`: 18 files; 627 passed.
- `npm run build`: passed, with the existing large-chunk advisory.
- `git diff --check`: passed.

Detailed CAD/export qualification and physical printing were not run; neither CAD
construction nor export serialization changed. Phone layout was inspected in a
desktop browser viewport, not benchmarked on phone hardware.

Dependencies and third-party code/assets: **None added or changed.** The smoothing
code is original maintainer-requested work using existing geometry utilities.
The added caliper fixture is derived numeric output from the maintainer-provided
36-case evaluation; its provenance is in `shared/geometry/fixtures/README.md`.
No push, PR, version bump, hosted CI or deployment is included.
