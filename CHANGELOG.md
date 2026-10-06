# Changelog

## Unreleased

- New desktop sessions use Workflow + properties; saved choices and compact phone defaults are preserved.
- Consistent toolbars, compact phone adjustments, and tablet panels that preserve canvas space through landscape and keyboard changes.
- Live numeric previews with complete Escape rollback and clearer invalid-value handling; cancelled touch gestures restore the complete edit.
- Standard multi-selection and arrangement; matching text Move/Rotate controls in Layout and 3D.
- Persistent experimental opt-in, protected linked designs, and easier draft saving to Library.
- Larger touch handles, exact pocket dimensions, and fit-test exports in the mobile export panel.
- Responsive 3D Move/Rotate gestures use lightweight outlines; exact selection geometry and crease edges build in a shared worker.
- Top-edge rounding follows the pocket opening at the bin surface when pockets are raised or tilted.
- Optional pocket openings: preserve the tilted opening or use vertical walls around the full top-down outline while preserving the rotated object’s underside. Keep floor thickness remains available after 3D edits and clips only the cut; raising the pocket restores the original profile. Through drop-in openings stop at the bin underside. Selection outlines stay lightweight while rounding remains visible in the bin.

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
