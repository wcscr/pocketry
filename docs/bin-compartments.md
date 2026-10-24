# Internal compartments

Construction shows separate Internal compartments and Scoop bottoms switches only
when Solid fill is off, in both standard and workflow layouts, including mobile.
Enabled features use a single row with a separate switch and disclosure button.
The compartment row shows its row/column count and opens Rows, Columns, and
Divider thickness beneath a subtle divider. Guidance lives in hover/tap hints. Counts describe sub-bins:
2 rows by 3 columns creates six compartments; 1 by 1 has no dividers. Rows run
along Y and columns along X. Clear compartment widths are equal, accounting for
wall and divider thickness. Dividers default to Rebuilt's 1.2 mm.

Solid fill hides these controls without discarding their settings. Turning internal
compartments off retains its counts and thickness and leaves Scoop bottoms unchanged;
the scoop then spans the undivided bin. Re-enabling restores the previous grid, or
starts with two rows for a new 1 by 1 design. Older grids remain enabled. No
Experimental opt-in is required.
Upright scoops curve from each row's front wall (-Y) into its floor. Slanted
bins automatically face scoops toward the obtuse angle: +X right, -X left,
+Y back, -Y front. Their radius is half the hollow height, capped at half the
clear compartment span along the scoop axis to preserve floor space.
Dividers and repeated tabs stop 1.2 mm below the nominal rim with a stacking
lip, matching Rebuilt's infill ceiling; flush bins use the nominal rim. Scoops and dividers
follow the body's selected slant, including a single slanted wall and clipped
closing wedges. Custom footprints clip the regular grid; missing cells can
remove or split compartments. The layout view shows divider footprints at the
floor; use the 3D preview to inspect slants and scoops.

Schema 52 retains the settings in projects, undo history, and transform origins.
Earlier projects default to 1 by 1 with scoops off. Preview, STL, and 3MF share
the same geometry builder. Existing pocket/finger cuts still remove material
from the finished bin. Label tabs can stay on the selected outer wall or repeat on each sub-bin.
The Label tab switch enables a full-width tab; its collapsed disclosure groups
Style, Apply to, and On wall. Turning it off removes the tab and exits edge picking;
undo restores the prior tab settings. New tabs use Auto:
back for upright bins, or the edge above the acute angle for slanted bins
(+X left, -X right, +Y front, -Y back), opposite the scoops. Auto follows slant
edits; choosing a wall or boundary edge keeps that explicit placement. Saved
projects without Auto retain their wall. These choices persist through saving
and undo/redo. Slanted walls, compartments, and label tabs share compact inline disclosures,
collapsed by default and independently expandable. Their rows show short value
summaries and normal foreground text. Switches, help, and disclosure buttons have
separate keyboard targets; collapsed controls are hidden from focus navigation. Wall thickness uses
a number field, with the existing recommendation and reset control.
Bottom edge fillet is an independent millimetre field, visible whenever Solid fill
is off. Zero disables it. It rounds the floor into outer walls and both sides of
dividers, retaining the entered radius through fill toggles, disabled compartments,
save/reload and undo/redo. The effective radius is limited to the hollow height
and half the clear compartment span; the control reports a limit without changing
the saved value. Scoops and fillets are combined as material, so the larger curve
governs their shared edge. Slants deform the upright fillet profile with the walls:
the radius is measured before slanting, not as a world-space circular arc. Fillets
use the bin material and leave exposed horizontal floor available for floor color.
Schema 53 adds the radius, defaulting older projects and history to zero.
The width style and wall direction apply to every tab; their depth
is capped at half the compartment to leave an opening. Custom footprints omit
shelf fragments whose mounting wall was removed. Floor colors
remain the base's thin floor layer; scoop ramps use the bin material.
Slanted label supports deepen as needed to preserve their nominal 36-degree
underside angle after deformation. Label surfaces retain their dimensions;
short supports can meet the floor, where they remain body material. A warning
identifies slants too steep to retain that angle. See [label support verification](label-tab-support.md)
for the PrusaSlicer and Bambu Studio checks and remaining print limits.

Materials & Colors offers Include dividers inside the rim/top-border color card
when hollow dividers exist. It starts off and retains its choice when dividers or
Solid fill hide it. Turning off rim coloring disables the control. When enabled,
the same rim color and depth cover each divider's full top width, including
slanted dividers. Stacking-lip dividers retain their lower clearance height;
color replaces existing material and does not add height or widen the divider.
Scoop ramps and label shelves keep their existing materials. Preview and
multi-color 3MF use the same non-overlapping regions; ordinary STL/3MF geometry
is unchanged. Saved material settings, resets, and project reloads retain the option.

Implementation checks: legacy defaults and project/history round trips; invalid
counts and insufficient space; equal clear widths; 1 by 1 unchanged geometry;
single-axis and combined grids; floor/wall attachment; custom and arbitrary
footprints; full/half/quarter pitch; both/single/closing slants; scoop curvature;
preview/export solids; multicolor partition; controls, undo/redo and fill toggles;
hidden solid-fill controls, default disclosure collapse, independent scoop use, and
retained compartment settings across toggles and project reloads.
Local type checks, quick tests, affected workflows, the complete geometry suite,
production build, and diff checks are required.
Slicer and physical-print qualification are separate follow-ups.
