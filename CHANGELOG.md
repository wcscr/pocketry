# Changelog

## Unreleased

- Remove a collinear export seam that could leave a zero-area triangle in long bins, including the new screwdriver model-pocket test case.

- With experimental features enabled, import watertight STL models as shaped pockets that clear the model’s insertion path along its rotated axis, with optional vertical drop-in, independent insertion depth, XYZ scaling, rotation, adjustable fit margin, rounded storage contours and detail smoothing, and saved-project geometry. Inspection slices reuse the finished bin for faster updates. Model-pocket color linings cover steep and vertical faces without changing tool clearance.

- Simplified the 3D pocket outline to show the solid’s exterior edges and a faint surface, with no internal subdivision lines. Rotation previews retain clean contour outlines while the solid updates.
- Pocket inspection shows the outline by default with a “Hide pocket outline” option, and initially selects the pocket’s longest placed X or Y dimension as the cut axis.
- Finger-access grooves can exceed 160 mm, with length limits based on the bin dimensions, slot width, and rotation.
- Added an “Adjust fixed pocket depths” checkbox under Construction → Fill height, enabled by default, to keep existing pocket floors in place when changing solid fill height. Unchecking restores original depths; rechecking reapplies the adjustment. The setting and original depths are saved with the project.

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
