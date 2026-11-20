# Tutorial images

The [README tutorial](../../README.md#basic-process) uses current editor captures
and explicitly labeled original print/slicer photographs. The Bin captures are from November 15, 2026 at
`a627ee6b` (Pocketry 1.12.0). The Trace capture was refreshed on November 18,
2026 from the Edit outline update based on `79164b08`. No generated imagery or
retouching was used. Screenshots record app output; they do not establish physical fit.

## Current editor captures

The Trace screenshot was captured in Chrome at 1440 × 900. The Bin screenshots
were captured in the desktop in-app browser. The responsive layout can put properties on the right or in one panel,
depending on available width and the saved editor layout. Use the named controls
rather than a fixed screen position. No application state was injected.

| Image | How to reproduce |
| --- | --- |
| `trace-outline.jpg` | Open the original Wolfbox body photo, accept **Correct perspective & use scale**, draw a region around the tool, and wait for default detection. Choose **Edit outline** with experimental features off to show the contour points and standard editing controls. |
| `bin-layout.jpg` | **Open Sample Projects → Wolfbox MF70 Airduster Kit**, then **Layout → Bin size**. The saved sample is 4 × 4 cells and 6.5u high, with four pockets and two finger-access features. |
| `ruler-check.jpg` | Select the Wolfbox body pocket in Layout, expand **Size & scale**, enable **Measure between contours**, and click its upper/lower contour. This capture measures 145.30 mm between the chosen endpoints; total pocket length is 145.57 mm. |
| `export-3mf.jpg` | Open that sample, then **Export → Save 3MF**. Capture the format choices without exporting or changing the design. |

The Bin captures use the existing sample geometry, not a new trace transferred
from this session. The original print's black/orange colors differ from the
editable sample's saved display colors.

### Trace photo and settings

Maintainer-supplied original:
`34 Wolfbox air duster - body - ON Pocketry sheet - 20260903_060015.jpg`.
SHA-256: `613d60ac92db52c7ef31db5acaf46b1c59d65434d259a4677a2780278f97b3aa`.
The original remains outside the repository; its identity also appears in the
[release capture plan](../../client/public/reports/outline-1.9-to-1.10/capture-plan.json).

Open the original file, wait for marker detection, accept **Correct perspective
& use scale**, draw the region, wait for automatic cleanup, and choose **Edit
outline**. The capture shows the points before the first manual edit. The
saved settings were Tool edges, Sensitivity Auto, Simplification 1.2 px,
smoothing 1, holes off, Editable curves off, and Margin zero.

Corrected image: **1008 × 1346 px**, scale **0.250 mm/px**. The selected region,
read from the rendered region rectangle, is `(351.9500, 365.3251)` with width
`444.7475` and height `694.4302` working pixels. The UI reports one contour with
**173 points**. The photo uses a still-supported **v2** sheet; current v3 downloads
keep those markers and dimensions and update photography guidance.

## Original physical evidence

- `printed-bin-loaded.jpg` and `printed-bin-pocket.jpg` show the original Wolfbox
  print. Their sample counterparts and source records are in the
  [Wolfbox example](../../samples/wolfbox-mf70-airduster-kit/README.md) and
  [sample provenance manifest](../../samples/source-files.json).
- `fit-check-slicer.jpg` is the original Bambu Studio fit-check screenshot with
  **1.2 mm** model thickness. It is retained as historical evidence; current
  instructions recommend **0.6–0.8 mm**. It is not a screenshot of a current
  Pocketry control or a new slicer qualification.

When refreshing images, follow the original-photo workflow in
[CLAUDE.md](../../CLAUDE.md#photo-outline-regression-testing), record the source
hash and actual controls/settings, and update the adjacent tutorial caption.
Keep old physical evidence distinguishable from new software screenshots.
