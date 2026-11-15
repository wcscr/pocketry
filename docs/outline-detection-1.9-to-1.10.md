# Outline detection: 1.9 → 1.10

Captured November 15, 2026. All **36 reference entries / 31 distinct original photos** from the maintainer-selected `ReferenceVerification/photos` folder are included. These are the default outlines shown by the application after calibration and region selection.

[Interactive report](../client/public/reports/outline-1.9-to-1.10/index.html) · [Report files](../client/public/reports/outline-1.9-to-1.10/) · [Geometry, settings and source hashes](../client/public/reports/outline-1.9-to-1.10/data.json)

The interactive report is available at `/reports/outline-1.9-to-1.10/` when this revision is served or built. For offline viewing, keep its folder together and open `index.html`. The gallery below renders directly on GitHub.

## What changed

- **More complete tools:** 1.10 recovers dark housings, reflective shafts and clear parts that 1.9 often omitted. The tape measure, DeWalt screwdriver, calipers, folding knife and Ryobi cutter show particularly large gains.
- **Less fragmentation:** cases producing multiple separate outlines fall from **13 to 2**. The clear needle hub and first long Wiha driver remain fragmented.
- **Visible tradeoffs:** new shadow/printing protrusions appear on the Gerber, mini ratchet, black pen and third long Wiha driver. The deburring tool picks up its photography support wire. The stapler's opening is largely filled. These are shown without manual correction.
- **Remaining omissions:** the white Rub 'n Buff cap is still missed; the clear needle hub and flux syringe retain incorrect cuts or holes.
- **More points overall:** median stored points increase from **66 to 152**, and total points from **3,394 to 5,702**. Recovering missing material can require more geometry. This release comparison does not support a blanket claim of fewer points than 1.9.

| Recorded output | 1.9.0 | 1.10.0 |
| --- | ---: | ---: |
| Cases with one outline | 23 | 34 |
| Cases with multiple outlines | 13 | 2 |
| Total separate outlines | 58 | 39 |
| Total stored points | 3394 | 5702 |
| Median points per case | 66 | 152 |

A single outline is a connectivity measure, not an accuracy score: it may still omit tool material, contain false holes or include a shadow. Visual assessments are qualitative judgments from the paired images. They are not an independent ground-truth benchmark.

## Every reference entry

Magenta is **1.9.0**; teal is **1.10.0**. Point counts include every stored outer and hole point. Each row links to its images and a short description.

| # | Reference | Visual assessment | Outlines, 1.9 → 1.10 | Points, 1.9 → 1.10 |
| ---: | --- | --- | ---: | ---: |
| 1 | [Black click pen](#s01-black-click-pen) | Tradeoff | 1 → 1 | 60 → 184 |
| 2 | [Brass nameplate blank](#s02-brass-nameplate) | Similar | 1 → 1 | 17 → 57 |
| 3 | [Craftsman folding hex key set](#s03-craftsman-hex-keys) | Improved | 1 → 1 | 36 → 80 |
| 4 | [Craftsman 25 ft tape measure](#s04-craftsman-tape-measure) | Improved | 2 → 1 | 88 → 159 |
| 5 | [DeWalt cordless screwdriver](#s05-dewalt-screwdriver) | Improved | 3 → 1 | 183 → 265 |
| 6 | [Digital calipers](#s06-digital-calipers) | Improved | 2 → 1 | 308 → 265 |
| 7 | [Dispensing needle, clear hub](#s07-needle-clear-hub) | Still incomplete | 2 → 2 | 37 → 228 |
| 8 | [Dispensing needle, pink hub](#s08-needle-pink-hub) | Improved | 3 → 1 | 22 → 48 |
| 9 | [Fanttik desoldering pump](#s09-fanttik-desoldering-pump) | Improved | 1 → 1 | 68 → 201 |
| 10 | [Fanttik soldering iron](#s10-fanttik-soldering-iron) | Similar | 1 → 1 | 35 → 158 |
| 11 | [Fanttik soldering stand arm](#s11-fanttik-stand-arm) | Improved | 2 → 1 | 198 → 294 |
| 12 | [Fanttik soldering stand base](#s12-fanttik-stand-base) | Similar | 1 → 1 | 64 → 165 |
| 13 | [Flipper Zero](#s13-flipper-zero) | Similar | 1 → 1 | 24 → 82 |
| 14 | [Wood-inlay folding knife](#s14-folding-knife) | Improved | 5 → 1 | 244 → 124 |
| 15 | [Gerber multitool](#s15-gerber-multitool) | Tradeoff | 1 → 1 | 103 → 213 |
| 16 | [Gray click pen](#s16-gray-click-pen) | Similar | 1 → 1 | 47 → 101 |
| 17 | [Mini ratchet](#s17-mini-ratchet) | Tradeoff | 1 → 1 | 38 → 185 |
| 18 | [Rub 'n Buff silver-leaf tube](#s18-rub-n-buff) | Improved | 2 → 1 | 30 → 88 |
| 19 | [Ryobi cordless cutter](#s19-ryobi-cutter) | Improved | 2 → 1 | 108 → 280 |
| 20 | [Flux-syringe plunger](#s20-flux-syringe-plunger) | Improved | 1 → 1 | 15 → 146 |
| 21 | [10 ml flux syringe](#s21-flux-syringe) | Improved | 4 → 1 | 229 → 463 |
| 22 | [Stapler](#s22-stapler) | Tradeoff | 1 → 1 | 183 → 203 |
| 23 | [Tarkit mould-line remover](#s23-tarkit-mould-line-remover) | Improved | 1 → 1 | 75 → 121 |
| 24 | [Teardrop-handle deburring tool](#s24-deburring-tool) | Tradeoff | 1 → 1 | 127 → 101 |
| 25 | [Tweezers](#s25-tweezers) | Improved | 1 → 1 | 45 → 95 |
| 26 | [Wiha precision screwdriver, single (092453)](#s26-wiha-single-a) | Improved | 1 → 1 | 38 → 106 |
| 27 | [Wiha precision screwdriver, single (092506)](#s27-wiha-single-b) | Improved | 1 → 1 | 32 → 78 |
| 28 | [Wiha precision screwdriver, single (092528)](#s28-wiha-single-c) | Improved | 1 → 1 | 39 → 78 |
| 29 | [Wiha 150 mm driver, 1 of 5](#s29-wiha-150mm-1) | Still incomplete | 3 → 3 | 111 → 158 |
| 30 | [Wiha 150 mm driver, 2 of 5](#s30-wiha-150mm-2) | Improved | 1 → 1 | 74 → 106 |
| 31 | [Wiha 150 mm driver, 3 of 5](#s31-wiha-150mm-3) | Tradeoff | 1 → 1 | 118 → 140 |
| 32 | [Wiha 150 mm driver, 4 of 5](#s32-wiha-150mm-4) | Improved | 2 → 1 | 45 → 212 |
| 33 | [Wiha 150 mm driver, 5 of 5](#s33-wiha-150mm-5) | Improved | 3 → 1 | 51 → 107 |
| 34 | [Wolfbox air duster](#s34-wolfbox-air-duster) | Improved | 1 → 1 | 283 → 174 |
| 35 | [Wolfbox angled cone nozzle](#s35-wolfbox-cone-nozzle) | Improved | 1 → 1 | 126 → 70 |
| 36 | [Wolfbox long nozzle assembly](#s36-wolfbox-long-nozzle) | Improved | 1 → 1 | 93 → 167 |

## Method and reproducibility

| Version | Exact snapshot | Meaning |
| --- | --- | --- |
| 1.9.0 | [`4f6dc95b`](https://github.com/wcscr/pocketry/commit/4f6dc95b) | Main immediately before the detection merge. |
| 1.10.0 | [`f6fbccc0`](https://github.com/wcscr/pocketry/commit/f6fbccc0) | Merged detection release, before the later 1.11 SVG import change. |

Each of the 36 entries was run separately on both releases: **72 completed workflows**. In a fresh desktop Chrome context at 1440 × 900:

1. Choose the original, unmodified calibration-sheet JPEG.
2. Let the application find the markers and accept its **Correct perspective & use scale**, or **use aid scale**, offer.
3. Draw the same planned tool region with pointer input.
4. Wait for detection and the release's automatic cleanup to finish. Capture the final displayed and saved outline.

No manual sensitivity, correction marks, optional simplification, saved outlines, precomputed calibration or detector input injection was used. Read-only worker and IndexedDB observations record the results. The 1.9 detector runs on the main thread, so it has no worker observation; its saved and rendered outline is recorded in the same way.

The releases intentionally use their own defaults. In particular, 1.10 uses Tool edges, original-photo detail sampling and automatic reconstruction/smoothing. This measures the change in the complete user workflow; it does not isolate one algorithm or give the detectors identical prepared crops.

**Pairing checks passed for every entry:** original SHA-256, corrected-photo bytes, calibration, working dimensions and actual selected region match exactly across versions. The loaded files were source copies verified byte-for-byte against all 36 named files in `ReferenceVerification/photos`; both names and hashes are retained in the data. Those 36 entries contain 31 distinct JPEGs: the needle photo is selected twice and the five-driver photo five times.

The selected areas are frozen in [capture-plan.json](../client/public/reports/outline-1.9-to-1.10/capture-plan.json). [data.json](../client/public/reports/outline-1.9-to-1.10/data.json) contains full commit IDs, original and corrected-photo hashes, actual regions, calibration, settings, ordered actions, final geometry and counts. The [capture driver](../scripts/outline-eval/compare-releases.mjs) uses the real UI; the [renderer](../scripts/outline-eval/render-release-report.py) only transforms completed outputs for display. See [the reproduction instructions](../scripts/outline-eval/README.md#release-comparison) for commands.

Presentation images are cropped, sometimes rotated 90°, and compressed **after detection**. Both versions share the same photo framing and scale; no outline was redrawn or repaired for the report. Original photos and full UI screenshots remain local. Published derivatives omit original EXIF metadata.

## Limits

- These are development photos already used while improving detection, not a held-out validation set. The previously generated draft reference contours were not used as accuracy ground truth.
- Every source photo uses a v2 sheet. This report does not qualify v3 photography, other backgrounds, every possible selection, manual correction tools, phones or physical pocket fit.
- Timing is omitted: concurrent local development-server captures are not a controlled performance benchmark.
- “Improved” refers to the visible comparison, not a claim that the result is perfect. Individual notes retain errors and tradeoffs.

## Verification and provenance

All 72 selected workflows completed with nonempty saved and rendered outlines; all 36 pairs passed the source/frame/selection checks. Every paired image was visually reviewed. Local type-checking and the quick suite passed on Node 22.23.5 (**266 files; 4,237 passed, one expected failure**). Report browser checks cover searching, filtering, overlay view, outline visibility, zoom, image loading and narrow-screen layout. A production build verifies the report is included in the static output. Hosted CI remained disabled.

No application detector, model, dependency version or third-party material was added or changed. Photographs were supplied by the project maintainer; the report adds derived comparison images and recorded results. Browser automation uses an existing local Playwright installation, and rendering uses local Pillow; neither is bundled with the app.

## Full visual gallery

<a id="s01-black-click-pen"></a>
### 01. Black click pen

The clip is followed more cleanly, but 1.10 adds a wavy band of shadow above the barrel.

![1.9 and 1.10 outlines for Black click pen](../client/public/reports/outline-1.9-to-1.10/s01-black-click-pen.webp)

<a id="s02-brass-nameplate"></a>
### 02. Brass nameplate blank

Both versions recover the plaque. The 1.10 outline sits slightly farther out and adds small bumps along the long edge.

![1.9 and 1.10 outlines for Brass nameplate blank](../client/public/reports/outline-1.9-to-1.10/s02-brass-nameplate.webp)

<a id="s03-craftsman-hex-keys"></a>
### 03. Craftsman folding hex key set

Recovers the black side panels instead of tracing only the red handle.

![1.9 and 1.10 outlines for Craftsman folding hex key set](../client/public/reports/outline-1.9-to-1.10/s03-craftsman-hex-keys.webp)

<a id="s04-craftsman-tape-measure"></a>
### 04. Craftsman 25 ft tape measure

Recovers the full dark casing and hook as one outline; 1.9 follows red panels and cuts through the reference strip.

![1.9 and 1.10 outlines for Craftsman 25 ft tape measure](../client/public/reports/outline-1.9-to-1.10/s04-craftsman-tape-measure.webp)

<a id="s05-dewalt-screwdriver"></a>
### 05. DeWalt cordless screwdriver

Recovers the dark grip, chuck and rear cap as one outline instead of three colored fragments.

![1.9 and 1.10 outlines for DeWalt cordless screwdriver](../client/public/reports/outline-1.9-to-1.10/s05-dewalt-screwdriver.webp)

<a id="s06-digital-calipers"></a>
### 06. Digital calipers

Recovers the reflective beam and connects it to the body. A small bump remains on the beam edge.

![1.9 and 1.10 outlines for Digital calipers](../client/public/reports/outline-1.9-to-1.10/s06-digital-calipers.webp)

<a id="s07-needle-clear-hub"></a>
### 07. Dispensing needle, clear hub

The clear hub remains split and cut into. Its smoother boundary does not make it a complete tool outline.

![1.9 and 1.10 outlines for Dispensing needle, clear hub](../client/public/reports/outline-1.9-to-1.10/s07-needle-clear-hub.webp)

<a id="s08-needle-pink-hub"></a>
### 08. Dispensing needle, pink hub

Connects the pink hub and metal needle into one complete silhouette instead of three fragments.

![1.9 and 1.10 outlines for Dispensing needle, pink hub](../client/public/reports/outline-1.9-to-1.10/s08-needle-pink-hub.webp)

<a id="s09-fanttik-desoldering-pump"></a>
### 09. Fanttik desoldering pump

Includes the pale nozzle and follows the plunger shaft more continuously, with a slightly larger outline.

![1.9 and 1.10 outlines for Fanttik desoldering pump](../client/public/reports/outline-1.9-to-1.10/s09-fanttik-desoldering-pump.webp)

<a id="s10-fanttik-soldering-iron"></a>
### 10. Fanttik soldering iron

Both recover the body; 1.10 rounds the shoulders and includes the small raised control more fully.

![1.9 and 1.10 outlines for Fanttik soldering iron](../client/public/reports/outline-1.9-to-1.10/s10-fanttik-soldering-iron.webp)

<a id="s11-fanttik-stand-arm"></a>
### 11. Fanttik soldering stand arm

Connects the reflective curved arm and follows its outer edges instead of splitting the arm at a highlight.

![1.9 and 1.10 outlines for Fanttik soldering stand arm](../client/public/reports/outline-1.9-to-1.10/s11-fanttik-stand-arm.webp)

<a id="s12-fanttik-stand-base"></a>
### 12. Fanttik soldering stand base

Both recover the round base. The 1.10 boundary is slightly farther outside the rim.

![1.9 and 1.10 outlines for Fanttik soldering stand base](../client/public/reports/outline-1.9-to-1.10/s12-fanttik-stand-base.webp)

<a id="s13-flipper-zero"></a>
### 13. Flipper Zero

Both recover the case and ignore the reference strip on top; 1.10 rounds the corners more smoothly.

![1.9 and 1.10 outlines for Flipper Zero](../client/public/reports/outline-1.9-to-1.10/s13-flipper-zero.webp)

<a id="s14-folding-knife"></a>
### 14. Wood-inlay folding knife

Recovers the reflective metal and wood as one silhouette instead of five fragments.

![1.9 and 1.10 outlines for Wood-inlay folding knife](../client/public/reports/outline-1.9-to-1.10/s14-folding-knife.webp)

<a id="s15-gerber-multitool"></a>
### 15. Gerber multitool

Smooths the long edges, but adds a pronounced shadow spur at one end and a deeper slit between the handles.

![1.9 and 1.10 outlines for Gerber multitool](../client/public/reports/outline-1.9-to-1.10/s15-gerber-multitool.webp)

<a id="s16-gray-click-pen"></a>
### 16. Gray click pen

Both recover the pen; 1.10 removes small edge spikes and rounds the clip and tip.

![1.9 and 1.10 outlines for Gray click pen](../client/public/reports/outline-1.9-to-1.10/s16-gray-click-pen.webp)

<a id="s17-mini-ratchet"></a>
### 17. Mini ratchet

Both recover the ratchet, but 1.10 adds an outward step along the handle's shadow.

![1.9 and 1.10 outlines for Mini ratchet](../client/public/reports/outline-1.9-to-1.10/s17-mini-ratchet.webp)

<a id="s18-rub-n-buff"></a>
### 18. Rub 'n Buff silver-leaf tube

Recovers most of the reflective tube instead of just the red label. The white cap is still missing and small foldbacks remain.

![1.9 and 1.10 outlines for Rub 'n Buff silver-leaf tube](../client/public/reports/outline-1.9-to-1.10/s18-rub-n-buff.webp)

<a id="s19-ryobi-cutter"></a>
### 19. Ryobi cordless cutter

Recovers the dark grip, end cap and reflective cutting head as one silhouette instead of colored fragments.

![1.9 and 1.10 outlines for Ryobi cordless cutter](../client/public/reports/outline-1.9-to-1.10/s19-ryobi-cutter.webp)

<a id="s20-flux-syringe-plunger"></a>
### 20. Flux-syringe plunger

Recovers the clear shaft and thumb pad instead of only the black seal. Spurs remain around the pad and seal.

![1.9 and 1.10 outlines for Flux-syringe plunger](../client/public/reports/outline-1.9-to-1.10/s20-flux-syringe-plunger.webp)

<a id="s21-flux-syringe"></a>
### 21. 10 ml flux syringe

Connects the syringe body, tip and finger grips, but false interior holes and label-related cuts remain.

![1.9 and 1.10 outlines for 10 ml flux syringe](../client/public/reports/outline-1.9-to-1.10/s21-flux-syringe.webp)

<a id="s22-stapler"></a>
### 22. Stapler

Removes jagged shadow edges, but fills much of the visible opening between the stapler arms.

![1.9 and 1.10 outlines for Stapler](../client/public/reports/outline-1.9-to-1.10/s22-stapler.webp)

<a id="s23-tarkit-mould-line-remover"></a>
### 23. Tarkit mould-line remover

Recovers the blade tip more fully and smooths the handle shadow; the blade notch still needs inspection.

![1.9 and 1.10 outlines for Tarkit mould-line remover](../client/public/reports/outline-1.9-to-1.10/s23-tarkit-mould-line-remover.webp)

<a id="s24-deburring-tool"></a>
### 24. Teardrop-handle deburring tool

Smooths the handle and metal tip, but includes a prominent spur from the photography support wire.

![1.9 and 1.10 outlines for Teardrop-handle deburring tool](../client/public/reports/outline-1.9-to-1.10/s24-deburring-tool.webp)

<a id="s25-tweezers"></a>
### 25. Tweezers

Recovers the pale tweezer tip instead of cutting into it at the highlight.

![1.9 and 1.10 outlines for Tweezers](../client/public/reports/outline-1.9-to-1.10/s25-tweezers.webp)

<a id="s26-wiha-single-a"></a>
### 26. Wiha precision screwdriver, single (092453)

Recovers the reflective flat shaft and tip instead of leaving a long cut through the shaft.

![1.9 and 1.10 outlines for Wiha precision screwdriver, single (092453)](../client/public/reports/outline-1.9-to-1.10/s26-wiha-single-a.webp)

<a id="s27-wiha-single-b"></a>
### 27. Wiha precision screwdriver, single (092506)

Recovers the complete reflective shaft and tip with a continuous outer boundary.

![1.9 and 1.10 outlines for Wiha precision screwdriver, single (092506)](../client/public/reports/outline-1.9-to-1.10/s27-wiha-single-b.webp)

<a id="s28-wiha-single-c"></a>
### 28. Wiha precision screwdriver, single (092528)

Recovers the thin shaft and tip instead of following only its dark reflection.

![1.9 and 1.10 outlines for Wiha precision screwdriver, single (092528)](../client/public/reports/outline-1.9-to-1.10/s28-wiha-single-c.webp)

<a id="s29-wiha-150mm-1"></a>
### 29. Wiha 150 mm driver, 1 of 5

Removes some attached printing and smooths the handle, but the long shaft still splits into three outline pieces.

![1.9 and 1.10 outlines for Wiha 150 mm driver, 1 of 5](../client/public/reports/outline-1.9-to-1.10/s29-wiha-150mm-1.webp)

<a id="s30-wiha-150mm-2"></a>
### 30. Wiha 150 mm driver, 2 of 5

Reduces attached printing and smooths the shaft and handle; the reflective shaft still has a narrow internal gap.

![1.9 and 1.10 outlines for Wiha 150 mm driver, 2 of 5](../client/public/reports/outline-1.9-to-1.10/s30-wiha-150mm-2.webp)

<a id="s31-wiha-150mm-3"></a>
### 31. Wiha 150 mm driver, 3 of 5

Recovers the shaft more fully, but adds a tall spur from nearby sheet printing at the cap.

![1.9 and 1.10 outlines for Wiha 150 mm driver, 3 of 5](../client/public/reports/outline-1.9-to-1.10/s31-wiha-150mm-3.webp)

<a id="s32-wiha-150mm-4"></a>
### 32. Wiha 150 mm driver, 4 of 5

Connects the split shaft and recovers its width; small ripples remain along the long edge.

![1.9 and 1.10 outlines for Wiha 150 mm driver, 4 of 5](../client/public/reports/outline-1.9-to-1.10/s32-wiha-150mm-4.webp)

<a id="s33-wiha-150mm-5"></a>
### 33. Wiha 150 mm driver, 5 of 5

Connects the three fragments into a continuous shaft and handle, including the tip.

![1.9 and 1.10 outlines for Wiha 150 mm driver, 5 of 5](../client/public/reports/outline-1.9-to-1.10/s33-wiha-150mm-5.webp)

<a id="s34-wolfbox-air-duster"></a>
### 34. Wolfbox air duster

Removes much of the jagged shadow along the grip and nozzle and produces a smoother silhouette.

![1.9 and 1.10 outlines for Wolfbox air duster](../client/public/reports/outline-1.9-to-1.10/s34-wolfbox-air-duster.webp)

<a id="s35-wolfbox-cone-nozzle"></a>
### 35. Wolfbox angled cone nozzle

Replaces the large jagged shadow boundary with a much closer, smoother nozzle outline.

![1.9 and 1.10 outlines for Wolfbox angled cone nozzle](../client/public/reports/outline-1.9-to-1.10/s35-wolfbox-cone-nozzle.webp)

<a id="s36-wolfbox-long-nozzle"></a>
### 36. Wolfbox long nozzle assembly

Smooths the ribs and removes jagged shadow excursions around the connector shoulders.

![1.9 and 1.10 outlines for Wolfbox long nozzle assembly](../client/public/reports/outline-1.9-to-1.10/s36-wolfbox-long-nozzle.webp)
