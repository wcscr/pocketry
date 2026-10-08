# Optional silhouette-pocket insertion clearance

**Clear insertion path** and its direction selector appear at the top of pocket
properties when a pocket is tilted. A first tilt enables clearance using
**Follow pocket angle**, from either numeric properties or 3D Rotate. Further
pose edits retain the selected direction or disabled state. Saved projects retain
their explicit choices. Resetting to the X–Y plane hides the controls.

The two opening directions are:

- **Follow pocket angle** clears every upward translation of the original
  object along its tilted axis, including when the object is entirely submerged.
  It retains the seated object and extends the path through the fill surface.
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

Project schema 35 also retains source depth for Through; version 34 introduced minimum-floor source depth and version 33 introduced
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

Through retains the original finite extrusion, pose and rounding. It allows the
seat to reach the true bin underside (Z=0); translation stops there, and rotation
never places any part of the original object below it. It does not create an
infinite tilted shaft. Pure Z moves leave every source X/Y coordinate unchanged;
vertical clearance is regenerated from that moved object. Raising the complete
object above the fill removes its cut. Selection wires show the finite original
object and move with it, independently of the opening at the bin surface.

Older rigid Through pockets recover their last finite depth from saved history
or their creation reference. If neither contains a finite depth, the current fill
height supplies a finite default, frozen on migration. Linked copies, split seats,
Undo and later bin resizing retain that recovered depth.

The source and its rotated underside may extend above the fill surface. The
opening follows the cavity's intersection with the bin, even when only part of
the object's footprint reaches the surface. This is valid in both the preview
and export; the seat keeps its authored slope. This also applies to older
surface-anchored pockets saved without a rigid elevation. Wall, stacking-rim,
minimum-floor, positive-depth and insertion-axis checks still apply.

Floor colors use the same native-solid partitioning and printable-mesh export
boundary as other pockets; see [geometry export integrity](geometry-export-integrity.md).

Full exact geometry remains in workers. Selection and Move/Rotate outlines use
lightweight source wires without rounded mesh edges; rounding remains visible in
the rendered bin. Packing reserves the source and insertion envelope. An invalid
horizontal axial path remains recoverable through **Use vertical drop-in** and Undo.

## Verification

Tests compare hundreds of independently ray-measured seat heights against the
actual rotated source at preview and export quality, including compound tilt,
mirroring, holes, split seats, horizontal and inverted poses. They also check
continuous translated-object clearance in both directions, fully submerged
compound and inverted objects, full projections and finite disabled cavities.
Worker regressions verify closed colored STL/3MF exports for submerged pockets
and seats crossing the fill surface, including rounded edges, stacking lips,
lowered fill and split depths. Steep, compound, inverted and mirrored split
regressions read serialized 3MF coordinates back and check indexed topology,
volume, sampled boundaries and material occupancy against the native bin.
These checks do not reconstruct rounded export meshes in the geometry kernel.
Minimum-floor regressions lower, raise and lower the same pocket while
checking source preservation, independent split limits and save/history/reference
round trips. Worker tests check closed, nondegenerate STL/3MF meshes and floor-color
volumes, including clipped floors. UI tests preserve the floor mode through tilt,
elevation and Undo; browser checks exercise the restored depth-mode option.
Through-pocket regressions check compound and inverted tilt, unchanged X/Y during
Z moves, translated seat heights, the underside movement limit, independent split
seats, source recovery through saved history and closed STL/3MF exports with both
flat and Gridfinity bases.

Physical insertion fit remains unqualified. Verification runs locally under Node
22; GitHub Actions remains disabled.
