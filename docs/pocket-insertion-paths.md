# Optional silhouette-pocket insertion clearance

Pocket properties → Position & rotation → **Clear insertion path** opts a
silhouette pocket into one of two opening directions:

- **Follow pocket angle** keeps the original authored tilted cavity and its
  surface intersection. Its geometry matches the existing angled opening.
- **Vertical drop-in** clears the object's complete XY projection straight up
  while retaining its actual rotated underside as the seat. A side face that
  points downward after rotation is part of that seat too. No bottom plane is
  extended across the footprint and no lowest-point plateau is added.

Both preserve the authored pose, extrusion depth and lowest-point elevation.
Disabling clearance retains the original finite cavity. Linked designs share the
choice while keeping individual poses. The common properties component serves
both editor layouts.

## Minimum floor thickness

**Keep floor thickness** remains available after rotation, elevation edits and
insertion-mode changes. It clips the generated cut at the chosen bin-space floor
height; the original source solid and extrusion depth remain intact. Raising the
pocket restores the clipped portion of its profile. Fixed-depth pockets receive
no such floor clipping. Split sections retain their individual depth modes and
floor limits.

Entering a rigid edit freezes each remaining-floor section's current extrusion
length in `depth.sourceDepthMm` while retaining its floor constraint. Switching a
rigid pocket from fixed depth to remaining floor preserves the same length;
editing the floor limit or switching back to fixed depth does not resize it.
Source wires show the full original shape even when the cut is floor-limited.

Project schema 34 stores this optional source length; version 33 introduced
`insertionMode`. Earlier projects migrate without activating clearance or rewriting
existing shapes. Undo/redo, creation references and Library saves retain the source
length and floor limit. Imported-model PR #118 remains separate.

## Geometry and responsiveness

Vertical drop-in continuously sweeps each downward-facing source triangle upward.
The resulting lower surface is the object's underside at each XY point, preserving
slopes, steps, concavities and holes. A 0.001 mm lateral facet overlap prevents
coincident Float32 seams in exports. Clipping that overlap to the object's
projection preserves the outside perimeter. Projection cleanup at 0.0001 mm
removes numerical slivers from edge-on rounded faces. No whole-object convex hull
or whole-solid Minkowski operation is used.

Floor limits apply after the sweep, independently for each split section, and
never modify the source. Top rounding is applied at the actual fill surface.
Floor colors follow the finished seat, including floor-limited cuts, and the
material parts are clipped to the finished bin.

Through sections use only the shaft between the true bin underside (Z=0) and the
fill surface when calculating a vertical drop-in opening. The long Boolean helper
below the bin must not enlarge that projection. Each split section is handled
independently, preserving finite seats. Through selection wires stop at the physical
bin, and placement checks use the bounded projection.

If the rotated underside itself reaches the bin surface and prevents a complete
opening, the preview explains how to correct the height or tilt and export is
blocked. A taller bin is required for some placements previously made to appear
valid by flattening the seat.

Full exact geometry remains in workers. Selection and Move/Rotate outlines use
lightweight source wires without rounded mesh edges; rounding remains visible in
the rendered bin. Packing reserves the source and insertion envelope. An invalid
horizontal axial path remains recoverable through **Use vertical drop-in** and Undo.

## Verification

Tests compare hundreds of independently ray-measured seat heights against the
actual rotated source at preview and export quality, including compound tilt,
mirroring, holes, split seats, horizontal and inverted poses. They also check
continuous translated-object clearance, full projections and unchanged angled
cavities. Minimum-floor regressions lower, raise and lower the same pocket while
checking source preservation, independent split limits and save/history/reference
round trips. Worker tests check closed, nondegenerate STL/3MF meshes and floor-color
volumes, including clipped floors. UI tests preserve the floor mode through tilt,
elevation and Undo; browser checks exercise the restored depth-mode option.
Through-pocket regressions check compound and inverted tilt, bin-height-dependent
footprints, independence from helper length, bounded selection wires, split seats,
and closed STL/3MF exports with both flat and Gridfinity bases.

Physical insertion fit remains unqualified. Verification runs locally under Node
22; GitHub Actions remains disabled.
