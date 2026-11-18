# Experimental STEP export for CAD editing

**Selected 2026-11-18:** the maintainer chose the dedicated STEP investigation
(A, `codex/step-cad-export`) as the primary implementation path. The unified
CAD investigation (B) is closed and no longer pursued. STEP export remains
experimental and is not a production default; the unsupported cases and
failing sample files recorded below still apply. See
[the selection record](step-export-investigations.md#selection--2026-11-18).

**2026-11-17 update, dedicated STEP investigation only:** rounded pocket floors
and mouths are now built by exact construction of the print path's rounding
rule instead of the modeler's edge fillet, and traced pocket sections are
fitted with lines and arcs. Both changes were approved by the maintainer that
day and replace two earlier rules; see [Sections and rounding](#sections-and-rounding).
Mouth rounding, which had been cutting a cove, now rounds the edge over as
printed, and shallow curved finger access is built. Eight of the sixteen sample
project files now export a complete package, up from one; see the
[2026-11-17 status](step-export-investigations.md#rounding-construction-update--2026-11-17).

**2026-10-29 baseline:** both isolated approaches now include
main `ee7eefa9`; local checks pass as recorded in the investigation report. Neither approach is selected or
shipped. The October 15 unchanged Klein, DeWalt, and Caliper examples failed
2.8 mm bottom fillets in both approaches. Earlier synthetic fixture passes do
not establish support for those designs. See the dated
[baseline and evidence ledger](step-export-investigations.md).

The dedicated STEP investigation builds browser-local CAD boundary
representations from Pocketry design data, separately from the established
printing path. It is the selected approach and is not a production default. See
[the investigation record](step-export-investigations.md) for evidence,
benchmarks, unsupported cases, and the comparison with the unified CAD
investigation.

## Download and editing contract

In Export, choose **Save STEP CAD package**. The ZIP contains:

| File | Contents |
| --- | --- |
| `bin.step` | Finished bin and valid separate text bodies. |
| `design-objects.step` | Named bin blank, finite source objects, actual cutters, finger-access tools, and text bodies. Construction tools intentionally overlap. |
| `design.pocketry.json` | The committed project snapshot, including retained history. |
| `objects.json` | Stable IDs, names, roles, source references, assembly paths, transforms, links, status, and reconstruction order. |
| `export-report.json` | Snapshot hash, engine/exporter versions, tolerances, timings, dimensions, topology, memory, and solid counts. When traced sections were fitted it gives the fit tolerance and largest deviation (`sectionFit`); when rounding was built exactly it gives the band and surface-check counts (`exactRounding`). |
| `README.txt` | Import and reconstruction instructions. |

STEP carries editable, named solids with their placement. Saved Pocketry
material settings are not yet applied to STEP partitions; do not rely on
complete material/color fidelity in this investigation.
It does not supply a native FreeCAD or Fusion parametric feature history. Keep
the Pocketry project to retain authored settings and history. A fully raised
pocket retains its finite source body and an inactive cutter entry without a
dummy solid. Duplicate and Unicode names remain distinct through stable IDs.

The OCCT XCAF writer emits AP214 B-reps in millimetres. STEP construction never
reads preview, STL, 3MF, or mesh data. Traced polygon sections are fitted with
lines and arcs as described under [Sections and rounding](#sections-and-rounding);
basic circles and rectangles retain primitive provenance in
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

## Sections and rounding

These rules replace the earlier requirement that rounding use the modeler's
Fillet operation on unmodified polygon boundaries. That requirement could not
be met: a rolling-ball fillet does not exist where a pocket is narrower than
twice the radius or a corner is tighter than it, which is the default case
(1 mm corner rounding under a 2.8 mm floor radius).

- **Rounding follows the print path's rule, exactly.** At height `h` above a
  pocket floor of radius `r`, the section is inset by
  `r - sqrt(r² - (r - h)²)`; narrow parts close up near the floor and tight
  corners leave a crease. The export builds that surface from cylinders and
  revolved arcs, one band per boundary line or arc
  (`client/src/lib/cad/exact-rounding.ts`). It is not an approximation and it
  is not the modeler's fillet. Sections with an elliptical boundary still use
  the modeler's fillet.
- **Traced sections are fitted with lines and arcs.** A traced pocket's section
  (outline, clearance, corner rounding) is computed with the same planar
  offsets as the print path and then fitted within 0.02 mm. The fitted
  boundary never lies inside the print path's section, so a pocket is never
  smaller than printed. The tolerance and the largest deviation are written to
  `export-report.json`.
- **Mouths are rounded over, as printed.** A top-edge radius rounds the bin's
  edge over into the pocket: the cutter widens by the same inset as it nears
  the surface. Until 2026-11-17 both investigations instead filleted a widened
  prism, which cuts a concave cove of the same radius with a sharp edge above
  and below it and removes several times the material. Native CAD acceptance
  recorded before that date was made on the coved shape.
- **Finger access follows the print path's profile.** A curved-bottom scoop
  too shallow for a vertical shaft carries its rim in its own cross-section,
  where the rim circle is tangent to the scoop circle; round holes revolve
  that profile, slots with rounded ends sweep it along the slot, and
  flat-ended slots stop it with end walls whose top edges are rounded over.
  Above the surface a finger-access cutter is as wide as its rounded mouth.
  A shallow flat-ended scoop with rounded plan corners is still rejected.
- **Every rounded solid is checked, and failures stop the export.** Points
  that must lie on the rounded surface are computed from the section alone and
  measured against the finished solid, and the removed volume is compared with
  the planar kernel's figure. A band that did not cut is cut again; if the
  surface is still off, no package is produced. The 0.00001 mm boundary
  tolerance ceiling is unchanged.
- **A rounding the modeler rejects is started again in another band order.**
  Whether the modeler accepts a set of bands depends on the order they are
  applied in. There are seven fixed orders, tried in turn from the unrounded
  solid, and every attempt is held to the same checks and the same ceiling. A
  memory or time limit stops the export instead of starting another attempt.
  `export-report.json` counts the roundings that needed another order
  (`exactRounding.reordered`).
- Normal exports still must not disable rounding or lower a radius to make an
  unsupported design export. The sharp-only October 15 runs changed diagnostic
  copies explicitly; they are not a release mode or fallback.

The section step is the one place this export uses two kernels in one
construction: Manifold (Clipper2) offsets the outline and OpenCascade builds
every solid. The modeler's own planar offset failed on 6 of 23 fitted sample
sections, and a section that differs from the print path's would defeat the
purpose. See the kernel note in `CLAUDE.md`.

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
