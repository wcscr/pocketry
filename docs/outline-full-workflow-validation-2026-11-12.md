# Full-workflow outline validation — 2026-11-12

This compares three builds on the same 36 tools: the earlier branch head
`b9c7c349`, this branch before the narrow-gap change (`d71e2cc0`), and the
detector as of `6c04a458`. Every number here comes from the app's own saved
outline after the workflow a user follows. All runs were local; GitHub CI
remained disabled.

## Method

Each of the 31 original JPEGs is a whole photo of tools on the calibration
sheet (v2 prints). For every tool:

1. **Start Over**, confirm, and load the original file through the app's photo
   input. The file hand-off is the only scripted step.
2. Wait for the app to find the markers, then press the option it offers:
   **Correct perspective & use scale** on 28 photos and **Correct perspective &
   use aid scale** on 3.
3. Drag the tool region on the canvas with pointer input.
4. Wait for default detection, cleanup, and smoothing. No setting is changed.

A second tool on a photo already loaded (marked † below) selects the Region
tool, presses **Fit to screen**, and drags the next region. The page was a
1440 × 900 desktop Chromium viewport served by `npm run dev` on an Apple Silicon
Mac. Read-only hooks added in the page at run time recorded the detector's input
and the saved outline; nothing in the source tree changed for the runs. Each
build was driven through the same steps. The driver stops when a region's
on-screen position differs from the plan, and the builds were checked to have
used the same photo hashes and regions: regions agree to within 0.01 working
pixels.

Original files, complete hashes, screenshots, captured inputs, and saved
outlines are retained locally and are not published.

### Scoring

Outlines are compared in millimeters, using the app's own calibration, with the
draft reference outlines described in [outline evaluation](outline-evaluation.md#draft-reference-outlines).
They are not an independent measurement: 31 take their shape from the outline
the detector gave on 2026-11-10 and 5 from a prototype, 11 were corrected by
hand, and each was then moved onto the strongest edge in the photo and smoothed.
They were drawn on the lower-resolution crops captured then and are placed on
these pictures by fitting bounds. No maintainer has reviewed them. A figure of a
few tenths of a millimeter is within their error, an error the detector made
that went unnoticed is built into them, and a large figure needs a look at the
picture before it is believed. **Left out** is the deepest
place where the outline is inside the reference. **Extra** is the farthest it
is outside. A **loopback** is an excursion that doubles back on itself; the count
misses channels wholly inside a tool. **Stair-stepped** means two or more
direction reversals per 100 mm.

## Results

| | `b9c7c349` | `d71e2cc0` | `6c04a458` |
| --- | ---: | ---: | ---: |
| Tools with 1 mm or more left out | 9 | 9 | 8 |
| Tools with 1 mm or more extra | 25 | 25 | 26 |
| Tools with a loopback | 5 | 5 | 4 |
| Stair-stepped tools | 1 | 1 | 1 |
| Tools with none of the four | 8 | 8 | 8 |
| Median offset (mm, outside is positive) | +0.47 | +0.47 | +0.47 |
| Outline points, all tools | 17,071 | 6,336 | 6,072 |
| Median points per tool | 442.5 | 161.5 | 167.5 |
| Edge outline accepted | 34 | 34 | 34 |
| Tools in more than one piece | 2 | 2 | 2 |
| Median detection time (ms) | 923 | 911 | 905 |
| Longest detection (ms) | 3,980 | 3,904 | 4,067 |

What changed for a user:

- **Fewer points, same boundary.** The default smoothing pass used to triple the
  point count. Accuracy between the first two builds is identical to within
  0.15 mm on every tool, with 63% fewer points.
- **Fanttik stand arm.** Paper entered a highlight on the holder through a faint
  edge, hollowed it, and left interior loops: 13.4 mm left out, 1,720 points,
  2.2 s. It now follows the outside: 295 points in 1.2 s. The remaining 3.2 mm is
  a fault in the draft reference beside the holder, not in the outline.
- **Flux syringe plunger.** The clear shaft is no longer cut into: 2.8 mm left
  out became 0.3 mm.
- **Rub 'n Buff.** The neck between tube and cap is closed and the loopback is
  gone. The white cap on white paper is still partly missed (5.7 mm).
- **More outside in three places.** Closing narrow openings also closes a few
  real ones or joins a shadow: folding knife +0.6 mm, plunger +1.1 mm, flux
  syringe +1.2 mm. All three stay under 2.5 mm. This is the deliberate trade.
- Of the other 31 tools, 27 are the same with and without the narrow-gap rule.
  The mini ratchet gains a slight bump along one edge (+0.1 mm outside, 70 more
  points). The pink needle hub, Gerber, and Wiha 150 mm driver 4 differ by a
  few points and less than 0.05 mm.

Known problems that remain, unchanged from `b9c7c349`:

- **Wiha 150 mm drivers 1 and 2** fall back to color contrast because the edge
  outline is rejected as clipped by the region (`selection-too-tight`). Driver 1
  comes out in three pieces.
- **Clear needle hub** is in three pieces (3.0 mm left out).
- **Flux syringe** (2.7 mm), **DeWalt screwdriver** (1.3 mm), and the **mould
  line remover** (1.0 mm) still leave material out.
- **Shadows, attached print, and a support wire** add material: the deburring
  tool's outline follows the wire the tool rests on out to the region's edge
  (10.1 mm; the reference has the wire removed by hand); Wiha driver 3 of 5
  5.7 mm, Gerber 3.8 mm with a loopback, stapler 3.1 mm.
- The area-averaged retry ran on three tools (clear needle hub, Gerber, cone
  nozzle) and its result was discarded each time, adding one to two seconds to
  each.
- The stand base takes about 4 s. Its region is the largest (2,037 × 1,870
  detector pixels), and the topology check accounts for most of that.
- The sheet layout was identified on 35 cases. On the DeWalt photo it was not,
  and both layouts' print areas were removed; the outline was the same.

| Case | Photo SHA-256 (first 16) | Region x, y, w, h (px) | Path | Left out (mm) | Extra (mm) | Loopbacks | Points | Detection (ms) |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| s01-black-click-pen | `12bea7e0609995cd` | 375, 292, 112, 607 | edges | 0.71 → 0.72 | 1.52 | 0 | 564 → 185 | 988 → 1250 |
| s02-brass-nameplate | `f84d87fa4b0e1d26` | 353, 356, 150, 351 | edges | 0.00 | 0.91 → 0.90 | 0 | 252 → 66 | 819 → 838 |
| s03-craftsman-hex-keys | `9290c504ff00fdae` | 445, 514, 172, 569 | edges | 0.00 | 0.88 | 0 | 285 → 98 | 959 → 843 |
| s04-craftsman-tape-measure | `c2523ddb4cf29547` | 268, 449, 415, 419 | edges | 0.05 | 1.54 → 1.53 | 0 | 454 → 162 | 1494 → 1569 |
| s05-dewalt-screwdriver | `8ee756cc022870ac` | 930, 923, 243, 959 | edges | 1.36 → 1.31 | 2.52 → 2.49 | 0 | 843 → 298 | 983 → 820 |
| s06-digital-calipers | `187c0859dc40ea10` | 636, 1040, 710, 667 | edges | 0.41 → 0.42 | 1.48 | 0 | 853 → 293 | 1269 → 1256 |
| s07-needle-clear-hub | `04a85dee41fd641c` | 337, 625, 169, 65 | edges | 2.98 → 2.95 | 0.88 → 0.86 | 0 | 196 → 163 | 1719 → 1737 |
| s08-needle-pink-hub † | `04a85dee41fd641c` | 342, 564, 161, 64 | edges | 0.10 → 0.09 | 0.65 → 0.64 | 0 | 48 → 52 | 789 → 760 |
| s09-fanttik-desoldering-pump | `c662539c017f1f58` | 425, 184, 175, 837 | edges | 0.00 | 1.36 → 1.32 | 0 | 619 → 226 | 891 → 902 |
| s10-fanttik-soldering-iron | `13351f32643d5b89` | 453, 296, 173, 797 | edges | 0.00 | 1.20 → 1.17 | 0 | 483 → 161 | 882 → 891 |
| s11-fanttik-stand-arm | `281ced2ee6b4a8c9` | 243, 673, 433, 524 | edges | 13.44 → 3.21 | 0.88 → 0.85 | 0 | 1720 → 295 | 2176 → 1178 |
| s12-fanttik-stand-base | `1249e95a841002de` | 122, 340, 730, 670 | edges | 0.00 | 0.85 → 0.84 | 0 | 497 → 161 | 3980 → 4067 |
| s13-flipper-zero | `9f771bb416126f5b` | 625, 996, 490, 247 | edges | 0.00 | 0.72 | 0 | 212 → 89 | 815 → 827 |
| s14-folding-knife | `f8476398b1c68754` | 504, 819, 229, 445 | edges | 0.06 | 1.40 → 2.00 | 0 | 399 → 183 | 984 → 990 |
| s15-gerber-multitool | `023054e4c0fcb586` | 391, 512, 236, 511 | edges | 0.00 | 3.76 → 3.80 | 1 | 644 → 229 | 1964 → 1990 |
| s16-gray-click-pen | `1f3817aa32ec05c2` | 112, 621, 631, 124 | edges | 0.00 | 0.95 → 0.94 | 0 | 340 → 114 | 769 → 746 |
| s17-mini-ratchet | `1596e0d18b77b4d6` | 412, 1382, 507, 142 | edges | 0.10 → 0.01 | 2.03 → 2.11 | 0 | 335 → 213 | 863 → 908 |
| s18-rub-n-buff | `b0bc883982df6534` | 317, 519, 384, 163 | edges | 6.13 → 5.67 | 1.52 → 1.51 | 1 → 0 | 668 → 192 | 827 → 841 |
| s19-ryobi-cutter | `dc43e808134a90a6` | 217, 460, 789, 896 | edges | 0.00 | 1.67 → 1.68 | 0 | 796 → 293 | 1035 → 1074 |
| s20-flux-syringe-plunger | `bdf55b7b2873a9e7` | 240, 613, 437, 115 | edges | 2.81 → 0.34 | 0.97 → 2.03 | 1 | 522 → 222 | 798 → 836 |
| s21-flux-syringe | `daa01db1308ef423` | 213, 557, 559, 231 | edges | 2.70 → 2.67 | 1.31 → 2.49 | 1 | 623 → 223 | 955 → 1185 |
| s22-stapler | `86af206e42829f6e` | 339, 226, 333, 926 | edges | 0.00 | 3.06 | 0 | 789 → 243 | 1178 → 1179 |
| s23-tarkit-mould-line-remover | `659e4d7198c712f2` | 814, 857, 137, 612 | edges | 1.03 | 1.73 → 1.69 | 0 | 123 → 115 | 726 → 787 |
| s24-deburring-tool | `0eec340fca842bb2` | 958, 833, 129, 593 | edges | 0.00 | 10.01 → 10.13 | 1 | 341 → 116 | 727 → 754 |
| s25-tweezers | `f20d5bf3ea9357e9` | 385, 316, 100, 594 | edges | 0.00 | 0.90 | 0 | 302 → 99 | 831 → 926 |
| s26-wiha-single-a | `859cf35d210b4915` | 625, 774, 102, 733 | edges | 0.00 | 1.82 → 1.81 | 0 | 403 → 129 | 728 → 771 |
| s27-wiha-single-b | `773451fa81010e12` | 582, 849, 140, 637 | edges | 0.00 | 1.32 → 1.30 | 0 | 295 → 95 | 764 → 843 |
| s28-wiha-single-c | `b91fd0ca059d2d47` | 643, 914, 107, 534 | edges | 0.12 → 0.11 | 1.25 → 1.21 | 0 | 299 → 93 | 724 → 783 |
| s29-wiha-150mm-1 † | `8467ef2720e7af6b` | 411, 247, 96, 1119 | color | 2.74 | 1.43 → 1.44 | 0 | 519 → 172 | 1061 → 1176 |
| s30-wiha-150mm-2 † | `8467ef2720e7af6b` | 508, 247, 92, 1119 | color | 1.33 | 1.11 | 0 | 106 | 983 → 1232 |
| s31-wiha-150mm-3 † | `8467ef2720e7af6b` | 604, 253, 91, 1112 | edges | 0.00 | 5.52 → 5.65 | 0 | 620 → 202 | 768 → 801 |
| s32-wiha-150mm-4 † | `8467ef2720e7af6b` | 701, 322, 92, 1044 | edges | 0.00 | 1.77 → 1.74 | 0 | 212 → 185 | 748 → 856 |
| s33-wiha-150mm-5 † | `8467ef2720e7af6b` | 795, 336, 92, 1029 | edges | 0.08 | 1.29 | 0 | 431 → 143 | 732 → 913 |
| s34-wolfbox-air-duster | `613d60ac92db52c7` | 346, 357, 445, 692 | edges | 0.00 | 1.26 → 1.22 | 0 | 521 → 197 | 1314 → 1627 |
| s35-wolfbox-cone-nozzle | `97383f65c1239824` | 379, 616, 258, 263 | edges | 0.12 → 0.07 | 0.46 | 0 | 193 → 70 | 2312 → 3152 |
| s36-wolfbox-long-nozzle | `95079038c6d81248` | 388, 463, 229, 578 | edges | 0.00 | 2.30 → 2.29 | 0 | 564 → 189 | 954 → 902 |

Each cell is `b9c7c349` → `6c04a458`, or one value when they agree. Regions are
in working-photo pixels after perspective correction. † marks a tool selected on
a photo that was already loaded. The first Wiha 150 mm driver is marked because
**Fit to screen** was needed to bring its region onto the canvas.

Detection times are single runs on a development server and vary by a few
hundred milliseconds between runs of the same build; the cone nozzle's
difference is within that. They are not a benchmark.

## Other checks

Replaying the detector on the inputs the app captured reproduced the app's
detection on all 36 tools, which is what made the following usable as
diagnostics. They do not qualify anything on their own.

- Shrinking every photo by area averaging instead of bilinear sampling was worse
  (11 tools with material left out), as was a two-step shrink (10). Neither was
  adopted.
- The narrow-gap rule was tried on the captured inputs first, then confirmed
  through the full workflow above.

## Not covered

- Phones: neither runtime nor memory was measured on one. The narrow-gap rule
  adds two passes over at most 512 × 512 pixels, two byte masks of that size,
  and no inference. On the desktop used here one reconstruction pass over a
  full synthetic frame took 39.6 ms with the rule and 37.5 ms without (median
  of 30); automatic sensitivity runs up to 14 such passes, or 28 with the
  retry. The default smoothing pass and its thinning run in the existing worker.
- Physical fit: no pocket was printed from these outlines.
- v3 sheets: every photo here is of a v2 print. Layout detection for v3 is
  covered by synthetic tests only.
- Correction marks, manual settings, and Auto simplify were not rerun through
  the workflow for this comparison; their behavior is covered by component and
  unit tests.
