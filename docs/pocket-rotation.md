# Pocket rotation and elevation

Every generated pocket supports unrestricted XYZ rotation in **Position & rotation**
and in the 3D object controls. There is no profile-bottom mode, edge selector, or
lock-depth switch. X/Y rotation accepts sideways and upside-down orientations;
the existing Rotation control sets Z heading.

**Depth** is the extrusion distance normal to the original outline. It becomes
thickness when the pocket is turned sideways. Clearance, corner rounding,
top/bottom fillets, scaling, mirroring and split depths define the source solid
before rotation. A through cut extends along the rotated source axis through the
bin. Each split section retains its own depth.

**Elevation** is the lowest point above the bin underside. Raising or lowering
moves the whole solid without changing its dimensions, and it can move completely
above the fill. A submerged solid leaves an enclosed cavity. The surface opening
is only the solid's intersection with the fill surface. Layout and SVG/DXF export
use that same section; the full projected solid remains available for selection.

Fill-height depth adjustment continues to work for surface-anchored pockets.
Once a pocket uses 3D placement, fill edits and the adjustment checkbox preserve
its source dimensions and elevation, including sideways and inverted poses.

**Reset to X–Y plane** clears X/Y rotation. It preserves Z heading, XY position,
elevation and every source dimension, and is undoable. Reset before editing a
contour or drawing a split in Layout. Source dimensions and split depths remain
editable at any orientation.

**Inspect this pocket in 3D** cuts the preview through the pocket's center. Use
**Cut axis X/Y** to choose the inspection direction. Leaving the pocket selection
or its properties restores the full bin, as does switching to Layout. The general
cross-section controls under Check fit remain independent of pocket selection.
Inspection changes neither the saved design nor exported geometry.
Pocket outlines are hidden by default while inspecting, leaving the cutout visible
in the bin. Enable **Show pocket outline** in the section-view toolbar to see the
source outline again. Normal editing restores pocket outlines automatically.

Untouched older pockets preserve their existing geometry. Starting a rigid edit
resolves their current depth into a fixed source dimension, including each split
section independently. Elevation belongs to each placement; optional linked X/Y
rotation still applies to linked copies. Saved-project schema 26 converts the
profile prototype's centered extrusion, edge rotation, history and creation
references into equivalent ordinary pockets.

Preview and STL/3MF export share the cavity builder, including floor-color
material. A surface fit test checks the current opening; a tool fit template
checks the original outline. These checks do not establish physical fit.

## Shared placement path for future model import

`shared/gridfinity/object-pose.ts` defines source-independent XYZ rotation,
elevation anchoring and plane sections. `client/src/lib/gridfinity/object-cavity.ts`
accepts a native Manifold solid in its authored frame, applies the rigid pose,
and clips it without extending its shadow to the surface.

Generated pockets first build their source geometry, then pass that solid to the
shared placement path. A future importer can supply an arbitrary 3D solid to the
same path; extrusion depth remains a generated-pocket property. Import, mesh
repair and model-specific editing are separate features. A tetrahedron regression
exercises this placement path independently of an outline extrusion.
