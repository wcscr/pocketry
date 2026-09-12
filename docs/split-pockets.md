# Split pockets

A tool can have a thin blade and a thick handle. Trace the complete silhouette,
add it to the bin as one pocket, and select **Split pocket** beside its depth
controls. In Layout, click two points on the outer edge or drag from edge to edge.
The straight boundary must divide the silhouette into two connected sections.

Both sections initially inherit the pocket depth. Choose **Section A** or
**Section B**, or click that part of the pocket in Layout, and use the usual fixed
depth, remaining-floor, or through controls. All depths start at the same infill
top; they are not cumulative. Different depths make a step, with no dividing
wall. Equal depths give the same geometry as an unsplit pocket.

To check a split's distance from the tool perimeter, turn on the ruler and click
near the split, then near the perimeter. Endpoints snap anywhere along either
line, including between vertices. Layout and 3D measure the planar XY distance
in millimetres; the 3D ruler shows a dashed split guide on the top plane. Pocket
rotation, mirroring, and scale are included in the measurement.

The pocket retains one position, rotation, scale, clearance, and set of edge
settings. Move, resize, mirror, duplicate, fit, and auto-arrange work on the whole
tool. Top rounding is limited by the shallowest section to keep the opening
continuous. Bottom rounding applies at the original perimeter; the internal
depth step remains sharp.

**Redraw split** changes the boundary while keeping the two section depths.
**Remove split** restores the original whole-pocket depth. All committed changes
support undo and redo. Escape, Cancel, and cancelled pointer gestures discard an
unfinished boundary. A rejected boundary does not alter the pocket.

The initial version supports one straight boundary and two sections. It rejects
multipart outlines, lines that cross the outer perimeter more than twice, tiny
sections, and lines through or touching interior holes. Existing holes remain in
their respective section. Editing the tool contour can invalidate a saved split;
validation asks the user to redraw it and blocks export until corrected.

## Storage and geometry

Project schema 16 adds optional `CutoutPlacement.split`, containing `boundary`
(an ordered array of shape-local vertices) and `depths` (Section A/B depth specs).
The original `depth` remains the value restored by Remove split. Section A is on
the left of the directed boundary in shape coordinates; mirroring never swaps
its settings. No derived region outlines or additional library shapes are saved.
Older documents migrate without splits. Libraries and project backups preserve
the split, including the optional editable JSON downloaded alongside 3MF/STL.

Only two boundary vertices are accepted today. The vertex-array representation
allows future boundaries with intermediate vertices without changing the one
pocket / two sections model. That extension will need polyline validation and
region masks in place of the current half-plane clipping, plus vertex editing;
it is not silently accepted or approximated as a straight line.

The existing cutter builder clears the full perimeter to the shallower depth,
then extends the deeper section using a clipped cutter. This avoids opposing
cut faces that can leave a nearly zero-thickness seam sheet due to numerical
rounding. Equal depths use a single unsplit cutter. Floor-color inserts remain
clipped to their own sections. Rounding occurs before clipping so the internal
boundary is never rounded as an external wall. Validation and canvas shading
share the same boundary resolver. STL/3MF contain the resulting stepped solid;
SVG/DXF remain top-down outline templates and do not encode pocket depths.

Tests cover partition area/winding, holes, invalid boundaries, migration,
section depth checks, click/drag creation, canvas selection, editing, cancelling,
removal/undo, placement, duplication, auto-arrange, equal-depth seam equivalence,
transformed section identity, through sections, and nonoverlapping floor colors.
