# Changelog

## 1.9.0 — 2026-11-11

- Default new traces to Tool edges on light sheets, with Color contrast and Automatic available. Recover more dark tool parts and suppress calibration-sheet printing while protecting thin features and gaps; retain uncertain shadows for review.
- Automatically clean detected outlines into lines and rounded sections. Auto simplify works from the current outline, including manual edits, with consistent detail presets, visual comparison and undoable Apply. Mark applied or ineffective levels with compact indicators and hover hints. Put sensitivity and point simplification under Manual detection settings.
- Correct detection with tool/paper strokes and sample original-photo detail after perspective correction. Preserve correction strokes in draft recovery.
- Add optional editable curves, section repair, symmetry and straightening in Trace and Bin. Preserve curves, calibration and outline edits through Undo, recovery and transfer to Bin; export native SVG curves and sampled DXF/mesh outlines.
- Restart outline detection or switch methods with confirmation, resetting detection tuning while keeping the photo, calibration and selected region. Restore matching outlines and detection settings together with Undo.

## 1.8.3 — 2026-11-05

- Describe wall conflicts correctly for raised or lowered pockets without tilt, and show one authoritative wall error instead of a duplicate layout warning. Invalid wall cuts still block export.

## 1.8.2 — 2026-11-05

- Place linked pocket copies in nearby clear space, avoiding existing pockets, finger access, and surface labels instead of stepping them out of the bin. If no clear position is found, keep the copy on its source and explain how to move it.

## 1.8.1 — 2026-11-05

- Keep a visible placement guide in Layout while raised or tilted pocket outlines update, with progress and unavailable-outline messages.

## 1.8.0 — 2026-11-05

- Warn when surface text or hardware-symbol strokes may disappear with a typical 0.4 mm nozzle. Select the affected label from the warning to adjust its font or size; exports remain available.

## 1.7.3 — 2026-11-05

- Add Bambu 3MF color compatibility and a Prusa color preview 3MF that automatically sets up filament slots and colors in PrusaSlicer 2.9.7 and 3.0 alpha12/alpha13. The Prusa preview loads a temporary printer setup; choose the actual printer before printing. Regular multi-color export retains separate named parts.

## 1.7.2 — 2026-11-05

- Fix "Raise the pocket" errors after moving an experimental group or rotating pockets about Z. Moving or turning pockets no longer changes their depth or elevation.

## 1.7.1 — 2026-11-05

- A label that doesn't fit no longer blanks the 3D preview: the bin still previews, the label is outlined in Layout and listed with a link to place it, and export waits until it is fixed. New text starts in a clear spot instead of over a pocket, and on lipped bins clear of the stacking lip's overhang.
- Labels on sub-bin tabs follow their sub-bin when you change rows, columns or bin size. Labels whose tab disappears stay flagged until you restore that tab or move them, including after reopening a saved project. Fix the invisible "Retry preview" button.

## 1.7.0 — 2026-11-05

- Choose independent label-background colors, with adjustable material thickness, in the preview and multicolor 3MF exports. Existing labels keep their body color.
- Automatically refine photo outlines with guarded, mask-seeded GrabCut in a cancellable worker. Preserve detected recesses, thin features and holes, and retain the original outline when refinement is unreliable.

## 1.6.1 — 2026-11-05

- Warn before multi-color 3MF export about the Bambu Studio 2.9.1.70 color-import issue, with a link to the fix in progress.

## 1.6.0 — 2026-11-05

- Add hollow-bin compartments, dividers, scoop bottoms, and rounded floor edges, with optional divider-top coloring.
- Add adjustable, recessed label tabs with front rims, raised text, and 18 hardware symbols from [GFLabel](https://github.com/ndevenish/gflabel), including support for slanted compartments and multicolor export.
- Support taller bins up to 60U, automatic wall thickness, and experimental slanted walls with single-wall tilts and support wedges.
- Add Wham Bam Systems ULTIM8-compatible fixtures with arbitrary millimeter dimensions, configurable peg bottoms, and 1:1 SVG alignment layouts.
- Add manually drawn Trace contours and preserve photo layouts as separate editable pockets and holes.  This can be used to add multi-level pockets for things like a belt clip on a tape measure (example print forthcoming).
- Experimental groups move and rotate objects together while geometry-linked copies keep independent positions.
- Improve tilted-pocket geometry and insertion clearance, plus floor/interior coloring in previews and multicolor 3MF exports.

## 1.5.1 — 2026-10-16

- Reject oversized project/library backups and excessive geometry before processing; preserve existing work on rejected imports. Prevent repeated portable fonts from multiplying validation, history, and preview memory use.
- Check photo dimensions before decoding, including recovered Trace photos; accept still images up to 50 megapixels.
- Remove the remaining vulnerable Tailwind dependency chains. Styling now requires Safari 16.4+, Chrome/Edge 111+, or Firefox 128+.
- Remove unused database/session/authentication dependencies and update the Express, Vite, and Vitest security dependency chains.
- Add Docker self-hosting with a static web server and instructions for browser-local storage, backups, and upgrades.

## 1.5.0 — 2026-10-16

- Clearer photo-to-bin onboarding, workspace shortcuts, calibration downloads, and in-app sample project/library import with save protection. Surface text and its font, color, placement, and editing controls are available by default.
- Improved Trace straightening and symmetry controls, photo/contour alignment, preview zoom, and perspective correction using original pixels up to six megapixels. Keep the full photo visible after correction, with direct contour editing and Start over controls.
- Add traced tools to Bin before choosing Fixed depth, To Floor, or Through beside each pocket; printable export waits for all depths. Preserve choices through recovery, respect the bin base, and show export blockers with links to their controls.
- Preserve native rounded geometry and material partitions in STL/3MF export. Allow overlapping pockets with warnings, including tilted and below-surface intersections. Save project colors and copy exact colors between features.
- Keep project identity, destination, save status, and recovery downloads visible. Protect unnamed drafts, stale edits from other tabs, queued-tool destinations, unreadable/newer library entries, and failed saves. Use project/library export for backups.
- Safer Trace selection, undo/redo, ruler replacement, and destructive-edit confirmation, with clearer photo-upload and empty-detection errors. Improve desktop workflow panels and collapsed rails, mobile move/rotate controls, pinch navigation, and mouse/pen panning.
- Expand the sample library to 16 designs with Bessey/Gerber projects, print photos, and grouped downloads; add editable photo-matched labels to six projects. Refresh Help, screenshots, Gridfinity attribution, and flat-bottom/jig/Through-pocket guidance.
- Restrict development hosting to loopback, restore Vite Host/filesystem checks, and block Vite's desktop-editor launch endpoint, including dot-segment bypasses. Pocketry's Trace/Bin editors and production hosting remain unchanged.
- Remove the unused server image API, upload parsing, and image storage; projects and traces remain browser-local.

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
