# Outward straightening: validation, 2026-11-14

A dated record. [The combined detector notes](outline-combined-detector.md)
describe the current behavior.

## What changed

The default cleanup now bridges small dips with a straight line before its final
smoothing: dips up to 0.5 mm deep and 10 mm wide, never removing material. The
request came from a review of the tape measure's outline, whose rubber grip has
ribs about 0.3 mm deep every 5.7 mm. A pocket has no use for them; the wanted
outline follows the outer edge.

## Method

Seven tools, chosen as the tape measure, the tools the step changes most, and
controls with real recesses that must survive (calipers, tweezers). Each run
started from the original, unmodified photo on its calibration sheet and went
through the app at 1440 x 900 with real pointer input:

1. **Start Over**, **Clear trace and start over**.
2. Choose the original photo.
3. Press the correction the app offered.
4. Drag the tool's region (for the five-driver photo, after **Fit to screen**).
5. Default detection; no setting was opened or changed.

The app's saved outline was then compared with the outline from the same steps
on the build before this change. Regions matched to the pixel in every case, so
the differences below come from the step alone.

| Tool | Photo SHA-256 | Region in the corrected photo (x, y, w x h px) | Offer accepted |
| --- | --- | --- | --- |
| 1 Black click pen | `12bea7e06099` | 374, 291, 113 x 607 | Correct perspective & use scale |
| 3 Craftsman folding hex key set | `9290c504ff00` | 444, 513, 173 x 569 | Correct perspective & use scale |
| 4 Craftsman 25 ft tape measure | `c2523ddb4cf2` | 267, 449, 415 x 419 | Correct perspective & use aid scale |
| 6 Digital calipers | `187c0859dc40` | 636, 1040, 710 x 667 | Correct perspective & use scale |
| 22 Stapler | `86af206e4282` | 339, 226, 333 x 926 | Correct perspective & use scale |
| 25 Tweezers | `f20d5bf3ea93` | 385, 316, 99 x 594 | Correct perspective & use scale |
| 31 Wiha 150 mm driver, 3 of 5 | `8467ef2720e7` | 604, 253, 91 x 1112 | Correct perspective & use scale |

Resulting settings in every case: Tool edges, white sheet; sensitivity 128;
editable curves off; no margin.

## Results

"Dips left" counts the dips the rule would still bridge in the app's final
outline. "Moved" is the farthest the new outline lies outside and inside the old
one. "Left out" and "extra" are against the reference outlines: reviewed by the
maintainer for tools 1, 3 and 4, unreviewed drafts for the others.

| Tool | Points | Dips left | Moved out | Moved in | Left out (mm) | Extra (mm) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 Black click pen | 185 to 162 | 9 to 1 | 0.34 mm | 0.03 mm | 0.12 to 0.12 | 1.64 to 1.65 |
| 3 Hex key set | 98 to 82 | 11 to 1 | 0.21 mm | 0.02 mm | 0.00 to 0.00 | 0.83 to 0.83 |
| 4 Tape measure | 162 to 150 | 7 to 0 | 0.26 mm | 0.03 mm | 0.39 to 0.24 | 2.51 to 2.51 |
| 6 Digital calipers | 293 to 265 | 13 to 0 | 0.43 mm | 0.04 mm | 0.42 to 0.42 | 1.48 to 1.54 |
| 22 Stapler | 243 to 203 | 22 to 1 | 0.30 mm | 0.03 mm | 0.00 to 0.00 | 3.06 to 3.05 |
| 25 Tweezers | 99 to 98 | 3 to 0 | 0.33 mm | 0.02 mm | 0.00 to 0.00 | 0.90 to 0.92 |
| 31 Wiha driver, 3 of 5 | 202 to 140 | 19 to 0 | 0.42 mm | 0.02 mm | 0.00 to 0.00 | 5.65 to 5.65 |

- The step applied on all seven. Points fell from 1,282 to 1,100 in total.
- No outline moved inward by more than 0.04 mm, within the final smoothing's
  own 0.05 mm inward allowance, or outward by more than 0.43 mm.
- No tool crossed the 1 mm line for left-out or extra material in either
  direction. The tape measure's ribbed edge now lies along the reviewed line,
  and its largest left-out distance fell from 0.39 to 0.24 mm.
- The tape measure's 2.5 mm of extra material is unchanged. It is the side of
  the case, visible below the body, and the shadow at the top: outward errors
  of detection that this step does not address.
- The step itself took 0.2 to 0.4 ms per tool in the browser on a desktop.

## Diagnostics

These are replays of saved data, not results of the app.

- The post-detection cleanup was replayed in Node on the seven saved cases and
  reproduced the app's saved outlines exactly. Replayed on all 36 saved cases
  from 2026-11-12, the step applied on 34. On two (Wiha single driver A and Wiha
  150 mm driver 2 of 5) the ripple check turned the straightened outline down
  and the outline is what it was before.
- A first version compared the result's roughness with the straightened outline
  instead of the fitted one. It discarded the straightened outline of tool 31
  although it was smoother than the one the app kept (15.7 mm of jagged edge
  against 16.6 mm). The comparison is now with the fitted outline, as for the
  smoothing alone.
- A morphological closing with a 15 mm disc was tried first and rejected: on the
  tape measure's draft outline it filled only the bottoms of the notches, because
  a disc rolls into a 5.7 mm sawtooth.

## Tests

`shared/geometry/outline-straightening.test.ts` covers the rule: convex outlines
untouched, notches and ribs bridged, deep or wide dips kept, smooth concave
curves not faceted, ribs on a curve followed with short lines, holes, another
part of the outline in the way, repeated points, irregular outlines checked
against the material guards, and a 24,000-point outline. The cleanup tests in
`client/src/lib/image-processor.test.ts` cover its place in detection: applied
with and without a scale and with editable curves, the detected outline left
unstraightened, a paper mark inside a dip, and the fallback when a check fails.

## Not covered

- The other 29 tools were not rerun through the app.
- Phones: the step is a few hundred vertex operations and holds no image data,
  but it was timed on a desktop only.
- Editable curves, correction marks and manual settings through the UI; these
  are covered by tests, not by photo runs.
- Physical fit of a printed pocket.
- Dips wider than 10 mm, including the slow 20 to 25 mm wobble that long
  straight edges can show, are left alone by design.
