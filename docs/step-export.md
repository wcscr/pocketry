# Experimental STEP export for CAD editing

**2026-10-29 baseline:** both isolated approaches now include
main `ee7eefa9`; local checks pass as recorded in the investigation report. Neither approach is selected or
shipped. The October 15 unchanged Klein, DeWalt, and Caliper examples failed
2.8 mm bottom fillets in both approaches. Earlier synthetic fixture passes do
not establish support for those designs. See the dated
[baseline and evidence ledger](step-export-investigations.md).

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

STEP carries editable, named solids with their placement. Saved Pocketry
material settings are not yet applied to STEP partitions; do not rely on
complete material/color fidelity in this investigation.
It does not supply a native FreeCAD or Fusion parametric feature history. Keep
the Pocketry project to retain authored settings and history. A fully raised
pocket retains its finite source body and an inactive cutter entry without a
dummy solid. Duplicate and Unicode names remain distinct through stable IDs.

The OCCT XCAF writer emits AP214 B-reps in millimetres. STEP construction never
reads preview, STL, 3MF, or mesh data. Authored polygons retain their original
line boundaries; basic circles and rectangles retain primitive provenance in
schema 55, retaining main's schema 54 fields. Schema 36 was the earlier
investigation format; refreshed migration and history regression tests pass.
Nonuniformly scaled circles become ellipses. Contour revision removes
primitive metadata. Inference of unambiguous original basic shapes is restricted
to project schemas **35 and earlier**. A schema 36 or later shape without
metadata remains a polygon, even if its points resemble a primitive: an edited
schema 36 polygon may have been resaved by main as schema 54. Existing explicit
metadata is preserved and checked against the authored boundary; migration does
not recreate missing provenance.

## Investigation coverage

The historical synthetic corpus covers standard feet and lips, hollow and solid bins,
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
also remain unavailable. The refreshed preflight explicitly rejects arbitrary
sizes, peg bottoms, nonzero wall slants, active hollow compartments/divider
scoops and floor fillets, hardware-symbol labels, and retained-material hole
objects. It also rejects pending pocket depths, local X/Y insertion, legacy
unanchored vertical offsets or insertion, and unqualified floor-clipped vertical
insertion. Retained hollow settings that are inactive in a solid bin do not
alone trigger these hollow-feature rejections.

The CAD printing path rejects interior and object-axis pocket material coverage.
Grouped placement and broader material compatibility still require qualification.
These guards pass refreshed regression tests; browser and native application
acceptance on the refreshed branches remains pending. Schema acceptance alone is not feature support.

Rounding must use genuine Fillet operations and preserve the requested geometry.
The sharp-only October 15 runs changed diagnostic copies explicitly; they are
not a release mode or fallback. Normal exports must not disable rounding,
simplify boundaries, lower a radius, or substitute a custom rounded solid to
make an unsupported design export. Read the comparison before relying on either
branch.

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

Use Node 22 for the required local check, quick tests, build, and diff checks.
`npm test` now selects quick suites; CAD/export changes also require the relevant
`test:geometry` and `test:workflows` suites, or `test:full`. The dated comparison
records the exact local suites run for this refresh. GitHub CI remains disabled. Produce the same corpus in each
worktree:

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
[FreeCAD native API corpus](freecad-step-acceptance.md) passed on the recorded
October 7 revisions. The later RC1 normal-import control passed geometry but
failed Unicode names; full refreshed native acceptance remains pending.
Remaining gates are recorded in the comparison.

The refreshed tree retains the early handwritten serializer and its tests as
regression references. The investigation UI exports through the CAD worker/XCAF
implementation. Production completion and any backend selection still require
the agreed release gates and human review.
