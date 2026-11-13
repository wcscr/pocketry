# Pocket selection, transforms, and linked designs

Pocket placement, XYZ rotation/elevation, multi-selection, alignment, and
independent duplication are available by default. Linking and grouping require
**App settings → Enable experimental features**. Saved designs remain visible
and exportable with that preference off; opening a project never enables it.
Shared geometry edits and Group/Ungroup require opting back in.

## Rotation, elevation, and depth

A pocket has a finite source solid and a rigid pose. Depth describes the source's
extrusion thickness, not an instruction to stretch it back to the fill surface
after every move. Z movement changes elevation without changing the source
shape. Sideways, inverted, partly exposed, and submerged poses are supported,
subject to geometry and export validation.

Use **Position & rotation** or the 3D object controls. **Reset to X–Y plane**
clears X/Y rotation while preserving heading, position, elevation, and source
dimensions. Reset before contour or split editing in Layout.
See [rotation and elevation](pocket-rotation.md) for the model and migration rules.

Insertion clearance is a separate choice under **Insertion path**. It can follow
an object axis, use vertical drop-in, or be disabled. Poses do not by themselves
prove a tool can enter or leave its cavity. See [insertion paths](pocket-insertion-paths.md)
for finite Through behavior, floor limits, and validation against actual bin
material. Fit checks, model validation, and physical insertion are separate checks.

## Selection and editing

Use object selection or the list to select a pocket; Shift/Command/Control-click
adds or removes objects. Selection carries between Layout and 3D. Move and Rotate
operate on the current selection, and committed gestures produce one undo step.
Escape or pointer cancellation discards an unfinished gesture. Text and number
fields retain their normal editing shortcuts.

Object controls offer Move, Rotate, Arrange, and, when experimental editing is
enabled, Links. Shared properties show mixed values where selected objects
differ. Finger access remains upright; mixed-object transformations respect the
supported axes and shared movement limits. Grouping gives selected objects a
persistent common pivot; an ordinary temporary multi-selection is not a saved
group. Arrangement changes placements, not source geometry.

Right-click an object in Layout, 3D, or its list for applicable properties,
duplicate, rename, and removal actions. A selected member retains the current
multi-selection. Ordinary duplication creates independent copies. Retained-material
hole objects from Trace remain separate editable objects; embedded interior rings
are part of their source outline. Contour editing removes a vertex on right-click,
with undo/redo and a minimum of three points.

## Linked designs

Linked pockets share source geometry and editing properties such as dimensions,
depth, split settings, clearance, and edge rounding. Each placement retains its
own name, position, elevation, orientation, and placement-specific material
choices. Linked finger access shares geometry while keeping its own placement.
Unlink before changing geometry for just one copy.

Duplicate linked searches nearby space inside the current bin without moving
existing pockets or changing the copy’s size or orientation. The search uses
conservative bounds including clearance, rounding, separate finger access, and
existing text or symbol labels on the bin surface.
If no clear position is found (including slanted-wall bins), the copy stays on
its source and a message explains that it needs moving or a larger bin. Exact
3D validation remains authoritative.

The Links tool can manage a selected linked copy; linking existing objects
requires a compatible selection. Existing links show the shared-edit scope.
Individual placement edits must not leak into other copies, and a rejected shared
edit must not partially update a set. Grouping and geometry linking are separate:
a group moves together, while a design link shares geometry.

## Source and verification

The current placement schema is in [cutout.ts](../shared/gridfinity/cutout.ts),
with shared pose math in [object-pose.ts](../shared/gridfinity/object-pose.ts),
transaction/history behavior in [bin-store.tsx](../client/src/state/bin-store.tsx),
and object controls in [object-transform-panel.tsx](../client/src/components/gridfinity/object-transform-panel.tsx).
Use the local workflow and geometry qualifications in [CLAUDE.md](../CLAUDE.md).
Track enhancement requests and problem reports in [GitHub issues](https://github.com/wcscr/pocketry/issues).
