# Upstream provenance — gridfinity-rebuilt-openscad

The Gridfinity geometry in this directory (and the constants in
`shared/gridfinity/`) is a TypeScript port of
[`gridfinity-rebuilt-openscad`](https://github.com/kennetek/gridfinity-rebuilt-openscad)
(MIT © 2023 Kenneth Hodson; full licence text in `/NOTICE`).

**Pinned commit: `910e22d8607fd7f5f51ad5e5cbc5287a76810bfd`** (2025-08-31,
"Gridfinity rebuilt 2"). Re-syncing means diffing the upstream files below
against this SHA and updating both sides of the table. No `.scad` files are
vendored into this repository — porting stays explicit.

## File map

| This repository | Upstream @ 910e22d8 | What was ported |
|---|---|---|
| `shared/gridfinity/standard.ts` | `src/core/standard.scad` | Grid pitch, base profile, radii, stacking-lip line + fillet, wall/divider thicknesses, magnet/screw hole constants |
| `client/src/lib/gridfinity/profiles.ts` | `src/core/base.scad` `_base_polygon()`, `src/core/standard.scad` `STACKING_LIP`, `src/core/wall.scad` `_profile_wall()`, `src/helpers/shapes.scad` `rounded_square()` | Closed profile polygons and the rounded rectangle |
| `client/src/lib/gridfinity/sweep.ts` | `src/helpers/generic-helpers.scad` `sweep_rounded()` | The sweep primitive: 4 edge extrusions + 4 corner revolves |
| `client/src/lib/gridfinity/base.ts` | `src/core/base.scad` `base_solid()`, `_base_bridge_solid()`, `gridfinityBase()` | Socket cell, centre fill, grid pattern, bridge plate |
| `client/src/lib/gridfinity/wall.ts` | `src/core/wall.scad` `render_wall()` | Plain wall annulus + swept stacking lip |
| `client/src/lib/gridfinity/bin.ts` | `src/core/bin.scad` `new_bin()`, `bin_render*()` | Assembly, infill height rule, height conventions |
| `client/src/lib/gridfinity/holes.ts` | `src/core/gridfinity-rebuilt-holes.scad` `block_base_hole()`, `screw_hole()`, `make_hole_printable()`, `ribbed_circle()`/`ribbed_cylinder()`; `src/core/base.scad` `_base_holes()` | Magnet/screw holes, sequential-bridging ceilings, entry chamfer, crush ribs, hole grid |
| `client/src/lib/gridfinity/fillet-stack.ts` | — (original) | K-slice stepped bottom fillet for cutout pockets |
| `client/src/lib/gridfinity/label-tab.ts` | `src/core/tab.scad` `tab()`, `src/core/standard.scad` `TAB_POLYGON` / `TAB_*` | Label tab profile prism, width styles (full / 42 mm left-center-right), wall placement |

Not ported: the Gridfinity Refined hole, Lite Base and its `only_corners`
variant, weighted/skeletonized/screw-together
thumbscrew (`src/external/threads-scad` is a third-party vendored library —
check its licence independently before porting; drop the feature if not
permissive).

## Deliberate deviations

- **`TOLLERANCE` (0.02 mm) nudges are dropped.** Upstream shaves the lip
  support's outer vertex and the infill footprint to avoid coincident-face
  artifacts in OpenSCAD preview. manifold's booleans handle coincident faces
  exactly, and the fused solid is identical without the nudges.
- **The lip's top fillet is computed in closed form.** Upstream runs a general
  tangent-tangent-radius routine (`radius_line_edge`); this corner is exactly
  a 45° edge meeting a vertical edge, so the centre is `(2.6 − r,
  4.4 − r·(1+√2))` and the summit `4.4 − r·√2` (`STACKING_LIP_HEIGHT_ACTUAL`).
- **Arc quality is an explicit parameter.** OpenSCAD's `$fa/$fs` become
  `circularSegments` (per full circle, multiple of 8 so quarter arcs land
  vertices on cardinal directions and bounding boxes stay exact). Note
  manifold's `revolve(segments, degrees)` spreads `segments` across the swept
  angle, so a quarter revolve is passed `circularSegments / 4`.
- **`calculateNormals(0, 60)`, not `(3, 60)`.** The plan document predates
  manifold deprecating non-zero normal channel indices; channel 0 is the
  "standard slot" and `getMesh()` then returns interleaved normals.
- The infill spans the full footprint (as upstream, minus their tolerance
  shave) and parts may overlap; `buildBin` unions them. Multi-color 3MF export
  cuts configurable non-overlapping volumes downward from blind-pocket floors
  and the stacking-lip summit, leaving the original exterior dimensions and
  the rest of the body material unchanged.
- **Label tabs are per-bin, not per-compartment.** Upstream hangs tabs on
  compartment walls with an `auto` style resolved per grid element; this bin
  has no compartments, so the tab takes an explicit wall (`north`/…) and
  width (`full` / 42 mm `left`/`center`/`right`, defined facing the wall from
  the bin centre). The prism is intersected with the rounded interior column
  instead of upstream's per-edge `snap_to_edge` clamping — the corner
  fillets trim the ends exactly and a full-width tab cannot poke through a
  wall.
- **Hole bridging is built as a positive, overlapping stack.** Upstream's
  `make_hole_printable()` subtracts cubes from a cube and subtracts *that*
  from the hole cylinder; this port builds the equivalent narrowing bands
  directly, each dipping half a layer into the piece below — abutting pieces
  whose faces share no vertices do not reliably weld in a manifold union, and
  came out as sealed voids (caught by the genus tests). The ±0.02 TOLLERANCE
  padding on band widths is dropped, and bands keep one fixed axis pair
  instead of upstream's per-corner 90° cluster rotation (which only matters
  for the asymmetric Refined hole).
