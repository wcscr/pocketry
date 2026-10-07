# Experimental STEP export for CAD editing

Two isolated investigations now build browser-local CAD boundary representations
from Pocketry design data. Neither is a production default. See
[the investigation comparison](step-export-investigations.md) for evidence,
benchmarks, unsupported cases, and the required human selection gate.

## Download and editing contract

In Export, choose **Save STEP CAD package**. The ZIP contains:

| File | Contents |
| --- | --- |
| `bin.step` | Finished bin and valid separate text bodies. |
| `design-objects.step` | Named bin blank, finite source objects, actual cutters, finger-access tools, and text bodies. Construction tools intentionally overlap. |
| `design.pocketry.json` | The committed project snapshot, including retained history. |
| `objects.json` | Stable IDs, names, roles, source references, assembly paths, transforms, links, status, and reconstruction order. |
| `export-report.json` | Snapshot hash, engine/exporter versions, tolerances, timings, dimensions, topology, memory, and solid counts. |
| `README.txt` | Import and reconstruction instructions. |

STEP carries editable, named solids with their placement and applicable colors.
It does not supply a native FreeCAD or Fusion parametric feature history. Keep
the Pocketry project to retain authored settings and history. A fully raised
pocket retains its finite source body and an inactive cutter entry without a
dummy solid. Duplicate and Unicode names remain distinct through stable IDs.

The OCCT XCAF writer emits AP214 B-reps in millimetres. STEP construction never
reads preview, STL, 3MF, or mesh data. Authored polygons retain their original
line boundaries; basic circles and rectangles retain primitive provenance in
schema 36. Nonuniformly scaled circles become ellipses. Contour revision removes
primitive metadata, and migration recognizes only unambiguous original basics.

## Investigation coverage

The shared corpus covers standard feet and lips, hollow and solid bins,
irregular footprints, rotated/mirrored rectangles, circles, ellipses, concave
contours with holes, overlapping cuts, clearance, corner and edge rounding,
tilted rounded split sources with axial insertion, inactive raised sources,
finger access, original Bézier text outlines, and separate floor/rim/text
volumes. Full/half/quarter feet and partial fill have additional kernel tests.

This is not full authored-feature support. Hardware tools, supportless hardware
ceilings, crush ribs, label tabs, profile bottoms, tilted mouth rounding, and
some curved insertion/finger-access operations remain unavailable. They are
rejected before or during construction; there is no mesh fallback, omitted
rounding, geometry-changing repair, or partial ZIP. B's CAD fit-check methods
also remain unavailable. Read the comparison before relying on either branch.

## Local execution and limits

`replicad-opencascadejs@1.1.0` runs in one dedicated module worker. A retains
Manifold for printing and loads CAD only for STEP, releasing the worker after
every export. B constructs bins in CAD and tessellates those boundaries for
preview and printing. B recycles after eight completed jobs or a heap reaching
256 MiB. Cancellation, failure, crash, or timeout destroys the worker; the
project and last preview remain outside it.

Operational guards are 20,000 profile segments, 200 authored objects, 120 seconds
of modeling, and a 512 MiB heap check between operations. A 180-second job
watchdog also covers loading/writing. Native allocations can exceed a guard
before control returns; these limits cannot guarantee survival on a phone.
The single-threaded build requires no new cross-origin isolation. Designs are
not uploaded. See [the license/provenance review](cad-engine-review.md) and the
served `/licenses/cad/` directory for notices, complete corresponding sources,
hashes, and build recipes. Binary reproducibility remains unattested.

## Verification and reproduction

Use Node 22 for the required local check, test, build, and diff checks. GitHub CI
remains disabled. Produce the same corpus in each worktree:

```sh
node scripts/export-cad-investigation.mjs outputs/cad-investigation dedicated
# In the unified worktree, use unified instead of dedicated.
```

In a separate Python environment with `cadquery-ocp==7.8.1.1.post1`:

```sh
python scripts/verify-cad-investigation.py outputs/cad-investigation
```

The independent reader checks solids, dimensions, circle/ellipse radii, names,
placements, reconstruction, further editing and STEP reopening, plus printable
mesh topology and 3MF part names. This is separate evidence from native CAD
application checks, slicer qualification, and physical prints. The six-fixture
[Fusion editing corpus](fusion-step-acceptance.md) and
[FreeCAD native API corpus](freecad-step-acceptance.md) pass. FreeCAD's normal
import-dialog crashes remain unresolved. Remaining gates are recorded in the
comparison.

The original handwritten serializer and its fixtures remain as regression
references. The investigation UI uses the worker/XCAF implementation. Removal
of the early implementation and production completion require the selected
approach to pass the agreed release gates.
