# Photo outlines

The [1.9 → 1.10 release comparison](outline-detection-1.9-to-1.10.md) shows the default output on every entry in the maintainer-selected reference set, including improvements, remaining errors and tradeoffs.

The [combined detector](outline-combined-detector.md) adds geometry preservation
and original-photo sampling to Claude's detector.
The [Craftsman follow-up](outline-craftsman-fix-2026-11-11.md) and
[original-photo UI comparison](outline-ui-validation-2026-11-11.md) preserve earlier
branch evidence. The November 15 release comparison above records the 1.9/1.10
defaults; none of these reports qualifies every later build. Cached replays
cannot qualify photo behavior.

**Tool edges · white sheet** is the default for new sessions. Draw a region
around one tool, leaving light paper visible around it. **Automatic · match
background** remains available and checks that rim:
light neutral paper uses **Tool edges · white sheet**; recognized sheet markers
also support shaded neutral paper. Dark, colored or uncertain
surroundings use **Color contrast**. Either method can be selected manually.
Existing saved method choices are preserved, including older color-only drafts.

[Before/after comparisons for all single-tool white-sheet subjects](../client/public/reports/outline-comparison/index.html)
are included as a portable HTML report, with one view per distinct tool or
attachment. In a running build, open `/reports/outline-comparison/`. The report
preserves the November 5 PR comparison, before the later combined-detector and
straightening changes; optional columns show the original detector before that
PR and the rejected color-fusion experiment. It is historical diagnostic evidence,
not the current release comparison.
Each driver from the group photo is selected individually. A tighter region
around the deburring tool excludes its support wire's long tail on both sides.
Repeated views, trays and retail cases are omitted. Wood-background controls
were tested separately.

## What we tried and kept

- **Color and GrabCut:** bounded, mask-seeded CPU/WASM refinement can reduce
  shadows, but cannot reliably recover reflective material missing from the
  original color mask. It remains the color-path refinement and fallback.
- **Learned edges:** TEED follows outer silhouettes more reliably on the reviewed
  white-sheet photos. Its tiny model runs through the existing OpenCV worker,
  without another inference runtime or GPU requirement. Unsupported or fragmented
  results retain color detection; alpha silhouettes stay authoritative.
- **Boundary cleanup:** class-preserving edge interpolation avoids artificial
  slits. Auto sensitivity checks a bounded set of thresholds on one inference,
  recovering supported fragments while protecting paper gaps and independent
  tools. Incomplete automatic detections on large original-photo inputs may retry
  once with area-averaged model input, preserving existing manual sensitivity
  behavior and complete detections. Acceptance must recover seeded material
  without losing already-covered seeds or changing unknown regions. A finer search confirms candidates at adjacent thresholds when the coarse
  search cannot recover a stable boundary. Crop-spanning printing can trigger a
  bounded recovery using raw and gap-repaired enclosed regions. Broad genuinely
  cropped foreground and losses of supported material reject that recovery.
  Color evidence constrains candidates but is never fused into the edge map.
  Recognized reference strips are handled locally; short hidden edges
  are estimated and highlighted amber for review. Before line/curve fitting,
  evidence-supported narrow slits and parallel shadow rails are repaired locally.
  Seeded material, paper gaps, thin frames, recognized aids and separate objects
  are protected; repairs must preserve foreground and background connectivity.
- **Lines and curves:** automatic cleanup reconstructs supported straight
  runs and approximates rounded spans with points. Editable curves opts into
  native Bézier handles. Symmetry, straightening, calibration, recovery and Undo
  preserve the chosen representation.

## Editing

Choose **Edit outline** to adjust the contour over the photo. Drag a point to
move it, click an edge to add a point, or select a point and choose **Delete
point**. The controls wrap to fit the canvas. On phones and short windows,
the editor uses the full screen until you choose **Done**. Undo restores the
previous contour. Older drafts open with their saved outlines and edit history. A fresh detection starts from the photo and
ignores brush marks saved by earlier versions.

Detection finds a boundary, reconstructs supported lines and rounded sections,
and applies the bounded smoothing pass automatically. The finishing pass permits
up to 0.2 mm of movement (2 px without calibration) from the reconstructed outline.
It must also stay within the original material-detail allowance and must not add
broader boundary ripples. A rejected proposal keeps the reconstructed boundary.
Point mode samples fitted curves; Editable curves is off by default.

**Include interior holes** stays available with every detection method. Enabling
it with **Tool edges** asks to switch to **Color contrast** and re-detect, explaining
that the current outline and adjustments will be replaced. Cancel keeps the
outline and settings unchanged; Undo restores them after successful detection.
**Automatic** uses Color contrast when holes are enabled. Help icons beside the main
actions explain their purpose on hover, keyboard focus, or tap. **Add manual
contour** can trace an inner feature for a different pocket depth in Bin.
**Import outline from file** loads an SVG, and **Move & rotate outline** adjusts
contours over the fixed photo.

**Manual detection settings**, below the contour list, contains sensitivity,
point simplification and **Smooth outline**. Optional smoothing previews the current accepted outline,
including manual edits, with Original/Preview comparison and one undoable Apply.
A checkmark indicates smoothing already applied during detection or a previous
Apply; Apply is disabled. A dash marks a preview that would make no change.
Hover or keyboard focus explains either indicator. The retained source survives
Apply, Undo and recovery, including drafts saved with the former detail presets,
so smoothing does not compound. Manual edits or geometry changes establish a new
source. Fresh detection establishes its own automatically smoothed result.

**Restart outline detection**, at the bottom of the Outline section, starts again
from the current photo within the selected region. Switching detection methods
uses the same restart flow. Switching an untouched detection needs no confirmation;
switching asks only when it would discard manual tuning,
outline edits, or an incompatible interior-hole setting. Explicit Restart still
asks before replacing an existing outline.
Sensitivity returns to Auto, Simplification to 1.2 px, and detection smoothing
to its default. The new contour replaces the previous edits.
Photo selection, rotation/perspective correction, calibration, region and margin
are retained, as is the editable-curve preference. The interior-hole preference
is retained where supported; Tool edges turns it off.

Method-specific tuning is reset because a sensitivity bias or point tolerance
chosen for one detector need not suit another. Within a method, sensitivity and
interior-hole changes re-read the photo with the current tuning. They ask
before replacing manual edits, including brush edits from an older draft. The manual Simplification slider
works from the accepted refinement base, including committed edits. Optional smoothing
starts from the currently displayed boundary and retains that source until
another edit or detection establishes a new one. It smooths small bumps within its
allowance; it cannot recover missing material or remove a large segmentation error.

The earlier silhouette is retained as `rawOutline` in working-photo coordinates,
after the pipeline's bounded outward smoothing but before simplification,
line/curve fitting, small-dip straightening, and finishing polish. The separate
unsmoothed `materialOutline` guards later geometry changes; it is not the displayed
comparison. The comparison includes segmentation and accepted occlusion repair. It can expose detail removed by fitting,
but cannot recover material segmentation never detected. Shadows or slits may remain. **Detected outline** under Manual detection settings
previews this contour in green without changing saved/exported geometry. The
conditional **Use detected outline** action replaces the current outline and edits
in one Undo step, retaining the photo, calibration, region and margin. Native
handles are replaced by detected points; Undo restores them with the prior
smoothing state. An already-used contour disables the action with a checkmark.
Explanations and unavailable-state reasons use hover/focus hints. Preview state is
not saved; source/geometry/settings changes, editing tools or Escape dismiss it.
The compact Adjust tray includes the same controls.

Fresh detection publishes geometry, its evidence and its settings together.
Failure keeps the previous outline and settings. Undo/Redo and saved-draft recovery
restore the matching method, sensitivity, hole choice and raw boundary with the
outline, so later refinements use the correct source.

Enabling Editable curves on an existing detection asks whether to keep the current
outline or re-detect and replace edits; Undo can restore the previous source. Detection and cleanup commit together as one Undo
step. Unsupported fits keep the detected boundary; cleanup never guesses across rejected topology.

**Add manual contour** starts a four-point contour. Click an edge to add a point;
right-click a point to delete it. Shift-click or box-select multiple points;
**Select points** also works without a keyboard. **Repair section** replaces a
selected run with a previewed line or curve. See [curve editing](contour-curves-prototype.md).

The smoothing allowance measures movement from the current accepted outline,
not from the physical tool and not pocket clearance. Review tool tips, recesses,
shadows and amber estimated edges. Interior-hole detection requires Color contrast;
Automatic selects that method when holes are enabled. Multiple tools and transparent
parts remain challenging; select one tool at a time. Ambiguous attached shadows,
including the lower Gerber spur shown in the report, are deliberately retained.
Clipped-region recovery can still lose a narrow solid edge band with neither an
enclosed interior nor color support. Accepted recoveries carry review diagnostics;
this known limitation remains covered by an expected-failure test. Review thin
shafts and tips before using the outline.

## Performance and verification

The historical November 5 HTML report gives desktop CPU/WASM
detection-plus-cleanup timings for 36 distinct tool regions. That branch added
boundary reconstruction and finer sensitivity search without color fusion.
Against its previous PR default, visual review found four improvements, two
mixed results and 30 unchanged results. Disabling fusion avoided five regressions from the combined
experiment but also gave up its syringe improvement. Printing, reflections and
transparent material remain difficult. These development photos are not a held-out
accuracy benchmark, and sparse feature checks are not contour ground truth.

Historical diagnostics replay 36 subjects and 115 cached views, including crop
and rotation controls. Those replays are not end-to-end qualification. Current
photo checks start from originals and use the full calibration, region and
settings UI flow required by CLAUDE.md.
Local synthetic checks cover separate tools, paper recesses, unknown reference
strips and supported shafts; the unseeded-shaft counterexample is retained as an
explicit expected failure. Phone speed, peak memory and physical fit remain
unqualified.

For changes in this area, use `npm run check`, `npm test`, and the affected
workflow/geometry suites under [CLAUDE.md](../CLAUDE.md), plus `npm run build`
and `git diff --check`. Focused regressions cover small-tool merges, line/curve
bounds, shared holes, interrupted touch edits, calibrated recovery, and Undo.
These are verification instructions, not a claim of a new run. Record actual
commands and results with each change. GitHub CI remains disabled; raw
experimental records are kept outside the repository.

## Model provenance

The fixed 512×512 TEED ONNX model is **248,782 bytes**, loaded only when needed.
It uses the existing OpenCV CPU/WASM runtime and adds no npm dependency.
Source revision `40fa4b1391dc6424f88989d0ca75d5b592c8681d` includes the BIPED
checkpoint under repository-level MIT terms (Xavier Soria Poma, 2022), without a
separate weights license or model card. No training dataset or Python implementation
is redistributed. Exact source/checkpoint/export hashes, conversion details and
attribution remain in [NOTICE](../NOTICE), with the full served license in
`client/public/models/teed/LICENSE.txt`. The OpenCV change is a worker-compatible
UMD wrapper; its embedded WASM is unchanged. Report crops are maintainer-supplied
photos with EXIF metadata removed.
