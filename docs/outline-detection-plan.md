# Outline detection: plan for the pathological cases

Status: **proposal; phase 0 (measurement) under way and phase 1 (smooth outer
boundary) implemented**, see [outline evaluation](outline-evaluation.md). Written 2026-11-10 against PR #226
(`codex/teed-outline-curves` at `956b62ef`). It covers the learned white-sheet
path only; the colour path and curve editing are out of scope.

> **Correction from phase 0.** The evidence below was measured on crops cut from
> the original photos, as the comparison report was. The app does not feed its
> detector those: after perspective correction the detector sees the rectified
> sheet at about 0.25 mm per pixel, with long regions shrunk to 1024 px. The
> causes described here are properties of the method and still apply, but the
> per-subject outcomes and the numbers must be re-measured on app-captured
> cases before they are relied on. Resolution (A2) also changes: for small
> tools the limit is the rectified photo, not the model frame.
>
> **First scores on app inputs** (draft references, see the evaluation notes),
> on the outline the app shows after its cleanup: 1 mm or more of the tool is
> left out in 9 of 36 cases, 12 have a loopback, 13 are stair-stepped, 15 have
> 1 mm or more of extra, and 14 have none of these. The median offset is
> 0.36 mm outside. The untuned region prototype brings six of the nine misses
> under 1 mm (five of those drafts were seeded from its own shape), but leaves
> out 1 mm or more in 21 cases and adds 1 mm or more in 25: notched edges,
> sheet printing, lost thin shafts. So the region stage is not an improvement
> by itself: the sheet model (A1) and thin-feature handling belong in the same
> phase, and it is gated on leaving out no more than today. An outward-only
> smoothing prototype removes the stair-steps on all 13 at a cost of 0.03 mm.
>
> **Priorities, set by the maintainer on 2026-11-10.** In order: no part of
> the tool left out, no loopbacks, a smooth edge. A small outward offset is
> acceptable; the outline does not need to sit exactly on the edge. The stages
> and gates below were reordered to match. An exact edge position is no longer
> a goal in itself.

## Summary

The remaining failures in the 36-subject report are not independent bugs. Most
follow from how the learned edge map is turned into a silhouette: cut it at one
global threshold, flood "paper" in from the crop border, and call everything
the flood cannot reach the tool, edge pixels included. That needs the edge map
to be watertight, counts the edge band as tool, and is held together by a
growing stack of guarded repairs.

The plan keeps the edge model and its single inference and changes six
things:

1. **A gap-tolerant exterior.** Paper is what a small ball can reach from the
   border through edge-free pixels, so a short gap no longer floods the tool.
2. **The edge band is trimmed back to its ridge**, so the outline sits on the
   edge, not outside it, and a stray edge is no longer a strip of "tool".
3. **The calibration sheet's known layout** is removed from the evidence.
4. **More model pixels for elongated tools**, which are currently seen 40–50
   pixels wide.
5. **Contour ground truth in millimetres**, so "improved / mixed / unchanged"
   stops being a visual judgement.
6. **A smooth outer boundary.** The trace is smoothed in a way that can only
   move it outward, so stair-steps go and nothing is cut off the tool.

An exact global solve (min-cut) was the original centrepiece of this plan. Two
scratch prototypes on the report's own crops, and an adversarial review,
changed that: the simple version of items 1 and 2 fixes the cut-ins and keeps
nearly all of what today's method keeps (it lost part of one thin shaft and
notches some edges), while the min-cut gives cleaner outlines but loses thin
shafts, a white cap and a real slot. The min-cut is therefore a later, optional
arbitration step, used only if ground truth shows what is left justifies it.

One rule runs through the design: **an outline that is too small is worse than
one that is too large.** A pocket cut inside the tool's edge does not fit; one
cut outside it only has slack. Where the evidence is ambiguous the result errs
outward and is marked for review. The same rule makes smoothness affordable:
a smooth outline a fraction of a millimetre outside the edge is better than a
jagged one on it.

## What fails today, and why

"Model pixel" means one pixel of the frame the edge model sees: the selected
region scaled so its long side is 512.

The learned path is: edge probability → threshold at 0.60 → 3×3 close → flood
"paper" inward from the crop border → everything not reached, *including the
edge pixels*, is candidate tool → keep components that have interior pixels,
enough size, and at least 7 % colour-seed support. At the default slider
position, automatic sensitivity then tries up to 14 global thresholds on the
same edge map, and clipped-boundary recovery, slit/rail cleanup and topology
vetoes repair specific outcomes (`edge-mask.ts`, `adaptive-edges.ts`,
`reconstruct-edges.ts`, `boundary-recovery.ts`, `edge-cleanup.ts`; 744 lines).

| Cause | What it produces | Subjects in the report |
| --- | --- | --- |
| **Closure is all-or-nothing.** A gap wider than one model pixel lets the flood into the tool, and it runs to the next interior edge (print, reflections). | Deep cut-ins; interiors treated as paper. | Silver tube (18), flux syringe (21), stapler metal (22), plunger (20), clear-hub needle (07) |
| **The edge band is counted as tool.** | (a) The outline sits outside the true edge. (b) Any edge touching the tool — shadow rim, sheet text, a speck — becomes a spur. (c) When an interior floods, what is left is the band, traced on both sides. | (a) all. (b) Gerber spur (15), nozzle tab (36), nameplate tabs (02), stapler lower edge (22), Wiha text (29–32). (c) plunger, tube swirls |
| **One global threshold, set high.** Blank paper reads about 0.44, so 0.60 leaves weak true edges below the cut. Lowering it is unaffordable while the band counts as tool, because every stray edge gets fatter. | Outcomes that flip with small input changes; the threshold search and its guards. | See "sensitivity" below |
| **Fixed 512 px long side.** The frame is padded, not filled. | A thin shaft is one or two model pixels wide, which is the same thing as an edge ribbon; long edges wobble. | Wiha 150 mm drivers (29–33), deburring tool (24), needles (07, 08), calipers (06), pens |
| **The sheet is known but unused.** The template's markers, labels, header and 100 mm bar are specified in `template.ts`, and calibration returns four-marker correspondences, but detection receives only "a sheet was recognised" and aid-strip outlines. | Printing enters as edges and as colour seeds. | DeWalt (05), stapler (22), Wiha 150 mm (29–32) |
| **Colour is asked the wrong question.** It is reliable for clearly non-paper material. It is not reliable for "this is tool" near shadows. | Shadows pulled in (the rejected colour-fusion experiment), or colour ignored and cut-ins stay. | Fusion regressions on 11, 15, 34, 35, 36 |
| **The silhouette is a yes-or-no mask traced on the model grid.** Its edge is a staircase with risers of one model pixel (0.25–0.5 mm in the app). The cleanup takes its allowance from the trace's own step, which is the same size, so it cannot flatten them. | Stair-stepped edges, worst on straight edges lying at an angle and on small, blurred tools. | 13 of 36 in the app: needles (07, 08), DeWalt (05), pen (01), tube (18), nameplate (02), syringe (21), tape measure (04), calipers (06), plunger (20), Wiha 150 mm (29, 31, 32) |
| **No contour ground truth.** | Boundary error, bias and regressions cannot be measured. | All |

### Evidence

Measured by running the PR's own detection modules in Node on the 36 crops
embedded in the comparison report (see "Reproducing").

- **Edge band as tool.** At threshold 0.60 the band is 16–39 % of the
  silhouette's area on ordinary subjects, and 60 % (tube, syringe), 68 %
  (stapler) and 91 % (clear-hub needle) where interiors leak.
- **Outward offset.** The final outline lies a median **1.75 model pixels
  outside the ridge of the edge response** (33 crops; the response peaks two
  pixels inside the outline in 30 of them). In source terms that is
  1.75 × (region long side ÷ 512): about 0.7 mm per side on a 200 mm region
  and 0.35 mm on a 100 mm one. It grows with region size, so it is not a
  constant clearance. This measures position against the model's own ridge,
  not against the physical edge; whether the ridge is the true edge is one of
  the things phase 0 has to establish.
- **Model frame use.** The five 150 mm drivers are 40–50 model pixels wide;
  the deburring tool is 71; a pen is 131. A 46×512 region uses 9 % of the
  512×512 frame.
- **Sensitivity.** Re-running from the report's downsampled crops changed the
  outcome class of 3 of 36 subjects (07, 29 and 32 fell back to colour), and
  the plunger body was kept with 9 % seed support against the 7 % gate.
- **Timing on this Mac (Node 26, WASM):** inference 620–720 ms per crop; the
  whole learned path 660–1130 ms.

## What the prototypes showed

Two scratch variants replaced everything between the edge map and the tracer.
Neither includes the sheet model, the resolution change, or sub-pixel
placement. One parameter set each, run on all 36 crops; the judgements are
mine, by eye, on those crops.

- **Closure variant.** Rescale the edge response so blank paper is 0. Paper is
  what a radius-3 ball reaches from the border through pixels with almost no
  response, regardless of colour. Climb the band from outside until the
  response stops rising and give that flank back to paper. Drop strips with no
  solid body unless strong colour supports them. Keep components with a strong
  colour anchor; fill holes.
- **Min-cut variant.** Same exterior and anchors, then one exact labelling in
  which bridging a gap costs its length, edge pixels have no pull either way,
  and enclosed pixels carry a small preference for "tool".

| Subject | Current default | Closure variant | Min-cut variant |
| --- | --- | --- | --- |
| Silver tube (18) | cut-ins, ragged cap | whole tube with cap | clean body, cap cut off |
| Flux syringe (21) | label cut-ins | whole barrel and tabs | whole barrel and tabs |
| Plunger (20) | whole on this crop | whole with flange | body only, flange cut off |
| Stapler slot (22) | carved | carved, small tab | **filled** |
| Gerber (15) | lower spur | shadow strips attached | clean |
| Nameplate (02), long nozzle (36) | tabs | smaller tabs | clean |
| Wiha PH0 shaft (27) | kept | kept | **lost** |
| Wiha 150 mm (29–33) | kept, text attached | kept, text attached | 33 lost |
| Deburring tool (24) | kept | upper shaft lost, tabs | shaft lost |
| Calipers (06), cone nozzle (35) | whole, loose | whole | whole, tight |
| Offset from edge ridge, median | 1.75 px | 0.59 px | 0.36 px |
| Deepest step inside current outline, median / worst | — | 4 / 7 px | 5 / 15 px |
| Time for this stage | — | 8–108 ms | 26–985 ms, median 167 |

Reading:

- The **cut-in class is fixed by the gap-tolerant exterior alone.** It works
  because trimming the band makes a low edge level affordable.
- The min-cut prefers short boundaries. A shaft one or two pixels wide, a white
  cap and a transparent flange have nothing to pay for their outline, and a
  slot is cheaper to close than to follow. Today's method keeps shafts only
  because it counts edge pixels as tool, which is also where the spurs come
  from.
- Its errors point the wrong way. The min-cut outline lies entirely inside the
  current one on 21 of 33 comparable crops (closure: 4), and its tie-breaking
  puts the ridge pixel on the paper side.
- The closure variant is not free of inward error either. Measured against
  the current outline, its deepest inward step is 4 model pixels at the
  median, about 2 of which is the trimmed band, and up to 7 on the tube and
  the Ryobi cutter, where it notches the edge. Phase 2 gates on this.
- The min-cut's real advantage is choosing between competing edges: an
  attached shadow strip, a speck, a spur. That is arbitration near the
  boundary, not the whole solve.
- Sheet printing and model resolution hurt all three.

Two things failed along the way and should not be retried without new
evidence: letting colour vote "tool" softly (it pulled in the cone nozzle's
shadow and dropped the calipers' beam, the same failure as colour fusion), and
trusting a colour anchor that the exterior test had reached (a contact shadow).

Limits: downsampled report crops, not source regions; no ground truth; one
reviewer's eye; parameters chosen on the same 36 subjects; and the offset
figures score each variant against the edge field it was built from, so they
show where an outline sits, not that it is dimensionally right.

## Proposed architecture

Keep: the TEED model and its single inference, the OpenCV worker, the tracer,
line/curve reconstruction, the colour path as fallback and for non-paper
backgrounds. The learned path already exists only with OpenCV, so the
two-backend equivalence rule is unaffected; the new stages are plain
TypeScript with injected inputs, and any new Mats are tracked and disposed.

### A. Frame the problem

> **A1, first form, implemented 2026-11-10.** The sheet's printed areas are
> known from the template (`templateInkRegionsMm`) and, while the photo is the
> rectified sheet with the page upright, printing inside them is painted out
> before detection (`sheet-ink.ts`): anything no taller than its printed area
> and not connected to something outside it. This is an eraser, not the
> "unknown evidence" form described below, and it leaves letters that touch a
> thin tool part attached. Results are in the evaluation notes. The form below
> remains the target for the region stage. Also implemented alongside it: on a
> recognised sheet, anything at most half as light as the paper counts as tool,
> which is the narrow fix for "colour is asked the wrong question" on two-tone
> tools.

**A1 — Known sheet.** Carry the template variant and marker correspondences
from calibration into detection as a new option (not `occlusions`, which
triggers aid-strip repair and its notice). Compute template-mm → frame
pixels, and project conservative ink boxes for markers, id labels, header
lines, and the bar with its caption, per template variant. Inside the mask the
edge response is zeroed and colour is unknown. A boundary that has to cross
ink is estimated and shown amber, as aid strips are. Because ink scales with
the markers, a sheet printed at the wrong scale still maps correctly. Needs all
four markers; otherwise skipped.

**A2 — Resolution.** Two limits apply in the app. A small tool is limited by
the rectified photo (about 4 px/mm), so its region should be re-rectified from
the original photo at higher resolution. A long tool is limited by the 1024 px
region cap and the 512 px model frame, which is what the rest of this item
addresses. Give the tool more of the frame. First rotate the region
to the tool's long axis, from a coarse first pass; a driver lying diagonally
has a square bounding box and gains nothing otherwise. The reference
implementation is then a second inference on the rotated, tiled region. Packing
overlapping strips side by side into one 512×512 frame is the single-inference
optimisation, accepted only if its responses near strip seams match that
reference. Because a different scale changes what the model responds to, every
parameter in B is stated in millimetres when a scale is known and re-checked
at the new scale. Which form ships depends on the phone budget.

### B. Region

1. Rescale the edge response so blank paper is 0.
2. **Exterior marker:** ball-reachable from the crop border through edge-free
   pixels, ignoring colour, so smooth shadows are exterior.
3. **Interior markers:** enclosed, edge-free cores, plus strong colour that the
   exterior did not reach.
4. **Assign the band by watershed** on the edge response between those
   markers. Boundaries then fall on ridges; a stray edge with exterior on both
   sides is absorbed, with no separate spur rule. The prototype approximated
   this by climbing the band from outside; the watershed itself is not yet
   prototyped.
5. **Thin features** survive when they carry an interior marker: a core at
   sufficient resolution (A2), strong colour, or a user hint. There is no
   parallel-ridge "bar" detector; a pair of parallel edges is also a slot, a
   jaw gap, or a tool beside its shadow.
6. **Enclosed regions without an anchor** (a white cap, a clear body, but also
   an attached shadow strip) are kept and marked for review, following the
   outward rule. With no anchor anywhere, the largest enclosed region is used
   and flagged. Holes are filled in outside-only mode. A result that is empty
   or spans the crop falls back to colour, as now.

### C. Arbitration (only if ground truth justifies it)

A min-cut restricted to a narrow band around B's boundary, with B's interior
and exterior as hard constraints. It can then only choose between nearby
edges, so it cannot cut off a shaft, cap or flange, or close a slot. This is
also where hint points (user-marked tool or paper) become hard constraints.
Original TypeScript from a published algorithm, no dependency, no reference
implementation consulted; provenance recorded in the PR.

### D. Smooth outer boundary

Runs on the dense trace, before simplification and line/curve cleanup, in
millimetres when a scale is known.

1. Blur the ring along its own length (about 1 mm). This is the smooth base.
2. Measure how far the traced ring lies outside the base at every point, take
   the running maximum of that over about ±1 mm, and average it over the same
   window. Offsetting the base by this amount gives a smooth ring that the
   trace nowhere lies outside of.
3. Holes are treated the other way round, so the tool region only ever grows.

4. Growth must not close a gap. Where two stretches of boundary would end up
   closer than they were and closer than half a length (a slit's mouth, two
   tips that nearly meet), the trace is kept there and faded back into the
   smooth ring over three lengths. Without this the cleanup rejected one
   outline whose gap had been squeezed shut.
5. The ring is returned evenly sampled at a quarter of the length, which keeps
   the cleanup's allowance and the trace's size about where they are today.
   A ring that would still cross itself, or a hole that would not lie inside
   the hole it came from, is retried at a shorter length and then left alone.

**As built** (`client/src/lib/geometry/outer-smoothing.ts`, called from
`detectOutline` when `outerSmoothingPx` is set, which the Trace page does
through `processImage`): the length is one millimetre when a scale is known
and four segmentation pixels otherwise, and it is fixed at detection. On the
36 app cases the stair-stepped count went from 13 to 0, loopbacks from 12 to
7, and the cleanup that failed on two outlines now succeeds on all; the edge
moved outward by 0.08 mm on the median tool, 0.18 mm on the worst and 0.67 mm
at the worst single spot. See the evaluation notes.

What it does not do. It rounds but does not remove the slower jogs: the 1 mm
ones where the outline switches between the tool's edge and its shadow's (B's
job), and the half-millimetre ones every 20–25 mm on a long straight edge a
few degrees off the pixel grid, which come from the model pixel (A2's job, or
a one-sided line fit). Containment is close, not exact: the trace lies
outside the smoothed ring by 0.02 mm at the median and 0.11 mm at worst, and
the cleanup that follows may place the final outline up to its allowance
inside (0.20 mm at worst on the 36). A feature thinner than the trace can
resolve (a hairline spur under about 0.2 mm) may lose its tip.
The existing Smoothing control keeps its meaning and applies afterwards.

**Sub-pixel placement** (a search along the boundary normal in the
working-resolution image, moving a sample only where the profile has one peak
of the expected polarity that agrees with the learned ridge) was this stage
in the first draft. With a small outward offset accepted it is no longer
needed for its own sake. It is kept as an option for after B, and only if the
known-size references show the outline inside the tool anywhere.

### E. Say what was estimated

Each boundary run carries its edge support. Bridged gaps and ink crossings are
marked for review like aid-strip edges.

### What is removed at the end

`adaptive-edges.ts`, `reconstruct-edges.ts`, `boundary-recovery.ts`, the flood
in `edge-mask.ts` (its component and score helpers stay), the slit/rail repair
in `edge-cleanup.ts`, and the fragmentation veto in `pipeline.ts` if ground
truth no longer needs it. Also affected: `EdgeSensitivityReport` and the
`RefinementReport` fields in `types.ts` and `pipeline.ts`; the "selection too
tight" notice in `image-processor.ts`; `teed.test.ts` and
`teed-occlusions.test.ts`; the sensitivity evaluators and report renderers
under `scripts/`; `teed-outline-integration.md`,
`photo-refinement-evaluation.md` and the public report.

## Phases and gates

Each phase is its own PR with committed synthetic tests for its new code.
Ground truth uses local photos, so it is a reported evaluation, not part of
`npm test`. All distances are in the sheet plane. They measure detection, not
physical fit: a tall tool away from the optical axis is displaced by
perspective by more than any tolerance here, which detection cannot correct.

**0 — Measurement.** No behaviour change.
- **Known-size references:** a few flat parts of measured width (gauge pins,
  drill blanks, ground stock) photographed on the sheet at several positions.
  These answer whether the edge ridge is the physical edge, and give the
  offset in real millimetres.
- **Contour ground truth** for the 36 subjects plus at least 24 new held-out
  photos, at least three per hard class (transparent, foil, white on white,
  thin shafts, deep shadow, tool over sheet printing, tool lying diagonally).
  Traced from the photo at source resolution, not by correcting a detector's
  outline, which would carry its offset into the truth.
- A Node evaluator that runs the real pipeline and the app's cleanup and
  reports, on the outline a user gets: **tool left out** (missing parts and
  cut-ins), **loopbacks**, **stair-steps per 100 mm**, extra, signed mean
  offset, boundary F-score at 0.25 and 0.5 mm, component count, time and peak
  memory.
- Phone time and memory for the current default on one low-end device.
- **Freeze** the held-out set and every gate threshold below after the
  baseline is measured and before any new-path result is looked at.
- *Gate:* the metrics flag every subject the report calls poor or mixed and
  none it calls clean.

Every phase from 1 on is held to the same three rules, in this order, on the
outline after cleanup:

- **Left out:** no subject worse than before the phase by more than 0.1 mm,
  and the count at 1 mm or more does not rise.
- **Loopbacks:** no subject gains one.
- **Stair-steps:** no subject rises above 2 per 100 mm.

Offset is reported, not gated, as long as the median stays between 0 and
+0.5 mm outside.

**1 — Smooth outer boundary (D).** Small, independent of the rest, and it
changes every outline slightly, so it comes first and the later phases are
judged on smooth outlines.
- *Gate:* no subject at 2 or more stair-steps per 100 mm (13 today); median
  outward move at most 0.05 mm and no spot moved by more than 0.75 mm; no
  inward move above 0.1 mm; real slots and recesses kept (22, 15, 06, 25);
  synthetic tests for a staircase, a slot, a thin shaft and a hole.
- *Result (2026-11-10, in the worktree, not merged):* stair-steps 13 → 0, no
  tool gained a loopback, synthetic tests in place. Three limits as written
  were not met, and are reported, not adjusted. The median outward move is
  0.08 mm, not 0.05. The final outline is up to 0.20 mm inside the detector's
  trace, because the cleanup's allowance is 0.25 mm; today it is up to
  0.43 mm inside. One tool (Wiha 150 mm 3 of 5) is left out 0.13 mm more at
  its tip. The step has not been run in a browser or on a phone.

**2 — Region (B) with the known sheet (A1), behind a setting.** The current
path stays default. The watershed is compared with the prototype's
approximation and with the current path. This is the phase that addresses the
first two priorities.
- *Gate:* the nine left-out cases fixed or reduced on ground truth, with the
  cut-in class (18, 21, 20, 07) under 1 mm; loopbacks from sheet printing and
  shadow gone (29, 32, 15, 19, 24); slots and recesses kept (22, 15, 06);
  thin features no worse than current.

**3 — Resolution (A2).**
- *Gate:* shafts, needle and deburring tip better than phase 2 on ground
  truth, including diagonal tools; a synthetic unseeded-shaft test on the new
  path passes (the existing expected failure exercises code that is later
  removed); either strip packing passes its seam check, or a second inference
  is explicitly approved against the measured phone budget.

**4 — Review marks (E), then decide on arbitration (C), hints and sub-pixel
placement.** Build arbitration only if phase 3's ground truth still shows
attached shadow strips, spurs or tabs above tolerance, and placement only if
the known-size references show the outline inside the tool.
- *Gate:* those classes fixed with no loss on any other class.

**5 — Switch and remove.** Make the new path the default, remove the old one,
regenerate the public report with metrics, update the docs. User-visible, so
a minor version bump that needs maintainer confirmation.

## Budgets

No added inference unless A2's fallback is approved. All new work is on a grid
of at most 512×512 (262,144 pixels).

| Stage | Desktop | Low-end phone | Peak extra memory |
| --- | --- | --- | --- |
| Region (B) | ≤ 40 ms | ≤ 160 ms | ≤ 6 MB: one Float32 field, a few 8-bit masks, two distance maps |
| Arbitration (C), if built | ≤ 60 ms in a band | ≤ 250 ms | ≤ 20 MB with 32-bit typed arrays on an implicit grid; hard iteration cap, falling back to B's boundary |
| Smooth boundary (D) | ≤ 10 ms; measured 2.4 ms median, 14 ms worst (cold) | ≤ 40 ms; unmeasured | ≤ 2 MB: a few float arrays over at most 24,000 boundary samples |
| Sub-pixel placement, if built | ≤ 30 ms | ≤ 120 ms | ≤ 2 MB |

The closure prototype ran in 8–108 ms unoptimised, so B's budget is realistic.
Inference stays the dominant cost and its phone time is **unmeasured**; phase 0
measures it before any claim is made.

## Risks and open questions

1. **Attached shadow strips.** The closure variant keeps a strip that has its
   own edge (Gerber), and the same cues cannot tell it from a white cap. It is
   kept and flagged by the outward rule; phase 4 exists to do better.
2. **Recess versus transparent part.** A paper-coloured area mostly enclosed by
   edges is either a slot or a clear part with a broken outline. The ball
   radius sets the line between them. Ground truth has to contain both.
3. **Thin feature versus spur.** At one or two model pixels they are the same
   object. Resolution, the sheet model and hints separate them; nothing at the
   current scale does.
4. **Missing evidence.** Where the edge model returns nothing along a stretch,
   nothing here recovers it. The answer is a review mark and a hint.
5. **Resolution cost.** Strip packing may not survive the seam check, and a
   second inference doubles the dominant cost on a phone.
6. **Tool height.** Perspective displaces the outline of a tall tool by
   millimetres. Out of scope here, but it bounds what any outline accuracy
   means for fit.
7. **Sensitivity slider.** It currently moves the edge threshold, which goes
   away. Proposed: it moves the "edge-free" level. Saved choices need a
   mapping.
8. **Caching.** The worker caches one edge map keyed on the packed frame. A2
   changes the key, and hints need the edge map and evidence kept between
   solves.
9. **Several tools in one region.** Keep today's rule until ground truth says
   otherwise.
10. **Tuning on the development set.** Parameters are chosen on the 36; the
    frozen held-out photos exist to catch that.
11. **Smoothing fills narrow real features.** A slot or notch narrower than
    the smoothing window gets shallower, and a sharp outside corner gains up
    to about half a millimetre. Both err outward. The window is a length in
    millimetres and may need to shrink for small tools.
12. **The stair-step measure counts real fine detail.** A narrow shoulder or
    a tab swings both ways like a step. Gates compare a subject with itself,
    and the synthetic tests carry the absolute claims.

## Alternatives considered

- **More guards on the current flood.** The causes are structural, and each
  guard adds thresholds and vetoes that interact.
- **A full-frame min-cut as the main solve.** Prototyped; see above.
- **Fusing colour into the edge map.** Rejected in the PR; reproduced here.
- **Watershed or geodesic distance from colour seeds alone.** A leak then costs
  path length, not gap width, so a small gap far from a seed still floods. The
  watershed in B avoids this because its exterior marker is already
  gap-tolerant.
- **A segmentation model.** Closed regions by construction, but a larger
  download, licence and provenance review, and unknown phone cost. Worth
  revisiting if ground truth shows an evidence ceiling after phase 3.

## Reproducing the evidence

Nothing here is committed. The scripts and images are in the ignored folder
`exports/outline-pathology-spike-2026-11-10/` of this worktree:

- `scripts/extract_crops.py` pulls the 36 crops from the comparison report.
- `scripts/dump.ts` (bundled with esbuild) runs the PR's `detectOutline`,
  `buildScoreFieldOpenCV` and `maskFromEdges` against the bundled `opencv.js`
  and model, and writes each stage.
- `scripts/diagnose.cjs`, `bias.cjs`, `inward.cjs`, `hist.cjs` produce the
  stage panels and the numbers above. `simple.cjs` is the closure variant;
  `proto.cjs` with
  `maxflow.cjs` is the min-cut (`V=4 STRONG_T=1.6 EPS=0.005 U_NARROW=0`).
- `current-stages/NN.png`: photo, colour seeds, edge response, flood, final.
- `three-way-*.png`: current (magenta), closure (orange), min-cut (green).
  `simple-variant/` and `prototype-v4/` hold the per-subject images.
