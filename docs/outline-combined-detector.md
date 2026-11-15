# Combined outline detector

This integration starts from `claude/outline-detection-pathologies` at
`5aefd804`. It keeps the same dark-on-paper segmentation, TEED inference, and
fallback decisions, and adds geometric preservation checks, source-photo
sampling, and explicit user corrections. Four later changes are described
where they apply below: the sheet layout is read from the photo, paper no longer
reaches into a tool through a narrow gap, the default smoothing fills dips
without multiplying points, and small dips are bridged with a straight line
before that smoothing. There is no printing-uncertainty mask or experimental
source-edge fitting stage.

## Detection and corrections

New sessions default to **Tool edges · white sheet**. Automatic background
selection and Color contrast remain available; saved drafts retain their method.
Sensitivity, point simplification, optional **Smooth outline**, and the
**Detected outline** comparison are under **Manual detection settings**, below
the contour list. **Editable curves** sits below the main outline actions.
See [the control guide](teed-outline-integration.md) for current interaction details.

The automatic detector still receives Claude's copy with inferred sheet ink
removed. It preserves the original input separately. **Correct → Add** or
**Remove** supplies local tool/paper hard seeds to a bounded region solve using that
original appearance. Tool marks permit additions; paper marks permit removals.
Unmarked distant pixels retain the automatic proposal. Marks are checked again
against the final contour before clearance. An unsatisfied mark produces an error
and leaves the previous contour intact.

The correction controls support mouse/touch strokes, cancellation of an unfinished
stroke, Undo of a completed stroke, and **Clear correction marks**. **Done** hides
marks while retaining their effect; each completed stroke re-detects. Undo manual contour edits before correcting a
detection. Marks survive draft recovery and photo rotation; a new selected region
clears them. Appearance alone still cannot distinguish all shadows, reflections,
printing, or transparent parts. A stroke is an explicit constraint, not proof
that the surrounding inferred boundary is correct.

Sheet-print removal knows both printed layouts. v2 and v3 sheets share markers
and dimensions but print different text in different places. After perspective
correction, `detectSheetLayout` reads the first whole-sheet frame and looks for
text in the stretches that only one layout prints; removal then uses that
layout's areas alone. When the photo does not settle it (a tool covers those
stretches, or the print is too faint), the areas of both layouts are used.
Removal can still erase a short dark object wholly inside a text area or an
object crossing a solid marker area. Correction can recover such material from
the retained pixels, but automatic detection is still subject to those
limitations.

## Reconstruction

Paper is found by flooding inward from the region's border through pixels the
model did not mark as an edge; what the flood cannot reach is a candidate tool.
The flood passes only where the way through is wider than two model pixels (the
region's longer side is 512 model pixels), and is then grown back by one pixel.
Previously a faint stretch of a tool's own edge let paper into whatever bright
area lay behind it, such as a highlight on a dark part or a clear barrel, and
the tool came out hollowed or with an interior loop. The cost is that a real
opening that narrow is closed too. That can add a little material at a tight
notch; it cannot remove any.

One area-averaged retry still runs when automatic reconstruction leaves more
than 5% of the seeded material uncovered. It costs a second inference and is
kept only when it passes the existing acceptance checks.

## Geometry and source coordinates

Detection keeps two outlines. The **material reference** is the accepted
silhouette traced without smoothing. It is never shown; smoothing,
simplification, and final curve cleanup are all checked against it. The
**detected outline** is that silhouette after the bounded outward smoothing that
removes pixel stair-steps. Compare and restore show it, and manual detail
settings start from it, so neither brings the stair-steps back. With correction
marks, the detected outline falls back to the material reference if smoothing
would carry it across a mark.

The checks use an inward allowance equal to the requested detail tolerance,
with a minimum of 0.1 mm (0.5 working pixels without calibration). The outward
boundary allowance is 1 mm (4 working pixels without calibration), or the
outer-smoothing length when that is larger. All lengths are mapped to detection
pixels together. A spatial index and adaptive segment checks certify the
distance bound between vertices; topology checks reject crossed rings and
overlapping tools. Filling a narrow recess is bounded across its mouth, rather
than rejected because the old recess was deep. The checks work within a budget
that scales with the outline's length, between 100,000 and 250,000 steps, and
reject a result they cannot certify within it.

When a refinement is rejected, the fallbacks are tried in order: a conservative
simplification without smoothing, the smoothed detected outline, and only then
the material reference. Specks below the size limits are dropped in every case,
except a small part the user marked as tool or a small hole marked as paper.
These checks protect detected material; they cannot recover material
segmentation already missed. User clearance is applied afterward.

The default polish after cleanup (up to 0.2 mm) moves the boundary outward to
fill dips and allows a quarter of that inward, so it rounds a ripple without
shaving the tool. Its result is thinned again within the remaining allowance,
which keeps the point count close to the cleaned outline's instead of tripling
it. If the polish would cross a correction mark, the app keeps the detected
outline and says so.

Before that polish, **outward straightening**
(`shared/geometry/outline-straightening.ts`) replaces small dips with the
straight line over them: the ribs of a grip, a notch, a mold line, the last
wobble of the detector. A pocket has no use for that detail, and smoothing
cannot remove it without also shaving the crests either side. A line is taken
only when:

- nothing between its ends lies outside it, so no material is removed and the
  tool still fits;
- nothing between them is more than 0.5 mm behind it (5 px without a scale),
  each dip behind it is at most 10 mm wide along the line, and between two dips
  the outline comes back to within 0.1 mm of the line;
- both ends are convex corners of the outline and the line leaves each inside
  that corner's own turn;
- it meets no other part of the outline.

The width limit leaves a broad hollow or a long shoulder alone: those are the
tool's shape. The corner rule means a smooth concave curve is never cut into
flats, and the rule about coming back to the line means ribs on a curved edge
become short lines that follow the curve. Every point kept is a point that was
there. The straightened outline is then smoothed and checked exactly as before,
against the material reference and any correction marks, and the result must be
no rougher than the fitted outline. If a check fails, the app smooths the
outline as it was, so the result is never worse than without this step. The
detected outline that Compare and restore show is not straightened.

It takes under half a millisecond on a traced tool on a desktop and holds no
image data. An outline too intricate for its step budget is returned unchanged.
[The validation note](outline-straightening-validation-2026-11-14.md) has the
results on seven tools run through the app.

The **Manual detection settings** simplification control applies the user's chosen tolerance to
the refinement source. It does not silently cancel the adjustment under the
automatic detector's fixed minimum allowance. Automatic cleanup also uses the
same detail budget as detection; a separate sub-pixel cap previously defeated
smoothing and caused the Craftsman regression.

New perspective corrections retain the exact homography back to the original
photo. Tool detection samples a bounded original-image tile and reprojects the
selected region in the worker. The tile and output are each capped at a
2048-pixel long side. Existing drafts without this mapping keep the previous
working-raster path. Rotation composes the mapping; canceled or stale requests
cannot replace a newer detection. Exports keep the existing working-coordinate
calibration and single conversion to millimeters.

## Evaluation

The evaluator retains `--sheet-ink on|off` and adds `--hints prompts.json` for
separate assisted runs. A prompts file maps case names to correction strokes in
captured input pixels. Automatic comparisons use no marks.

New captures record the exact input-to-working transform. Legacy captures remain
valid for comparing detector output on the same pixels, but cannot establish
exact app replay by fitting contour bounds. Replay checks compare both complete
boundaries, so short notches cannot hide below a percentile threshold. Empty or
unmeasurable outputs count as missing-material failures when a reference exists.

`scripts/evaluate-outline-cases.ts` replays captured detector inputs. It is a
diagnostic: only a run through the app from the original photo qualifies a
photo result.

See the [November 12 full-workflow comparison](outline-full-workflow-validation-2026-11-12.md)
for that branch’s 36-tool results from original photos; the
[1.9 → 1.10 comparison](outline-detection-1.9-to-1.10.md) records the released defaults. The
[November 11 comparison](outline-combined-validation-2026-11-11.md) has
the initial 36-case results and the [Craftsman follow-up](outline-craftsman-fix-2026-11-11.md)
the corrected comparison, manual controls, and expanded photo coverage.

## Integration provenance (historical)

Dependencies and third-party code/assets: **None added or changed.** This combines
existing Pocketry work with maintainer-requested original implementation and
tests. A maintainer-photo crop was added as a regression fixture; its source hash
and preparation are recorded in `client/src/lib/detect/fixtures/README.md`.
Claude's baseline remains in the branch ancestry; existing notices and
attribution are preserved. The later changes described above are original
implementation and tests as well, with no new dependency, model, or asset. No
publication, deployment, or hosted CI run is part of this work.
