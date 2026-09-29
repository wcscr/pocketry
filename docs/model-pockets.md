# Imported model pockets

Imported-model pockets are experimental and off by default. Turn on
**Settings → Enable experimental features**, then in the Bin designer choose
**Add pocket → Import 3D model**. Select a binary or ASCII STL, confirm the units used by the source application, and review the
reported X × Y × Z dimensions before adding it. STEP, OBJ, and 3MF import are not
yet supported; export a watertight STL from your CAD application first.

Pocketry makes a fitted storage cradle from the model's broad shape, with **0.3 mm
fit margin** and **1 mm detail smoothing** by default. Small grooves and ribs are
cleared rather than reproduced as fragile pocket features. It clears the complete
insertion path, including overhangs and enclosed regions that would block the tool.
The imported mesh itself stays unchanged.
Importing starts with 75% of the authored Z height below the fill surface, subject
to the normal minimum floor thickness. Use **Fit bin to contents** to reserve
space for the model and its insertion path.

- **Insertion path → Follow pocket angle** (default) sweeps along the model’s
  rotated Z axis, pointing toward the bin opening. Inverted poses use the opposite
  end of the same axis. A horizontal or nearly horizontal axis needs a different
  angle or Vertical drop-in because it cannot exit through the top.
- **Insertion path → Vertical drop-in** clears straight upward in bin coordinates,
  allowing the model to be lowered vertically at its chosen resting angle.
  Switching modes leaves position, rotation, scale, and depth unchanged.
- **Insertion depth** moves the lowest point below the fill surface without
  stretching the model. Negative values lift it above the fill.
- **Model dimensions** scale its authored X/Y/Z axes. Scale together is enabled
  by default; disable it to change one axis independently.
- Position and rotation use the existing pocket controls. Rotation on all three
  axes is available with experimental tools enabled.
- **Fit margin** adds room around the tool for easy placement and removal.
  Increase it for a looser fit. The lowest floor stays at the chosen insertion
  depth, so changing the fit does not move the seated tool.
- **Detail smoothing** controls the radius used to round over fine grooves and
  ribs and soften sharp contour turns. The normal cradle also rounds the
  remaining edges with at least a 0.3 mm radius and retains a blended floor.
  Increase it to clear larger details; broad recesses still support the tool.
  Set it to 0 to retain the detailed CAD sweep (slower). In that mode the
  margin uses the original box expansion along the model axes, so diagonal
  corners receive more clearance and the expanded floor anchors the elevation.
- **Inspect this pocket in 3D** shows the actual model cavity and its section at
  the fill surface. Surface fit tests, bin STL, and bin 3MF use the same cutter.
  A flat tool-outline fit template is unavailable for a model pocket.

With **Color pocket floors** enabled, imported-model pockets use a lining around
all cavity surfaces, including steep and vertical transitions. Its thickness
extends outward into the bin material; it does not reduce tool clearance or change
the bin's combined solid. This differs from the downward floor-color band used
for ordinary outline pockets.

Turning experimental features off hides import and model-specific editing controls
and cancels an import in progress. Existing pockets remain visible, saved, and
exportable. Opening a saved experimental project (including model pockets kept
only in undo/redo history) preserves the current opt-in setting. If the tools are
off, a notification explains how to enable them in Settings; loading or restoring
a project never enables experimental controls automatically.

## Fit limitations

The selected path is a straight translation, either along the pocket angle or
vertically. It does not model twisting or a changing orientation during insertion.
The path extends through the bin rim, and exact checks reject intersections with
walls, the label tab, stacking rim, or other pockets. Physical fit still requires
a test print with the real object and a suitable clearance.

The normal storage shape uses a conservative directional height field in the
selected insertion frame. Every source triangle is clipped against the cells it
covers; the lowest height in each cell defines empty space all the way to the
opening. A spherical opening of the lower surface removes narrow raised material
ribs, followed by a separate margin dilation. Interpolation uses the lowest
adjacent cells, so it can only clear additional material. This is a continuous
insertion envelope, not a few sampled tool positions or a whole-object convex hull.

Typical cell spacing is 0.2–0.3 mm; larger models and smoothing radii use coarser
cells to bound browser memory and processing. The cell mesh is reduced in three
bounded passes to remove stair steps, expanded
outward, and united with the original conservative envelope. A final spherical
expansion rounds surviving corners and tips. The floor retains part of that blend;
its anchoring is bounded by the rounding solid's inradius so the seated tool still
fits. Smoothing therefore clears additional material beyond the fit margin.
Packing reserves cell coverage, boundary expansion and floor anchoring allowances,
and the generated cavity is checked against the bin. This is a practical storage
approximation, not a precision molding surface. The source CAD is never decimated.
Preview, inspection, fit tests and exports use the same shape.

Printability checks cover outward-only cleanup, removal of raster stair steps,
gradual inward and outward contour turns, thin source features, preservation of
broad recesses, and the original tool's insertion path. They do not certify every
possible imported shape or replace a slicer/physical-fit review. Straight support
walls remain; the storage contour avoids reproducing tiny right-angle notches.

At smoothing 0, the geometry kernel performs a continuous Minkowski sweep. A
numerical overlap of 0.0001 mm (or twice the kernel tolerance) keeps the sweep
nondegenerate and only enlarges the cavity.

Inspection slices reuse the most recent complete preview bin. The worker keeps
one detached, unsectioned mesh and its material partitions, not a history of WASM
solids. Changing geometry invalidates it; exports always rebuild independently.
Completed pocket outlines are also reused when the inspector is reopened.

Model contours cannot be edited as traced outlines. Fillets, corner rounding,
split-depth controls, and through mode do not apply to imported meshes. Edit the
original CAD/mesh for structural changes, or use Detail smoothing to clear small
features.

## Validation and saved projects

Imports are limited to 20,000 triangles and 10 MiB per file. Coordinates must be
finite and the model must have thickness on each axis, with dimensions between
0.001 and 2,000 mm after unit conversion. The importer welds identical vertices
and checks for collapsed triangles, open/non-manifold edges, inconsistent face
winding, positive volume, and kernel errors. It does not automatically repair
scans or guarantee that all self-intersections can be detected. Repair failed
meshes and simplify overly detailed scans in the source application.

Parsing and model inspection run in cancellable workers; import processing has
a one-minute time limit. Existing bin validation checks the remaining floor and
exact 3D intersections with other pockets, walls, and the stacking rim. Fast
selection and packing use a conservative convex footprint until exact model
sections are available.

Model data stays in the browser and is embedded in saved projects and exported
project JSON (schema 27). Reopening needs no original file. Earlier projects
migrate without changing their generated or traced pockets. No manufacturer
models or additional runtime dependencies are bundled with this feature.

## Manufacturer CAD qualification

The Weidmüller SDS 0.6×3.5×100 screwdriver (9008330000) was checked using the
manufacturer's STEP reference model, converted offline to a 5,616-triangle STL.
Its six test poses cover upright and angled insertion, an inverted axis,
horizontal vertical-drop placement, increased margin/smoothing, and mirrored
nonuniform scaling. Angled and horizontal bins were also rebuilt through the
export worker and round-tripped through STL validation, including their separate
body, cavity lining and stacking-rim parts. The long-bin case exposed a collinear
Float32 export seam; bounded retriangulation after ordinary cleanup fixes it.

Manufacturer CAD is not automatically a printable mesh. The STRIPAX 9005000000
reference model exceeded the triangle limit at the tested tessellation quality;
a coarser conversion still had collapsed triangles. The KT 8 9002650000 conversion
had non-manifold edges. These imports were rejected rather than silently repaired.
STEP conversion remains an external preparation step; no manufacturer CAD is
included in the application or its test suite. These checks do not establish
physical fit or qualify arbitrary CAD assemblies.
