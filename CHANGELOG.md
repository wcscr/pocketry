# Changelog

## Unreleased

- Added About Gridfinity with credit and links to creator Zack Freedman. Clarified standalone flat-bottomed bin support and its Construction setting in the README, Help, and About page.

- Updated the README and How to use Pocketry for the default UI, with fresh Wolfbox tracing, layout, and ruler screenshots. Shortened the sample gallery to two thumbnails, noted that the examples have been physically printed, and kept fit notes on individual project pages.

- Made the desktop layout default clearer in App settings, with “Original Single Panel UI” available to switch back; retired preferences now use the screen's default layout.
- Mobile Select, Move, and Rotate are directly available in both layouts; tool adjustments stay beside or below the canvas, with full properties opened explicitly.
- Overlapping pockets now combine their cuts with warnings instead of blocking export, including intersections below the surface and between tilted pockets.

- Projects now save and restore their own colors and material settings. Use the copy menu beside a color to reuse the exact body, floor, rim/border, or text color on another feature.

- Grouped the individual Bessey and Gerber bin downloads under their combined example and cropped and straightened its print photo.

- Added individual and combined Bessey Utility Knife and Gerber Multitool samples with editable projects, 3MFs, layout previews, a print photo, and the Bessey affiliate link; expanded the sample library to 16 designs.

- Upright alignment rotates the photo with its contours; symmetry previews support zoom and pan.

## 1.4.0 — 2026-10-06

- Improved photo tracing for thin reflective tools, with symmetry, upright alignment, and clearer sensitivity controls.
- Faster 3D editing and corrected tilted-pocket openings, floor limits, and edge rounding.
- Refined desktop, tablet, and phone controls, selection, undo, and saving.
- Added Wiha driver examples, stacking notes, and a header feedback menu.

## 1.3.0 — 2026-10-04

- Experimental surface text with built-in and portable system fonts, easier editing, and separate label parts in 3MF exports.
- Experimental adjustable wall thickness for empty bins (0.95–3 mm).
- Added a dimensions hint explaining height units and the rounded stacking lip.
- Improved text placement, previews, and project backups; fixed pocket edits carrying over between selections.

## 1.2.0 — 2026-09-29

- Adjustable colored borders for bins without stacking lips; hollow-bin floors use the pocket-floor color. Both support multi-color 3MF export.
- Cleaner pocket outlines and improved inspection defaults.
- Longer finger-access grooves and automatic pocket-depth adjustment when changing fill height.
- Added a mini socket set example project and print photos.

## 1.1.1 — 2026-09-27

- UI cleanup and consistency updates.

- Rotate generated pockets freely on all three axes and raise or lower them without changing their dimensions. Depth sets the extrusion thickness; the surface opening follows the solid’s intersection with the fill.
- Reset pockets to their original X–Y plane while preserving Z rotation, position, elevation, and dimensions. Earlier profile prototypes migrate to ordinary pockets.
- Choose X or Y when inspecting a pocket in 3D, with pocket outlines hidden by default and an option to show them; leaving the pocket restores the full bin preview.

## 1.1.0 — 2026-09-26

- Added experimental pocket tilt, 3D move and rotate controls, multi-selection, alignment, distribution, and linked designs.
- Double-click pocket and finger-access names to rename them inline; duplicates now receive distinct copy names, including linked copies and multi-selection duplicates.
- Simplified the editor to Controls on the left (default) and Workflow left, properties right; both respect the experimental-tools toggle, which recommends Workflow when enabled.
- Clarified and left-aligned the Finger access add button; removed duplicate Properties headings and grouped depth controls and split-section selection in an initially expanded Depth section.
- Added the Wiha drivers example, showing adjustable solid fill height for stacking.

## 1.0.0 — 2026-09-26

Initial versioned baseline.

- Photo tracing, calibration, custom Gridfinity bins, fit checks, and exports.
- Adjustable solid fill height and customizable, non-rectangular bin footprints.
- Local project library, backups, undo, and sample projects.
- Faster previews and improved project recovery.
- Better Fusion DXF compatibility and calibration-marker detection.
- Added the About version number and version history.
