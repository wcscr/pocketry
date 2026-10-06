# Thin-feature recovery

Local comparison on 2026-10-06 against main `2a55465` (PR #126).
Issue #83 remains open.

## Change

Mask opening was erasing narrow shafts that already passed the contrast
threshold. Both backends now restore connected foreground around one retained
solid component. Isolated speckles stay removed. Regions connecting multiple
solid components keep the existing cleanup, avoiding joins between tools.
Small surviving shaft fragments do not count as separate solid components.

The threshold, image resolution, calibration, and refinement settings are
unchanged. Recovery cannot restore a feature whose contrast falls below the
threshold. Higher-resolution trials did not reliably solve that limitation.

## Photo checks

Chrome 154.0.8037.98 decoded the existing 1727 × 2235 Wiha PNGs directly into
the normal 464 × 600 Trace canvas. The 40/50/60 mm region was
`(161, 81, 161, 443)`; the five-tool 150 mm region was `(92, 1, 250, 572)`.
The latter includes printed lines and is deliberately an ambiguous stress case.
Source hashes are in [the previous validation](detector-backend-validation.md).

| Photo | Stored detector bias | Result |
| --- | ---: | --- |
| 40 mm | 128 (default) | A little more shaft retained; most still missing. |
| 40 mm | 100 | Reaches the tip; previously stopped near the handle. |
| 50 mm | 128 | Retains the long shaft; previously stopped at the handle. |
| 60 mm | 128 | Retains most of the shaft; reflective tip still incomplete. |
| 150 mm, five tools | 128 | Mixed, incomplete shafts; ambiguous connections stay excluded. |

The sensitivity control now shows `128 − stored bias`: higher includes more
of the image. A stored bias of 128 displays **auto**; 100 displays **+28**.
Existing detector settings and saved traces keep the same meaning.

These are visual and landmark checks, not labelled whole-outline accuracy or
physical fit measurements. OpenCV/JS mask IoU was 0.9846–0.9942 across these
cases; weak reflective boundaries still differ between the backends.

Two cropped RGBA fixtures and shaft/background landmarks are included with
the tests. Synthetic cases cover straight/angled shafts, surviving shaft
fragments, alpha masks, speckles, and unequal tools connected by a stray line.
Existing shadow, concavity, hole, and backend-agreement tests still pass.

## Browser and performance

Seven warm segmentation runs per case, after two warmups:

| Setting | Baseline OpenCV | Updated OpenCV | Updated JS |
| --- | ---: | ---: | ---: |
| Desktop | 3.3–6.5 ms | 2.9–6.7 ms | 9.1–18.8 ms |
| 6× CPU throttle | 21.5–42.9 ms | 18.9–43.1 ms | 59.3–117.1 ms |

The OpenCV path also avoids copying the score buffer into a JavaScript array
before constructing its mask. This offsets recovery work in these samples.
The helper adds one label buffer per pixel and a queue per foreground pixel;
photo pixel counts were 71,323 and 143,000. Peak memory was not measured.
CPU throttling is desktop emulation, not a physical phone benchmark. Cold
initialization is excluded.

Blocking OpenCV in a fresh browser session exercised automatic JS fallback,
which retained the 50 mm shaft. The actual desktop/mobile upload flow retained
the 50 mm shaft at default sensitivity and the 40 mm shaft at stored bias 100
(**+28** on the revised control). Both flows had no uncaught page errors.

Node 22 local gates: `npm run check`, `npm test` (2,746 tests in 154 files),
`npm run build`, and `git diff --check` passed. GitHub CI remains disabled.

Local before/after overlays, bounds, timings, and UI captures are in
`outputs/reflective-detection-2026-10-06/`; they are review artifacts, not part
of the shipped app. Remaining work includes stronger handling of weak/glare
boundaries, more varied labelled photos, and measurements on phone hardware.
