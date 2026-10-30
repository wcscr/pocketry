# Geometry integrity at the export boundary

Tracks [#147](https://github.com/wcscr/pocketry/issues/147). This repair is independent of the partial-opening policy in PR #146.

## Root cause

The previous export path converted a native Manifold solid to Float32, called
`Mesh.merge()`, rebuilt a Manifold, and simplified it at 0.0001 mm. A `NoError`
status was treated as proof that the shape survived. The worker repeated this
for the aggregate and material regions, then rebuilt the body using rounded
cutters. Those independently repaired surfaces could disagree: the body could
subtract a different shape from the one supplied by the colored insert.

This predates PR #146. A fully contained near-horizontal pocket reproduced on
`8db6a583333fa3120e04b6ccef3aff8ef096546b` produced a material-volume discrepancy
of approximately 4,468.72 mm³. A thin inclined insert lost approximately
1.56 mm³ during cleanup. Independent triangle-volume and occupied-space
measurements confirmed a real geometry change despite `NoError`.

Kernel-only experiments also reproduced geometry changes during reconstruction
and simplification of thin, nearly opposing surfaces. Re-importing meshes and
unioning them in the same kernel can itself change the result, so that operation
is not a sufficient independent export oracle. No kernel fork or dependency
change is part of this repair.

## Export contract

- Complete construction and material partitioning in the native kernel first.
- Convert the finished regions to Float32 once. Do not use the resulting meshes
  as CSG inputs or reconstruct color ownership from them.
- Preserve explicit topological identities. Identical coordinates alone must
  not join separate touching components.
- Remove only exact collapsed edges, collinear faces, and canceling boundaries.
  Exact predicates must agree across triangle order and coordinate scale.
- Preserve original Float32 coordinates. Where a parallel topological edge
  needs subdivision, share one rounded midpoint across its original twin pair;
  check its Float32 rounding bound and reject collapsed or reversed faces.
- Require finite, nondegenerate, consistently oriented closed output with a
  connected vertex fan. Fail explicitly if that cannot be established.
- Serialize 3MF coordinates without another decimal rounding step. STL writes
  the same stored Float32 coordinates.

`extractPrintableMeshData` is the shared boundary for bins, color partitions,
text, fit checks, traced-outline STL, calibration aids, and command-line exports.
Preview extraction remains separate. Text uses the printable mesh with flat
shading so normal generation does not require a rounded-solid reconstruction.

## Verification strategy

The committed regression tests compare indexed topology, signed triangle
volumes, independently sampled occupied space, and meaningful boundary
positions. Their controls include touching components, removable zero-volume
fins, equal-volume displaced solids, and overlapping material assignments.
Seeded shape families exercise color thickness changes and adding a disjoint
pocket; native clipped geometry covers partial intersections independently of
whether the UI currently allows those designs to export.

Broader qualification uses 193 configurations spanning tilted and near-horizontal
pockets, concave and holed outlines, text, split and through pockets, and color
regions. Slicer import and slicing are separate evidence from geometric checks;
neither establishes physical fit or printing performance. The reported support
warnings on the user's other designs remain unconfirmed until those exact
artifacts are compared.

PR #146 must remove its conditional solid cleanup when it is rebased onto this
fix. Retaining that cleanup would reintroduce the precision feedback loop.

## Local qualification (2026-10-08)

- Node 22: type check, 2,997 tests in 169 files, production build, and diff checks passed.
- All 193 additional configurations passed native-volume conservation and exact
  STL/3MF coordinate readback. The largest sum-of-materials discrepancy was
  0.001904 mm³; the largest aggregate/native discrepancy was 0.023313 mm³ after
  Float32 conversion.
- Independent stress checks covered 600 thin extrusions, 600 convex-hull controls,
  and 300 collinear networks with distinct/coincident subdivisions. Nine serialized
  configurations received 108,000 ray comparisons; the maximum sampled column
  discrepancy was 0.00000348 mm.
- Bambu Studio 2.8.2.61 imported eight representative designs as both STL and
  multicolor 3MF: all 16 files were reported manifold and sliced successfully
  using the bundled X1 Carbon 0.4 mm / 0.20 mm Standard / PLA profiles, with empty
  slice warning messages. File hashes matched the final regenerated exports.
- Rotated surface text was inspected in the local 3D browser preview with no
  console errors. No physical printing or testing of the user's other affected
  designs has been performed.

The full existing suite exposed a coverage gap in the pocket-focused matrix:
standard-lip hollow bins and measurement rulers contain connected collinear face
networks. Their generic repair uses an exact decreasing potential (zero-face
count, then squared-edge energy), plus repeat collapse of newly connected
zero-length edges. Independent minimal network tests cover scale, translation,
coincident subdivisions, and differing Float32 exponents.
