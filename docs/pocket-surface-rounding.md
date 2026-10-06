# Pocket top rounding at the bin surface

Validated on 2026-10-05, following a report that raising a silhouette above the
fill surface made its top-edge rounding disappear from the bin.

## Cause and behavior

Rigid generated pockets previously rounded their source extrusion's cap before
rotation and translation. The round moved with that cap, so it could sit above
the material or decorate a submerged cap instead of rounding the actual opening.

The source now retains clearance, corner rounding, bottom rounding, and split
depths. After posing and joining the source, the builder slices its actual
intersection with the fill surface and adds the existing top-edge fillet there.
One unioned opening supplies the rim for split pockets, retaining holes and
avoiding a separate rounded ridge at the split seam. Fully submerged pockets
remain closed at the surface. The radius is limited by the requested radius,
the shortest finite source depth, and the available depth below the surface.

The shared cutter path applies this behavior to bin previews, exact selection
outlines, STL/3MF meshes, and surface fit tests. Rounding remains in the geometry
workers; active Move/Rotate gestures retain their kernel-free preview wires.
Saved settings and project schemas are unchanged.

## Verification

Eight geometry regression cases verify material removal at the surface with the
cap raised 7 mm above it, unchanged geometry below the rim, preview/export
quality, equivalence with existing flush upright bins, 50% and 100% fill heights,
submerged caps, matching inspection and fit-test openings, and tilted split
pockets with and without holes. Split floor colors remain nonoverlapping and
their volumes sum to the final solid.

Two worker export cases verify upright and tilted raised pockets with real
Manifold geometry. STL and multipart 3MF meshes have closed edge topology,
nondegenerate triangles, correct serialized triangle counts, and matching
material-part volumes. Rounding changes the exported bin volume and does not
mutate the input request.

Node 22 local gates passed: `npm run check`, `npm test` (2,637 tests in 152 files),
`npm run build`, and `git diff --check`. GitHub CI remains disabled.

Browser verification imported a comparison with two 20 × 24 × 16 mm rectangular
pockets, each with a 12 mm lowest point in a bin whose fill surface is 21 mm.
Both source caps are 7 mm above the surface. The pocket with a 2 mm top round
visibly rounds into the bin; its neighboring pocket with 0 mm remains sharp.
The model reports Export ready and the named project visibly saves to Library.
A further 1 mm Z move raises the lowest point to 13 mm; one Undo restores 12 mm
without changing the 16 mm source depth or the surface rounding.
The local comparison and screenshot are `/private/tmp/pocketry-raised-rim-comparison.pocketry.json`
and `/private/tmp/pocketry-raised-rim-comparison.png`.
