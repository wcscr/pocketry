# Optional silhouette-pocket insertion clearance

Pocket properties → Position & rotation → **Clear insertion path** opts a
silhouette pocket into one of two opening directions:

- **Follow pocket angle** extends the full pocket toward the surface along its
  tilted Z axis. Inverted pockets use the upward direction of that axis.
- **Vertical drop-in** clears upward along the bin Z axis, giving the object a
  straight path down from the surface to its seated position.

Both preserve the authored pose, extrusion depth and lowest-point elevation.
Disabling clearance restores the finite cavity. Enabling it on a legacy pocket
first freezes its current depth and elevation using the existing rigid-pocket
conversion. Linked designs share the direction while keeping individual poses.
The common properties component serves both editor layouts.

Project schema 33 stores the optional `insertionMode`. Earlier projects migrate
with the field absent, including undo history and transform references, so their
finite pocket geometry does not change. Undo/redo and browser Library saves retain
the choice. This brings the opening directions from PR #118 to silhouette pockets;
STL imports, model-specific smoothing/scaling and cavity lining remain in #118.

## Geometry and responsiveness

The source cutter keeps fit clearance, corner/bottom rounding, holes and split
depths. After its rigid pose is applied, its exiting surface triangles sweep
continuous convex prisms along the insertion direction. Joining those prisms with
the source clears the entire path without replacing the pocket by a convex hull
or sampling discrete poses. A 0.0001 mm Boolean tolerance handles the Float32
facet boundary against the original kernel solid. Top-edge rounding is applied
afterward at the actual fill-surface intersection. Floor colors come from the
seated source and are clipped to the finished bin.

Full exact geometry remains in the workers. Active Move/Rotate gestures continue
to use source outlines, with one exact request after release. Packing reserves the
source and insertion envelope. A near-horizontal axial path is omitted from preview
and reported as an error; other cavities stay editable, exports are blocked, and
**Use vertical drop-in** changes only the direction, with undo.

## Verification

Under Node 22, geometry tests check continuous translated-source clearance,
different angled/vertical openings, concavities and holes, split depths, remaining
floor depth, submerged opt-in behavior, surface rounding and nonoverlapping floor
colors. Worker tests check closed STL/3MF topology, nondegenerate triangles,
material volumes, invalid-axis rejection and vertical recovery. Project tests cover
schema-32 migration and current-state/history/transform-reference round trips;
UI and linked-copy tests cover conversion, direction edits, recovery and undo.
Both modes retain the 120-frame no-exact-request drag regression.

Browser validation loaded a side-by-side 30° comparison, confirmed the optional
controls and unchanged 16 mm depth / 7 mm elevation, disabled clearance and undid
the edit, exercised 90° recovery and undo, and moved Z by 1 mm then undid it.
The comparison was visibly saved to the browser Library. STL/3MF serialization
was verified through the actual worker tests; physical insertion fit is unqualified.
