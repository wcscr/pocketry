# Changelog

## Unreleased

- Added raised surface text behind the experimental-features opt-in, with five built-in font choices, position, size, rotation, height, and one project-wide color that defaults to the edge band. 3MF keeps each label as a separate named part for slicer editing, with the shared text color in multi-color exports; STL joins it to the bin.
- Surface text now has an instance list and Add button in the left workflow panel, selected-label properties on the right, and an entry in the toolbar Add menu. Click anywhere within a label’s bounds in Layout or 3D to open its properties, and double-click their list names to rename them independently of the printed wording. Drag the Layout rotation handle or use Move and Rotate in 3D; double-click a label in Layout to edit its wording. Text color lives in Materials & Colors, and new labels default to Helvetiker. All text editing remains behind experimental opt-in.
- Surface text can use installed system fonts in supported browsers. Selected font data travels with the project so labels remain editable and exportable on other computers. One searchable font dropdown keeps built-ins first and hides system fonts that cannot render the current wording. Built-in choices are Sans, Sans Bold, Helvetiker, Helvetiker Bold, and Monospace.
- Fixed complex-font preview failures, lost wording edits when switching labels, and text selection after contour editing. Text supports keyboard controls, undoable 3D deletion, and mobile preview editing without a blocking drawer. Footprint edits keep text and finger access aligned with pockets; both Layout toolbars include the shared Add menu. Original UI experimental controls respect opt-out.
- Saved system-font sources are shared across labels and undo steps, preventing oversized project backups and export failures. Canceling a pending font selection now reliably keeps the chosen font.
- Adding text opens Layout for positioning. Labels stay draggable above pockets, with a direct placement action when text prevents the 3D preview from building.

- Experimental: hollow bins support adjustable wall thickness from 0.95 to 3 mm, retaining the outside dimensions and stacking fit. Enable experimental features in Settings to adjust it.
- Added a help hint beside bin dimensions explaining height units and Gridfinity Rebuilt's rounded stacking lip.
- Fixed pocket property drafts carrying over to another pocket; selection changes preserve pending edits in saved state and undo history.

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
