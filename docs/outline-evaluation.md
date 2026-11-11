# Outline evaluation

The measurements below are historical. The [combined detector comparison](outline-combined-validation-2026-11-11.md)
reruns these 36 cases against Claude's `5aefd804` baseline. Current replay checks
use exact captured raster transforms and complete boundary checks; legacy cases
without those transforms cannot qualify exact app replay.

How photo-outline detection is measured. This is phase 0 of the
[outline detection plan](outline-detection-plan.md): measurement only, no change
to detection. Status on 2026-11-10: cases, evaluator, metrics and **draft**
reference outlines exist. The drafts are unreviewed; known-size references,
held-out photos and phone numbers do not exist yet. Phase 1 of the plan, the
outward smoothing step, is implemented and measured below.

## What a good outline is

In the maintainer's order of importance:

1. **No part of the tool left out.** A pocket cut from the outline must admit
   the tool.
2. **No loopbacks.** The outline must not run out along a spur, or in along a
   slit, and come back.
3. **A smooth edge.** No stair-steps or jagged stretches.

A small outward offset is acceptable. The outline does not have to sit exactly
on the edge.

## Cases come from the app

A case is whatever Pocketry handed its detection worker after a user's flow:
load the photo, accept **Correct perspective & use scale**, draw a region
closely around one tool. Development-only hooks record those exact pixels and
options together with the app's own result, the region and the calibration
([helpers](../scripts/outline-eval/README.md)). The evaluator then replays the
case through `detectOutline` in Node.

Earlier evaluations cropped the original photos with a script. That is not what
the detector sees in the app, and the difference is large:

- After perspective correction the working photo is the rectified sheet at
  about **0.25 mm per pixel** (0.23 to 0.29 across these captures), whatever
  the camera resolution. Every captured crop had exactly its region's pixel
  size in that photo; none was sampled finer.
- A region longer than 1024 px is shrunk to 1024, and the edge model then sees
  it at 512.

So a 150 mm driver reaches the edge model about 37 pixels wide, and a small
tool such as the silver tube is enlarged from 384 px, which adds no detail.

The 36 subjects of the comparison report were captured this way on 2026-11-10
from the maintainer's photo library. Photos and cases are local and are not
committed.

Region rules, checked on the saved crop of every case and not on the screen:

- **One tool per region.** On a photo with several tools, each gets its own
  region, with the edges set midway between neighbours.
- **The whole tool is inside.** Where a tool runs to the sheet edge, drag past
  the edge; the region stops at the sheet.
- Sheet markers are kept out where a rectangle allows it. For a tool lying
  diagonally it sometimes does not.

## What is scored

The outline a user gets: detection, then the automatic line and curve cleanup
the Trace page applies (`processImage` with `autoCleanup`). The evaluator runs
that cleanup itself and reports the dense trace beside it.

The first pass of this evaluation scored and drew the dense trace only. That
trace is a staircase on the model's pixel grid (a median of 30 stair-steps per
100 mm of edge on these cases) and is not what the app shows.

## Replay check

For every case the evaluator compares its own result with the app's, from the
same pixels: the detected outline and the outline after cleanup. **All 36 match
on both** (same status, boundaries within 0.05 px), so results from the
evaluator are results of the app.

## Metrics

Computed by `shared/geometry/contour-metrics.ts` in millimetres in the sheet
plane, in the order above:

| Metric | Meaning |
| --- | --- |
| Left out | The larger of **missing** (how far the tool sticks out of the outline) and **cut-in** (how deep the outline runs inside the tool). Missing alone does not see a narrow cut: on the flux syringe it reads 2.0 mm where the outline is 7.8 mm inside the label. This is the one that must not get worse. |
| Loopbacks | Stretches that leave the reference edge by 1 mm or more and are deeper than their mouth is wide: slits (inside) and spurs (outside), counted separately. |
| Stair-steps | Swings of 0.1 mm or more from one side of the outline to the other within 2 mm, per 100 mm of edge, and the share of the edge they cover. Measured against a copy of the outline smoothed over 0.5 mm, so it needs no reference. A corner is not a step; a narrow shoulder or tab is, so compare a tool with itself. |
| Extra | How far the outline reaches beyond the reference: an attached shadow, label or wire. |
| Offset | Mean signed distance from the reference; positive is outside. |
| F@0.25, F@0.5, P95 | Boundary agreement within 0.25 mm and 0.5 mm, and the 95th-percentile distance. |
| Shells | Outline pieces compared with the reference. |

These measure detection in the image, not physical fit. A tall tool away from
the optical axis is displaced by perspective by more than these tolerances.

## Draft reference outlines

All 36 subjects have a reference outline with status **draft**. They were not
traced by a person. Each was built as follows:

1. Three candidate shapes were generated on the captured crop: the current
   default, the colour detector, and the plan's gap-tolerant prototype.
2. One candidate was chosen by eye as the shape. 31 use the current default; 5
   use the prototype, where the default's shape was grossly wrong (DeWalt,
   clear-hub needle, silver tube, flux syringe, mould-line remover).
3. Obvious errors were corrected by hand in 11 cases: sheet printing and a
   marker label detached, a shadow spur and a photography support wire
   removed, a neck bridged, one end taken from a different candidate, and the
   five long driver shafts redrawn as straight strips.
4. The shape was then moved onto the strongest edge of the photo itself within
   a few pixels, so its position does not come from any detector.
5. That leaves the shape on the pixel grid, so it was then smoothed along its
   length over 2 px (0.5 mm). This moved the drafts by under 0.1 mm almost
   everywhere and by 0.26 mm at most.

What the drafts are good for: gross errors, meaning parts left out, loopbacks,
parts added, and outlines in pieces. What they are not good for:

- **Small offsets.** They are at the crop's 0.25 mm per pixel, and step 4 is a
  choice about where an edge is.
- **Comparing methods fairly.** A draft that started from one method's shape
  favours that method wherever its errors went unnoticed.
- **A standard of smoothness.** Three drafts are still rough because their
  shape is (DeWalt, silver tube, flux syringe).
- **Anything nobody looked at filled in.** The plunger's draft was a hollow
  band, copied from the default's outline, and scored that tool at 2.0 mm left
  out until the outlines were drawn filled. It is corrected; the other 35 are
  solid.
- Edges hidden under a reference strip (tape measure, Flipper Zero) and driver
  tips lying over printed text are estimates.

## Baseline: PR #226 default on the 36 captured subjects

Node 22.23.4, Apple silicon, CPU/WASM.

- **33 learned outlines accepted, 3 fell back to colour**: DeWalt screwdriver
  and Wiha 150 mm driver 2 of 5 ("selection too tight"), clear-hub needle
  ("fragmented outline").
- **2 results in more than one piece**: DeWalt (3) and clear-hub needle (2).
- **Cleanup could not be applied to 2** (DeWalt, Wiha 2 of 5), which keep the
  detected polygon.
- Detection time: median about 810 ms, worst about 1300 ms. Peak WASM heap
  184 MB.

The outline after cleanup, against the draft references:

- **Left out by 1 mm or more in 9 cases**: DeWalt 38.6 mm (only the yellow
  parts are found), silver tube 9.8 mm (the cap), flux syringe 7.8 mm (a cut-in
  at the label), plunger 4.8 mm (the outline is a hollow band around the clear
  body), clear-hub needle 3.0 mm, Wiha 150 mm 1 of 5 2.7 mm and 4 of 5 2.2 mm
  (tips), mould-line remover 1.5 mm, stapler 1.1 mm.
- **Loopbacks in 12 cases**: 7 have a slit into the tool, 6 have a spur. Wiha
  150 mm 1 of 5 has one slit and four spurs.
- **Stair-stepped in 13 cases** (2 or more steps per 100 mm): the two needles
  (13.0 and 11.7), DeWalt (10.5), black pen (5.0), silver tube, nameplate,
  flux syringe, tape measure, calipers, plunger and three long drivers. The
  median is 0.9.
- **Extra of 1 mm or more in 15 cases**, the largest being things that are not
  the tool: the deburring tool's support wire (9.5 mm), the "id 14" label on
  the Ryobi (6.1 mm), sheet printing on three long drivers (3.6–5.2 mm) and
  the Gerber's shadow spur (3.7 mm).
- **14 cases have none of the four.**
- Offset: a median 0.36 mm outside the reference; 27 of 36 are more than
  0.1 mm outside. Accepted, given the priorities above.

### Where the stair-steps come from

The silhouette is a yes-or-no mask on the model's 512-pixel grid, so the trace
is a staircase with risers of one model pixel: 0.25 to 0.5 mm here. The cleanup
takes its allowance from the trace's own sampling step, which is about that
same size, so it cannot flatten the risers. On a straight edge lying at an
angle (the calipers' beam) they survive.

A second, larger kind of step, about 1 mm, appears where the outline switches
between the tool's edge and the edge of its shadow (the black pen). That comes
from counting the whole edge band as tool.

### Outward smoothing (plan phase 1, implemented)

`client/src/lib/geometry/outer-smoothing.ts`, run by `detectOutline` on the
dense trace before simplification and cleanup, and turned on by the Trace
page. Measured by replaying the 36 cases with `--outer-smoothing on`, which
passes the same length the Trace page does (1 mm):

| On the outline after cleanup | Today | With smoothing |
| --- | --- | --- |
| Stair-stepped (2 or more steps per 100 mm) | 13 | 0 |
| With a loopback | 12 | 7 |
| Left out by 1 mm or more | 9 | 9 |
| Extra of 1 mm or more | 15 | 18 |
| None of the four | 14 | 15 |
| Cleanup could not be applied | 2 | 0 |
| Median offset | +0.36 mm | +0.42 mm |
| Deepest point inside the detector's own trace | 0.43 mm | 0.20 mm |

- The outline moves outward by 0.08 mm on the median tool and 0.18 mm on the
  worst, and by at most 0.67 mm at any one spot (beside sharp corners and thin
  tips). That is why three tools just under 1 mm of extra are now over it.
- No tool gains a loopback. One tool is left out by more than 0.1 mm more than
  before: Wiha 150 mm 3 of 5, 0.54 → 0.68 mm at its tip. The new outline is
  within 0.15 mm of the detector's trace everywhere on that tool; today's
  outline sits further outside the trace at that spot.
- Time: 2.4 ms at the median and 14 ms at worst on this desktop (cold). The
  dense trace has about as many points as before (median 1,221 → 1,392), so
  cleanup costs and saved drafts are about the same size.
- **Not fixed:** slower jogs. About 1 mm where the outline switches between a
  tool's edge and its shadow's, and about 0.5 mm every 20–25 mm along a long
  straight edge a few degrees off the pixel grid (the 150 mm drivers) are
  rounded, not removed, and the stair-step measure does not see them. At a
  2.5 mm scale (swings of 0.16 mm or more within 10 mm) the median is 2.8 per
  100 mm before and 2.7 after.
- **Not checked:** the step in a browser, and phone time.

### Dark parts on paper, and the sheet's own printing (implemented)

Two more changes, measured the same way (`--outer-smoothing on --sheet-ink on`;
the paper rule is on whenever the learned boundary is requested):

- **Darkness judged against the paper** (`PAPER_DARK_FRACTION` in
  `client/src/lib/detect/background.ts`). The colour evidence half-weights
  lightness to ignore shadows and splits its score in two. On the DeWalt the
  black and grey parts score about 25, the yellow 55–75 and the split lands at
  36, so only the yellow counted as tool, and the learned outline was then cut
  down to match. On a recognised sheet anything at most half as light as the
  paper now counts as tool. It changed 4 of the 36 outlines.
- **The sheet's printing painted out before detection**
  (`client/src/lib/detect/sheet-ink.ts`, areas from `templateInkRegionsMm`).
  Inside the known printed areas a dark structure no taller than the area is
  printing. A structure that runs through an area or out of it is kept whole.
  Ten of the 36 crops contain printing.

| On the outline after cleanup | Today | Smoothing only | All three |
| --- | --- | --- | --- |
| Left out by 1 mm or more | 9 | 9 | 7 |
| With a loopback | 12 | 7 | 5 |
| Stair-stepped | 13 | 0 | 0 |
| Extra of 1 mm or more | 15 | 18 | 18 |
| None of the four | 14 | 15 | 15 |
| Learned outline accepted | 33 | 33 | 34 |
| Median offset | +0.36 mm | +0.42 mm | +0.46 mm |

Tool by tool, against smoothing only:

- DeWalt: left out 38.4 → 1.6 mm; the 16 mm bar spur that appeared once the
  whole tool was found is gone (extra 2.3 mm).
- Ryobi cutter: attached marker label 6.2 → 1.5 mm.
- Stapler: left out 1.0 → 0 mm; extra 1.1 → 3.1 mm.
- Wiha 150 mm 4 of 5: left out 2.1 → 0 mm (the half-shaft and pinch are
  gone), extra 3.8 → 2.3 mm. 5 of 5: extra 4.0 → 1.5 mm.
- Wiha 150 mm 3 of 5: left out 0.7 → 0 mm, but the tip now carries 6 mm of
  title text. 1 of 5: attached text 5.2 → 0.6 mm, but the learned outline is
  now rejected as fragments and the tip is 3.0 mm short (2.4 before).

Limits found:

- **Letters that touch a thin part of a tool stay attached**, because a low
  structure connected to something outside the printed area is kept whole.
  Removing them needs the letters' exact shapes, which means rendering or
  shipping the font.
- **The outlines of the long tools are about 0.9 mm outside the edge.** Before,
  printing made four of them fail a "selection too tight" check, and the
  recovery that followed happened to strip the edge band. Without the printing
  they take the normal path, with its normal offset at 1024 px.
- A dark tool part lying wholly inside a printed area, top to bottom and side
  to side, is erased.
- Time: the paint-out takes 3 ms typically and 18 ms at worst on this desktop.

### Prototype: gap-tolerant region

The plan's region prototype, untuned and without the sheet model or the
resolution change, after the same cleanup and on the same drafts: left out by
1 mm or more in 21 cases (12 of them by under 2 mm), extra in 25, loopbacks in
16. It brings six of the default's nine misses under 1 mm (DeWalt, silver
tube, flux syringe, clear-hub needle, mould-line remover, stapler); the drafts
for the first five were seeded from its own shape, so that part is not an
independent result. It attaches more sheet printing (24 mm of the verification
bar on the stapler) and loses thin shafts (41 mm on one driver). Read with the
fairness caveat above, this still says the region stage alone is not an
improvement on app inputs. Its stair-steps are not comparable: its trace was
made on the pixel grid.

## Still needed

1. **Review of the draft reference outlines**, starting with the 16 that were
   seeded from the prototype, corrected by hand, or partly hidden.
2. **Held-out photos**, at least 24, at least three each of: transparent, foil
   or mirror finish, white on white, thin shafts, deep shadow, tool lying on
   sheet printing, tool lying diagonally. One tool per photo, all four markers
   visible, shot from above. They are frozen before any new detector is run on
   them.
3. **Known-size references.** A few flat parts of measured width (gauge pins,
   drill blanks, ground stock; 3 mm to 25 mm) on the sheet, in the centre and
   near two edges. With a small outward offset accepted, their job is to
   confirm the outline is never inside the tool.
4. **Phone time and memory** for the current default on one low-end device.
