# Combined outline detector

This integration starts from `claude/outline-detection-pathologies` at
`5aefd804`. It keeps the same dark-on-paper segmentation, TEED inference, and
fallback decisions, and adds geometric preservation checks, source-photo
sampling, and an experimental solver for user-supplied marks. Four later changes are described
where they apply below: the sheet layout is read from the photo, paper no longer
reaches into a tool through a narrow gap, the default smoothing fills dips
without multiplying points, and small dips are bridged with a straight line
before that smoothing. There is no printing-uncertainty mask or experimental
source-edge fitting stage.

## Detection and corrections

New sessions default to **Tool edges · white sheet**. Automatic background
selection and Color contrast remain available; saved drafts retain their method.
Sensitivity and the **Detected outline** comparison are under **Manual detection settings**, below the contour list. Turning on experimental features adds point simplification and **Smooth outline**. **Editable curves** sits below the main outline actions.
See [the control guide](teed-outline-integration.md) for current interaction details.

The automatic detector still receives Claude's copy with inferred sheet ink
removed. It preserves the original input separately. In Trace, users adjust
the result with **Edit outline**. The experimental **Correct** brushes can supply tool and paper marks. Standard re-detection starts from the photo.
The diagnostic evaluator can still supply tool and paper marks to the
experimental solver with `--hints`. It uses the original pixels around each
mark and checks the result against the final contour before clearance.

Sheet-print removal knows both printed layouts. v2 and v3 sheets share markers
and dimensions but print different text in different places. After perspective
correction, `detectSheetLayout` reads the first whole-sheet frame and looks for
text in the stretches that only one layout prints; removal then uses that
layout's areas alone. When the photo does not settle it (a tool covers those
stretches, or the print is too faint), the areas of both layouts are used.
Removal can still erase a short dark object wholly inside a text area or an
object crossing a solid marker area. Use **Edit outline** to restore the
missing edge over the photo.

In the ruled area, removal follows the 100 mm bar and its ticks through a
shadow. A handle's shadow is as dark as a gray handle, so the bar inside it was
kept as a line beside a solid part and stayed attached to the outline. A handle
hides the bar and a shadow does not. On the rows where the bar was erased, a
kept stroke no taller than the bar is erased too, and so is a narrow upright
stroke that stands on the bar and ends inside the area. When the region's edge
cuts the bar off, ticks are taken from that edge instead. Nothing else beside a
dark part is touched. A part of a tool thinner than about 1.25 mm that crosses
the bar itself inside a shadow can still lose the bar's few rows.

A thin spur can still stay attached where the edge of a soft shadow runs into
the caption or the bar, for example a hook of about 12 mm under a handle tip.
The shadow's edge is not printing, so there is nothing there to remove, and a
thin part of the outline without color support is kept on purpose: it can be a
bright metal tip. Removing such spurs inside the printed areas would shorten a
thin bright tip that lies in a line of text, so the spur is left for the user to
edit away.

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

A mask that meets two opposite sides of the region is treated as clipped by the
region. That used to include a mask whose only contact was a thin line: a stroke
of printing left on the paper, a shadow line, or the corner of a tool drawn
close to the region's edge. The general recovery keeps only areas with color
support, so a bright metal part was removed or the outline was refused, and
color contrast, which cannot see bright metal on white paper, took over. A
2 px change of the region decided between a whole outline and fragments.

Now parts of the mask narrower than five model pixels count as lines. When
nothing wider meets two opposite sides, lines without color support that reach a
side are removed and the rest of the mask is kept (`thin-contact` in the
detection report). The general recovery still decides when a wide part spans the
region, when two such lines reach opposite sides at the same height or in the
same column (one printed line crossing the region, which can close paper in with
the tool), and when a line with color support still spans the region afterward.
A tool the region cuts on one side is accepted as cut once the line on the other
side is gone. Manual sensitivity does not run either recovery.

Color evidence is not given up for a release. A line with color support on 7 %
of its pixels is left alone, and the release of any other line stops at a
connected run of at least eight color-supported pixels, the measure the general
recovery uses for lost evidence. A shaft that is colored only near its handle
loses its colorless outer end, as it does in the general recovery, and keeps
the colored stretch.

One faint line that crosses two tools at a slope is released at both ends, but
its middle stretch reaches no side. A stretch that stays on the straight course
between two released contacts, and is all that joins two wide, color-supported
pieces, is removed as well, so the two tools are not traced as one outline. If
a tool's own thin bright neck happens to lie on such a course, the neck is
removed and the tool comes out in two pieces; nothing else is taken.

Two limits remain. A faint line that crosses a gap in a single tool at a slope,
such as a crease in the paper, keeps the paper it closes in: that paper cannot
be told from a bright metal part. And a line that joins two tools is recognized
only by its two released ends, so a bent line, or one that ends at the second
tool, still joins them.

One area-averaged retry still runs when automatic reconstruction leaves more
than 5% of the seeded material uncovered. It costs a second inference and is
kept only when it passes the existing acceptance checks.

## Geometry and source coordinates

Detection keeps two outlines. The **material reference** is the accepted
silhouette traced without smoothing. It is never shown; smoothing,
simplification, and final curve cleanup are all checked against it. The
**detected outline** is that silhouette after the bounded outward smoothing that
removes pixel stair-steps. Compare and restore show it, and manual detail
settings start from it, so neither brings the stair-steps back. In diagnostic runs with correction
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
except in diagnostic runs where a mark identifies a small tool part or hole.
These checks protect detected material; they cannot recover material
segmentation already missed. User clearance is applied afterward.

The default polish after cleanup (up to 0.2 mm) moves the boundary outward to
fill dips and allows a quarter of that inward, so it rounds a ripple without
shaving the tool. Its result is thinned again within the remaining allowance,
which keeps the point count close to the cleaned outline's instead of tripling
it. In diagnostic runs, the detector keeps the detected outline if polishing
would cross a correction mark.

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
