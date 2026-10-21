# Changelog

## Unreleased

- Experimental: group pockets and holes to move and rotate around one stable center, with independent duplication, ungrouping, and saved history. Geometry links share dimensions while each copy keeps its own position and rotation.
- Preserve groups during footprint edits and bin fitting, keep moves within shared height limits, and keep legacy linked projects editable and saveable.

- Group tilted-pocket insertion settings in a collapsible Insertion path section.
- Give the welcome and initial Trace screens three equal-sized choices: Trace a Photo, Design a Bin, and Open Sample Projects. Keep photo and scale guidance in expandable tips.
- Show project identity once, keep rename and save recovery available, and add New project beside the current project on Trace. Shorten the tracing instructions.
- Label ULTIM8™ consistently and link mentions to Wham Bam Systems.
- Add hollow-bin rows and columns, adjustable 1.2 mm dividers, scoop bottoms facing the obtuse angle, and per-compartment label tabs under Construction. Dividers and scoops follow slanted walls and are included in STL/3MF exports. Rim coloring can optionally include divider tops. New label tabs default to the acute-angle side; Construction uses integrated feature switches and collapsible settings, including label tabs.

- Fix Wham Bam Systems ULTIM8-compatible peg density around through openings: denser settings retain existing peg positions and fill gaps instead of skipping surviving edge rows.

- Added `/ultim8` to start 100 × 60 × 5 mm Wham Bam Systems ULTIM8-compatible fixtures safely, with jig controls, a Trace starting point, and alignment exports available without enabling Experimental.

- Allow bins up to 60U (420 mm before the stacking lip), with matching desktop, mobile, and millimetre height controls.
- Hollow bins follow Gridfinity Extended wall defaults: 0.95 mm below 8U, 1.2 mm from 8U to below 16U, and 1.6 mm at 16U and above. Legacy 0.95 mm defaults now follow height too. Edit thickness directly to keep a custom value, with a warning below the recommendation. Wall controls no longer require Experimental.
- Restore Gridfinity feet after Arbitrary sizing only when the flat bottom was applied automatically; preserve explicit Flat bottom and Wham Bam Systems ULTIM8-compatible choices, including across saving and undo/redo.

- Prevent a flat ledge where tilted pockets exit the top surface. Keep pocket color below the rounded entry in previews and multi-color exports.

- Offer Auto-arrange beside oversized-bin warnings, explaining layout changes and preserving fixed sizes; fix arranging arbitrary-sized bins with multiple retained grid cells.

- Simplify App settings with a bulleted experimental-feature list and shorter explanations.
- Allow wall slants up to 89°. Inward walls can meet the vertical wall below the requested height to form a support wedge, with a warning and printable export.
- Fixed side mirroring in Symmetry & straighten for syringe grips and other concave outlines; averaging now explains when to choose a side.

- Preserve unresolved pocket-depth drafts while switching pockets or reopening the prompt, and link depth-limit warnings directly to bin height controls. Explain tool exposure and show Through pockets with an open bottom.

- Add another Trace contour as an editable four-point square without changing zoom or pan, with point insertion, undo/redo, and saved-project recovery.
- Show the no-cutouts export warning only when Solid fill is enabled, with the actual fill height. Hollow bins can export without the misleading solid-bin warning.
- Remove the Trace grouping checkbox. Adding to Bin and exporting an editable project always preserve each pocket and hole as a separate object at its photo-relative position, including nested and overlapping pockets.

- Choose floor-only or entire-interior coloring per pocket, with an independent bin or object-axis reference. New pockets follow their insertion axis; saved projects retain existing coloring.
- Prevent microscopic mesh seams from creating exaggerated folds in the shading of tilted pocket floors, without changing printable geometry.
- Keep object-axis floor coloring off parallel faces and remaining-floor clipping surfaces; remove coincident color sheets that flicker while orbiting. Color-only edits now replace the complete preview once, preserving rounded edges throughout the update.
- Allow tilted pockets to protrude above the bin. Vertical insertion validation now checks for collisions with actual bin material instead of requiring an opening under the entire object.
- Confirm fixed depth or to-floor depth alongside insertion clearance after the first 3D tilt, and again if the chosen insertion axis becomes invalid. Split sections retain separate depth choices.
- Keep steep traced walls and rounded-edge risers out of object-axis floor coloring, including objects rotated exactly 90°. Pocket color settings now show an expand/collapse chevron.
- Keep vertical drop-in walls bin-colored in Floor only mode, including shallow tilted pockets and linked copies.

- Undo and redo restore colors changed by jig setup. Arbitrary sizes show their fixed dimensions clearly, explain arrangement overflow, and display readable millimetre values without rounding saved geometry.

- Right-click pockets, finger access, surface text, and traced contours for applicable object actions. Menus preserve multi-selection and keep linking optional. In Trace and Bin contour editing, right-click a point to remove it immediately, with undo/redo support. Rename dialogs and history distinguish retained-material holes from pockets.

- Fix linking insertion paths to ordinary pockets so projects reopen correctly. Keep optional linking controls collapsed, show shared-edit scope for existing links, and allow Link management from one linked copy.

- Default new pockets without a chosen depth to the bin floor so they appear immediately in the 3D preview.
- Wham Bam Systems ULTIM8-compatible mode exports a 1:1 jig layout SVG with the bin outline, actual pocket openings, finger access, and retained peg locations for alignment to a calibrated mat template.

- Trace workflow puts Add to Bin and Export Tool Outline together in step 6, with SVG/DXF/STL choices in the download dialog and a separate Start Over step. Compact and mobile panels have a prominent Back to Canvas button.

- Added arbitrary rectangular bin sizes in millimetres, including height, for flat bottoms and Wham Bam Systems ULTIM8-compatible pegs; the grid selector marks Arbitrary as non-Gridfinity. Bin size shows dimensions above grid options.
- Added Experimental Wham Bam Systems ULTIM8-compatible jig peg bottoms with adjustable fit, sloped/bridged roots, and flat backing (the default, exported pegs up). Flat backing defaults to corner-only pegs and supports denser spacing; through openings omit overlapping pegs.
- Grouped peg settings with floating help hints. Switching to Wham Bam Systems ULTIM8-compatible pegs offers to remove the stacking lip, set Solid fill to 100%, switch rectangular bins to Arbitrary sizing, and use one color. The setup dialog offers body thickness, prefilled from the current height, with depth-conflict checks.
- Surface pockets set to Through open the full bin bottom, including peg roots, when overlapping finger access.
- Failed 3D updates clear obsolete bin meshes so they cannot appear beside the current pocket outline as misplaced duplicates.
- Choose object X, Y, or Z for pocket insertion clearance. The first 3D tilt prompts for clearance style and axis, with another prompt if a later rotation makes that axis invalid.
- Fix distorted tilted cutouts and striped floor colors for complex traces, and speed up full-detail exports along the pocket axis.
- Add experimental one-axis slanted bin walls above a fixed Gridfinity base, with X/Y angle controls, a shifted rim outline, and a shortcut to match a selected tilted pocket. Choose both opposing walls or tilt one while keeping the other vertical. Export checks pocket collisions against the actual walls.
- Allow label tabs on slanted bin walls, including shifted pocket-shadow warnings.
- Keep short slanted label tabs above the base and prevent preview flicker along their colored rim band.
- Link to Form Fit Print from About and credit the slanted-gridfinity project for inspiring slanted bin walls.
- Preserve the relative positions of outlines sent from Trace to Bin, including overlaps. Choose Pocket or Hole to cut or keep material; holes remain independent, editable objects in Bin and saved projects.
- Preserve separate pockets and shared holes through Trace margin/detail edits; list each shared hole once. Match hole selection to the visible drawing order and clarify hole offset, kept depth, and linked-copy behavior.
- Block printable export of floating caps or detached material created by hole objects; hole depths no longer change finger-access defaults.
- Ignore recognized measurement aids when tracing; keep estimated edges highlighted with persistent guidance and a zoom-to-area action.
- Use a small hollow crosshair in the contour magnifier so vertex handles no longer cover the placement point.

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
