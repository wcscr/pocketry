# STEP export for CAD editing

Pocketry's early STEP exporter reconstructs boundary-representation solids from
the design's millimetre outlines and pocket depths. It does not convert STL,
3MF, preview triangles, or Manifold mesh output to STEP.

In **Export**, choose **Save STEP CAD package**. The single ZIP contains:

- `bin.step`: the finished tray with its pockets subtracted.
- `design-objects.step`: an assembly containing the bin blank and each named
  pocket cutter, in their original positions. These are intentionally
  overlapping construction tools, not additional printable parts.
- `objects.json`: placement IDs, source shape IDs, names, roles, and units.
- `design.pocketry.json`: the original editable Pocketry project, including
  its settings and any saved history.
- `README.txt`: instructions for the two STEP files.

Import `bin.step` to add CAD features to the finished tray. Import
`design-objects.step` when you want to reuse or change individual pocket tools
and reconstruct the cuts. STEP carries named solids and boundary geometry;
this implementation does not generate native FreeCAD or Fusion parametric
features or a feature history. Keep the Pocketry JSON for design settings.

## Current support

- Rectangular bins with a flat bottom, no stacking rim, solid fill at 100%.
- Full, half, and quarter grid pitch; bin corners remain analytic cylinders.
- Upright, surface-anchored pockets with a single fixed depth, remaining floor,
  or through cut. Position, heading, mirroring, and outline scaling are retained.
- Basic rectangles/squares and uniformly scaled authored circles. The circle
  recognizer checks Pocketry's original regular-circle samples to within
  0.00000001 mm; it never fits circles to traces or to changed contour points.
- Simple concave traced outlines, retaining their original straight outline
  segments as planar side faces. Traces are still polygonal boundaries, not
  magically recovered splines, but their extrusion surfaces are not triangles.
- Each pocket's bounding envelope must be strictly inside the rounded bin and
  separate from every other envelope. This conservative restriction can reject
  nonintersecting contours whose bounding boxes overlap.
- At most 2,000 outline vertices across the placed pockets, to bound work in
  this initial browser implementation.

The export button explains the first unsupported setting. Export also checks
the complete snapshot before creating any download. There is no mesh fallback,
partial export, silent feature removal, or change to the saved design.

Gridfinity feet, stacking rims, hollow/partial-fill bins, custom footprints,
hardware holes, label tabs, finger access, text, edge rounding, clearance offsets,
ellipses, tilted/raised/rigid pockets, split/profile bottoms, overlapping cuts,
multiple outlines and outline islands are not supported yet.

## Implementation and next milestones

`client/src/lib/export/step.ts` is a dependency-free AP214 serializer using
`ADVANCED_FACE`, `PLANE`, `CIRCLE`, `CYLINDRICAL_SURFACE`, shared edge topology,
`CLOSED_SHELL`, `MANIFOLD_SOLID_BREP`, and product/assembly relationships.
`step-bin.ts` resolves the supported design subset and writes the ZIP with the
existing `fflate` dependency. No second geometry kernel is linked or bundled.

The next work should preserve authored primitive intent explicitly in project
data, extend the analytic model to ellipse/rounded pocket profiles and finger
access, and add standard feet/lips. Arbitrary intersecting features and fillets
need a reviewed CAD construction strategy and additional interoperability
fixtures; they should not be approximated by wrapping a mesh in STEP.

## OpenSCAD review (2026-10-06)

Reviewed upstream OpenSCAD at `c0ac8289f1c9db6f70891da5df3b4085b7eaf8b6`:
its [export format registry](https://github.com/openscad/openscad/blob/c0ac8289f1c9db6f70891da5df3b4085b7eaf8b6/src/io/export.cc)
contains no STEP writer. Its [CSG export path](https://github.com/openscad/openscad/blob/c0ac8289f1c9db6f70891da5df3b4085b7eaf8b6/src/openscad.cc#L417)
writes the evaluated construction tree before geometry rendering.

The useful reference is [scad123d](https://github.com/etjones/scad123d), reviewed
at `85811a1a9daa291fb9ebfdfd8339322a9ec5b52c`. Its `openscad.py` obtains `.csg`,
`build.py` rebuilds primitives/transforms/Booleans with build123d, and
`solid123d/export.py` writes named assembly bodies through OCCT's XCAF STEP
writer. It allows mesh fallbacks for some unsupported operations; Pocketry's
STEP contract must reject those instead. No source from either project was
copied into this implementation.

The architectural lesson for broader Pocketry support is to retain a symbolic
construction graph (profiles, extrusions, sweeps, transforms, named cuts) before
mesh evaluation. A CAD backend could replay that graph to handle intersecting
cuts and fillets. Pocketry already has source design data, so introducing an
OpenSCAD parser/conversion dependency is unnecessary. This is a next-stage
architecture inference, not an implemented general CAD backend or an exception
to the repository's single-kernel policy.

## Local acceptance checks

Run the normal Node 22 type checks, test suite, and production build. Unit and
page tests cover package contents, geometry contracts, project round trips,
unsupported-feature blocking, and the export controls in both desktop layouts.

Generate independent CAD acceptance fixtures:

```sh
npm exec -- tsx scripts/export-step-fixtures.ts /tmp/pocketry-step-acceptance
```

The optional reader runs separately from the application. In an isolated
Python 3.12 environment install `cadquery-ocp==7.8.1.1.post1`, then run:

```sh
python scripts/verify-step-export.py /tmp/pocketry-step-acceptance
```

It imports the finished and construction STEP files with OCCT, checks solid
validity, analytic surface types, dimensions, exact expected volumes, assembly
names (including Unicode), reconstructs the tray by subtracting the exported
source cutters and verifies it equals the finished solid, and performs another
Boolean cut on every finished
bin. It saves `cad-verification.json`. Current fixtures cover rotated/mirrored
rectangles, circular through holes, concave traces, and quarter-pitch empty bins.

This independent reader verifies CAD topology, not application-specific UI
interoperability. Direct import/edit acceptance in FreeCAD and Fusion 360 is
still required before claiming full compatibility with either application.

References: [OCCT STEP translator](https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/master/dox/user_guides/step/step.md),
[FreeCAD topological scripting](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Topological_data_scripting.md).
