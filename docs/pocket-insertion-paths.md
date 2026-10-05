# Optional silhouette-pocket insertion clearance

Pocket properties → Position & rotation → **Clear insertion path** opts a
silhouette pocket into one of two opening directions:

- **Follow pocket angle** keeps the original authored tilted cavity and its
  surface intersection. Its geometry matches the existing angled opening.
- **Vertical drop-in** opens the complete object projection as seen from above,
  including portions above the fill, giving it a straight path down from the
  surface. The existing tilted seat inside the bin remains shaped.

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

The source cutter keeps fit clearance, corner/bottom rounding, holes and split
depths. Follow pocket angle uses that finite source unchanged. Vertical drop-in
first continuously sweeps the complete posed source upward using exiting facet
prisms. This retains its tilted seat and removes blocking overhangs. It then
compares the resulting mouth to the complete source projection, including
portions above the fill. Missing parts of that projection receive vertical
clearance columns down to the pocket's lowest elevation. Only those new areas
are added: the existing tilted seat inside the bin remains shaped.

The added columns overlap the swept opening by 0.001 mm, restricted to the exact
projection so concavities and interior holes remain intact. This join prevents
zero-thickness seams. A 0.0001 mm Boolean tolerance handles Float32 facet
coordinates. Top-edge rounding is applied afterward at the actual fill-surface
intersection. Both directions retain source-based floor colors beneath the tilted
seat. Vertical mode also colors the thin slab beneath each new clearance floor,
without reproducing the cavity walls in another shifted cutter. All material
parts are clipped to the finished bin.

Full exact geometry remains in the workers. Active Move/Rotate gestures continue
to use source outlines, with one exact request after release. Packing reserves the
source and insertion envelope. A near-horizontal axial path is omitted from preview
and reported as an error; other cavities stay editable, exports are blocked, and
**Use vertical drop-in** changes only the direction, with undo.

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
A second comparison uses combined 20°/25° tilt, 17° heading and 12 mm elevation
with both tools extending above the fill. Switching its vertical pocket to the
angled option and undoing retained the pose and depth. Both comparison projects
were visibly saved to the browser Library. STL/3MF serialization was verified
through actual worker tests; physical insertion fit is unqualified.
