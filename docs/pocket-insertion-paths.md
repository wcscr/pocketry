# Optional silhouette-pocket insertion clearance

Pocket properties → Position & rotation → **Clear insertion path** opts a
silhouette pocket into one of two opening directions:

- **Follow pocket angle** keeps the original authored tilted cavity and its
  surface intersection. Its geometry matches the existing angled opening.
- **Vertical drop-in** opens the complete object projection as seen from above,
  including portions above the fill, with vertical walls and the tilted bottom
  extended beneath the larger opening. The floor extension stops at the original
  lowest elevation. A floor reaching the surface is reported as an error.

Both preserve the authored pose, extrusion depth and lowest-point elevation.
Disabling clearance retains the original finite cavity. Enabling it on a legacy
pocket first freezes its current depth and elevation using the existing rigid-pocket
conversion. Linked designs share the direction while keeping individual poses.
The common properties component serves both editor layouts.

Project schema 33 stores the optional `insertionMode`. Earlier projects migrate
with the field absent, including undo history and transform references, so their
finite pocket geometry does not change. Undo/redo and browser Library saves retain
the choice. This brings the opening directions from PR #118 to silhouette pockets;
STL imports, model-specific smoothing/scaling and cavity lining remain in #118.

## Geometry and responsiveness

Follow pocket angle uses the finite source unchanged. Vertical drop-in projects
its nominal outline before bottom rounding onto XY, then extrudes that projection
vertically. A sheared bottom-fillet profile extends the authored seat plane across
the projection. Split seats retain their separate depths. The extension is clipped
to the original lowest elevation, preserving the requested remaining floor.

Rounded source floors also receive a continuous upward facet sweep so their
steps cannot block insertion. A 0.001 mm lateral overlap joins those facets without
coincident seams; clipping to the nominal projection retains the exact outside
perimeter and holes. This avoids a whole-solid Minkowski operation. Top rounding
is applied at the actual fill surface. Floor colors cover the extended seat and
stop inside the wall fillet; the material parts are clipped to the finished bin.
Horizontal, inverted and through pockets retain the general solid-sweep path.

If the tilted floor itself reaches the bin surface and prevents the full opening,
the preview explains how to correct the height or tilt and export is blocked.
It does not add deep trenches beside a seat that cannot fit beneath the surface.

Full exact geometry remains in the workers. Selection and Move/Rotate outlines
always use lightweight source wires, without rounded mesh edges. Rounding remains
visible in the rendered bin. Packing reserves the source and insertion envelope.
A near-horizontal axial path is omitted from preview and reported as an error;
other cavities stay editable, exports are blocked, and **Use vertical drop-in**
changes only the direction, with undo.

## Verification

Under Node 22, geometry tests check continuous translated-source clearance,
the entire source projection with combined pitch/roll/heading above the fill,
exact preservation of the angled geometry, tilted seat heights, concavities and
holes, split depths, remaining floor depth, submerged opt-in behavior, surface rounding and nonoverlapping floor
colors. Worker tests check closed STL/3MF topology, nondegenerate triangles,
material volumes, invalid-axis rejection and vertical recovery. Project tests cover
schema-32 migration and current-state/history/transform-reference round trips;
UI and linked-copy tests cover conversion, direction edits, recovery and undo.
Both modes retain the 120-frame no-exact-request drag regression.

Browser validation loaded a side-by-side 30° comparison, confirmed the optional
controls and unchanged 16 mm depth / 7 mm elevation, disabled clearance and undid
the edit, exercised 90° recovery and undo, and moved Z by 1 mm then undid it.
The updated comparison uses combined 20°/25° tilt, 17° heading, 7 mm elevation
and a 4u bin, with the vertical pocket at X=28.07, Y=-6.55. Its saved Library
project shows the extended seat and simple selection outline. Regression tests
also cover the reported 5.05 mm elevation in a 3u bin, verify clearance throughout
insertion, and exercise STL/3MF serialization with closed, nondegenerate color
parts. Physical insertion fit remains unqualified.

Local Node 22 gates pass: type checking, 2,673 tests in 154 files, production
build and whitespace validation. GitHub Actions remains disabled.
