# Tilted pockets

Select a pocket and open **Position & rotation**. X and Y tilt turn its depth
axis; the existing Z rotation sets its heading in the bin. **Reset tilt** returns
the pocket upright while keeping its heading. Each placement has its own angles,
including copied pockets, and changes survive undo, redo, saving and import.

Tilt is useful for storing tall objects in a drawer with less vertical space.
The object slides in and out along the tilted axis. The horizontal opening grows
with tilt so that this path stays clear. The outline dimensions still describe
the object's cross-section perpendicular to that axis. For example, a 3 mm wide
rectangular slot tilted 45 degrees has a nominal 4.24 mm wide top opening.

- Fixed depth is measured **along the pocket axis**, from the bin's fill surface
  at the placement centre to the seat centre.
- Remaining floor sets the **lowest point** of the sloped seat above the bin's
  underside. Positive fit clearance is included conservatively.
- Through depth continues along the tilted axis through the base.
- Split regions keep their own depths and share the same orientation.
- Bottom rounds and floor material layers follow the seat; top rounds are added
  at the actual horizontal opening. Finger access stays in the bin's frame.

The depth summary shows axial depth, actual vertical depth, lowest floor and
combined axis tilt. The 2D layout shows the nominal top opening; the selected
pocket also shows a dashed conservative envelope of its shaft. The 3D view
shows the selected opening and seat as a wireframe. Fit and arrange account for the shaft as
well as the opening. They can leave extra space around complicated outlines.

Preview and printable export check actual pocket solids for hidden pocket
intersections and cuts into walls, label tabs and stacking rims. Export rechecks
the current design. Shafts with less than 1.2 mm of material between them or
beside a wall produce a warning. A floor that crosses the opening, or a combined axis too
close to horizontal, must be corrected. These checks do not model the complete
stored object, attached cables or the space above the bin.

SVG/DXF layout exports describe nominal horizontal top openings, without fit
clearance or rounding. They cannot encode tilted depth. A surface fit template
is a thin section of the actual cavity and checks that section only; print a
small bin with the full slot depth to assess insertion and retention.

## Move and rotate in 3D

Click a pocket opening or choose it from the 3D pocket selector. **Move (W)**
shows red X, green Y and blue Z arrows. X/Y move the opening across the surface;
Z changes depth beneath it. Plane handles combine their named axes.
**Rotate (E)** shows only X/Y/Z axis rings. All handles stay aligned with the
bin's fixed XYZ coordinate system, even when the pocket is tilted. There is
no local-axis mode or free/view-plane rotation target.

The **magnet** toggles 1 mm move increments and 5° rotation increments. Its
tooltip describes the increments and whether snapping is on or off. For combined rotations, the displayed Euler
angles may differ from the snapped rotation about a fixed bin axis.

Each drag previews the opening and seat immediately, rebuilds the solid on
release, and adds one undo step. **Escape** cancels the active drag. Camera
orbit is suspended while dragging a handle; drag empty space to orbit normally.
The ruler temporarily hides the transform handles. Keyboard shortcuts leave
text and number fields alone.

Pulling Z up makes the pocket shallower; pulling down makes it deeper. Both
the opening and the handles stay at the bin surface throughout the drag.
Fixed axial depth or remaining-floor thickness updates directly, with the
same vertical depth change applied to both split seats. Movement stops with
at least 0.5 mm below the surface above the highest seat, and before the lowest
seat passes the underside. A through pocket has no floor to adjust. Its Z
drag has no effect. Use the existing Depth fields for exact dimensions.

Older saved Z offsets remain readable. On editing, the offset is converted to
an equivalent surface position and depth, preserving the existing cavity.
New drags never store an above-surface pocket position.

A gizmo rotation keeps the seat geometry rigid around the anchor. Remaining-floor
settings convert to equivalent fixed axial depths at the start of a completed
rotation, including both seats in a split pocket. Numeric tilt controls continue
to honor remaining-floor mode. Check the resulting floor, wall and intersection
warnings after rotating or lowering a pocket. Undo restores both orientation
and the original depth mode.

## Implementation

The shared transform is `Rz * Ry * Rx`, applied after outline scaling and mirroring.
The oblique section at the fill surface is used consistently for placement,
selection, resizing and contour edits. The geometry kernel constructs the shaft,
seats and floor bands in the pocket frame, then rotates them into the bin frame.
Legacy placements without tilt or Z translation use the existing geometry path.
Project schema 20 added optional `tilt: { xDeg, yDeg }`; schema 21 adds optional
`zOffsetMm`, including history snapshots. Older saves migrate without introducing
angles or offsets. Each input axis is limited to ±89 degrees, and the combined
axis must retain a vertical component of at least 0.01.

Regression coverage includes oblique opening dimensions, axial and remaining
floor depths, combined transforms, resize anchors, split seats, floor colors,
hidden intersections, through cuts, packing, legacy saves and export validation.
