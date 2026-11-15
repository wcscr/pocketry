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

__SUMMARY__

A single outline is a connectivity measure, not an accuracy score: it may still omit tool material, contain false holes or include a shadow. Visual assessments are qualitative judgments from the paired images. They are not an independent ground-truth benchmark.

## Every reference entry

Magenta is **1.9.0**; teal is **1.10.0**. Point counts include every stored outer and hole point. Each row links to its images and a short description.

__TABLE__

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

__GALLERY__
