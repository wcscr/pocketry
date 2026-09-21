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
pocket also shows a dashed conservative envelope of its shaft. The 3D arrow
points along the removal direction. Fit and arrange account for the shaft as
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

## Implementation

The shared transform is `Rz * Ry * Rx`, applied after outline scaling and mirroring.
The oblique section at the fill surface is used consistently for placement,
selection, resizing and contour edits. The geometry kernel constructs the shaft,
seats and floor bands in the pocket frame, then rotates them into the bin frame.
Legacy placements without tilt use the existing geometry path. Project schema
20 adds optional `tilt: { xDeg, yDeg }`; version 19 and older saves migrate without
introducing angles. Each input axis is limited to ±89 degrees, and the combined
axis must retain a vertical component of at least 0.01.

Regression coverage includes oblique opening dimensions, axial and remaining
floor depths, combined transforms, resize anchors, split seats, floor colors,
hidden intersections, through cuts, packing, legacy saves and export validation.
