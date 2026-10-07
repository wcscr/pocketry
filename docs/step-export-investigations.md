# STEP export investigations — review gate

Updated: 2026-10-07. **Recommendation: select A, dedicated STEP, for the next
production milestones.** Both working investigations generate true CAD solids
from authored design data. B also drives actual preview, STL, and multi-color
3MF through CAD tessellation. Neither branch is a production default, and the
agreed full capability is not complete. FreeCAD import-dialog stability, physical prints, broader adversarial coverage,
and the unsupported features below remain gates. Fusion editing and FreeCAD
native API editing pass all six fixtures in each approach; see
[fusion-step-acceptance.md](fusion-step-acceptance.md) and
[freecad-step-acceptance.md](freecad-step-acceptance.md). FreeCAD's normal import
dialog crashes remain an explicit failed workflow check.

## Isolated implementation

| Investigation | Branch | Local preview | Integration |
| --- | --- | --- | --- |
| A | `codex/step-cad-export` | `http://localhost:5194/bin` | Existing Manifold bin preview/STL/3MF; independent CAD STEP on demand. |
| B | `codex/cad-unified-geometry` | `http://localhost:5195/bin` | CAD bin construction supplies STEP and tessellated preview/STL/3MF. |

Both start at preserved early-prototype commit
`b1e6bf613c8ef4695011519c516cbf09f72c07ab`. The shared foundation was committed
in A as `6baab13` and cherry-picked into B as `e4d1e80`; the same shared fixes
are carried in both. A's UI integration is `f7ba7a5`, B's matching UI integration
is `a542560`, and B's separate geometry integration is `732a705`. Geometry
hardening is `d31ee01` / `27684db`, loading diagnostics and independent
dimensions are `ec39b44` / `2fac93b`, library recovery is `e8f5564` / `f5b54b4`,
complete placement provenance is `220d857` / `ff7526c`, and shared scale/fill preflight is `178384f` / `e9c1eca`.

The primary checkout's unrelated work is preserved. These are local commits;
no PR, push, merge, deployment, or GitHub CI run has been performed. The original
handwritten STEP serializer and fixtures remain regression references. The
experimental UI uses the OCCT worker, not that serializer.

## Geometry and object evidence

The same six authored-data fixtures are shared by both worktrees:

| Fixture | Verified content |
| --- | --- |
| standard-solid | Standard Gridfinity feet, smooth stacking rim, solid fill. |
| standard-hollow | Two-cell standard feet, rim and hollow walls. |
| mixed | Rotated/mirrored rectangle, corner/bottom/mouth rounding, circular through cut, duplicate Unicode names. |
| concave | Original concave polygon and interior hole, clearance/rounding, overlapping cut, nonuniformly scaled circle retained as an ellipse. |
| tilted | Compound tilt, split depths, rounded finite source, exact axial insertion clearance, and a fully raised inactive cutter with its finite source retained. Mouth radius is explicitly zero in this fixture. |
| irregular | L footprint and smooth rim, circular pocket, rounded straight finger access, original Bézier “CAD” text, separate pocket/finger floors and rim material volumes. |

Additional real-kernel tests cover full/half/quarter feet, partial fill, native
offsets with holes, source identities, preview-independent STEP geometry,
printable shared-edge stitching/winding, and an interior translation of the
tilted rounded split source. Model/migration tests cover exact polygon data,
primitive provenance, edited-contour invalidation, current/legacy project
round trips, saved history, versioned library recovery, snapshots, known-scale and solid-fill preconditions, and guards.

Both fixture sets were independently reopened using
`cadquery-ocp 7.8.1.1.post1` / OCCT 7.8, separate from the OCCT 8 writer. All six
passed valid closed-solid checks, specified dimensions, component counts,
object bounds/volumes/placement, names and stable instances, reconstruction
from the named blank/tools, a further CAD cut, and saving/reopening the edited
result. The mixed source contains a 6 mm circle; the scaled-circle source
contains an ellipse with 9.8 / 4.9 mm radii, independently measured to 1e-7 mm.
All files have AP214 headers and no faceted or tessellation representations.
STL and every 3MF part also passed independent closed-edge, consistent-winding,
positive-volume checks.

Expected overall dimensions are 41.5 × 41.5 × 24.551472 mm (solid),
83.5 × 41.5 × 24.551472 mm (hollow), 125.5 × 83.5 × 31.551472 mm (mixed),
125.5 × 83.5 × 28 mm (concave), 125.5 × 125.5 × 35 mm (tilted), and
83.5 × 83.5 × 31.551472 mm (irregular). Independent bounds agree within
0.00002 mm, including native boundary tolerances.

Polygon boundaries are copied as lines, without fitting or automatic
simplification. Clearance and rounding are explicit subsequent CAD operations.
Circles, ellipses, bin corners, feet and rim surfaces are constructed directly;
font lines and Bézier poles are retained. OCCT may encode exact font curves and
surface intersections as B-splines in STEP. Generated crush-rib splines are
still unavailable because hardware construction remains a later milestone.

The insertion feasibility result is deliberately limited. For non-inverted
axial extrusion, every lower rounded section is contained by the authored top
profile; extending that exact profile along the insertion axis gives the
continuous envelope. This retains holes, concavities and split-seat geometry.
The implementation does not sample poses or use a triangle sweep or whole
object convex hull. The general boundary-surface sweep works on the tested
sharp-source cases, but a tilted toroidal bottom fillet swept vertically
produces invalid native faces. It is rejected. General rounded vertical
insertion has **not** passed the mandatory feasibility gate. A successful axial
fixture is not evidence for that broader case.

The package has all six agreed files. Finite source objects are separate from
derived cutters; inactive cutters have manifest entries and no dummy STEP solid.
Assembly instances include stable IDs so duplicate names remain distinct.
Source transforms retain position, rotation, elevation, scaling and mirroring;
STEP geometry is already in world millimetres. Linked-design references are
retained, but a complete linked-object CAD acceptance corpus is still pending.
The current STEP assembly carries finished body/text solids and text color;
full user material-region/color mapping into STEP remains a later milestone.

Modeling requests use 0.000001 mm tolerance, with one Boolean retry at
0.00001 mm. Validation rejects invalid/open solids and excessive native
tolerances without shape repair or omitted rounding. Some OCCT offset/fillet
boundaries record approximately 0.000005 mm tolerance even when the requested
operation tolerance is 0.000001 mm; the report records that separately and
enforces the 0.00001 mm ceiling. This is not a claim that every resulting
boundary has 0.000001 mm tolerance. The pinned STEP binding cannot expose the
writer's operation-flags setter; its reviewed defaults perform common-vertex
splitting/direct-face conversion, rather than general shape repair.

## Application and printing results

| Application / gate | Result |
| --- | --- |
| Independent OCCT reader | All six fixtures in both approaches pass import, editing, reconstruction, and re-export/reopen checks described above. |
| FreeCAD 1.1.4 / OCCT 7.8.1 | All six fixtures per approach pass native GUI API import, measurements, added hole, named-tool reconstruction/movement, fresh FCStd disk reopening and STEP reopening. All 32 native STEP comparisons independently pass. Normal File → Open import-dialog acceptance crashes with both irregular bin files and a FreeCAD-authored simple-box control on macOS 26.6.2 and remains unpassed; see `freecad-step-acceptance.md`. |
| Fusion 2705.1.15 | All six fixtures per approach pass native import, measurement, added hole, source/tool reconstruction, named-cutter movement where applicable, and F3D/STEP reopening. Both irregular/text fixtures also pass tool reconstruction and movement; their edited F3D archives were visually reviewed. Independent OCCT validates all 32 edited/baseline/moved STEP comparisons with no residual extra/missing solids. See `fusion-step-acceptance.md` for volume-estimate limitations and the product-name identity fix. |
| PrusaSlicer 2.9.6 | B's standard-feet and tilted STL fixtures produce representative G-code with generic 0.4 mm / 0.2 mm / 15% settings. This is not printer-specific or physical qualification. |
| PrusaSlicer color 3MF | Reads four closed named meshes, but CLI slicing treats raised material volumes as separate objects; warnings, path conflicts and a failed assembled attempt remain unresolved. Do not count this as a passing multi-color slice. |
| Bambu Studio 02.08.02.61 | Local CLI import reports an 83.5 × 83.5 × 31.551472 mm manifold model. Save/reopen evidence preserves one assembly with four parts, their relative placement, names and extruder assignments 1–4. No completed multi-color slice was produced by the attempted CLI invocation. |
| Physical prints | Not performed. Required before changed printing geometry becomes the default. |

The saved Bambu import contains `Bin body`, `Pocket floors`, `Stacking rim`, and
`CAD label`; all four mesh-stat entries report zero repaired edges, degenerate
facets, removed/reversed facets and backwards edges. There are seven connected
mesh components because floors and glyphs can have independent components;
that is distinct from four named material parts.

## Performance comparison

These are sequential Node 22.23.3 / macOS arm64 runs of the same six fixtures,
same pinned engine, same preview/print quality settings, and the same 20-job
mixed-tray sequence. The harness recomputes warm previews; there is no shape
cache hiding work. STEP timings include package creation and cleanup. Native
engine initialization from local files took 77.0 ms in A and 81.8 ms in B;
these figures exclude network download and are **not browser cold-load times**.
The measured geometry revision is `d31ee01` / `27684db`; subsequent changes add
loading diagnostics, independent checks, recovery migration and transform
metadata without changing the modeled fixture geometry.

| Fixture | A warm preview | B warm preview | A STEP | B STEP | A print mesh | B print mesh |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| standard-solid | 17 ms | 422 ms | 695 ms | 732 ms | 49 ms | 539 ms |
| standard-hollow | 13 ms | 486 ms | 598 ms | 594 ms | 39 ms | 645 ms |
| mixed | 40 ms | 1248 ms | 1473 ms | 1507 ms | 182 ms | 1564 ms |
| concave | 40 ms | 648 ms | 801 ms | 821 ms | 219 ms | 786 ms |
| tilted | 322 ms | 209 ms | 269 ms | 251 ms | 2545 ms | 273 ms |
| irregular | 105 ms | 736 ms | 846 ms | 854 ms | 1358 ms | 1392 ms |

B's ordinary warm updates are much slower in this corpus; its analytic axial
construction is faster on the tilted fixture than the existing sampled
printing path. STEP cost is similar because both share the same CAD backend.
These are comparative fixture measurements, not guarantees for large designs
or mobile devices. Browser cold network loading, input-to-paint latency, and
device-specific peak process memory remain unmeasured release gates.

The single-threaded WASM is 22,980,267 bytes, or 7,193,790 bytes with gzip.
The module worker is approximately 1.22 MB / 0.386 MB gzip. A incurs those
additional assets on STEP request; B needs them for bin construction. The
served source archives total 105,317,260 bytes and are not startup downloads.
Both branches still bundle some existing Manifold utilities for other app
features; B's bin worker construction and printing use CAD throughout.

## Memory, cancellation and failure recovery

The 20-job Node mixed-tray test gives A a flat 127.1 MiB native heap, with a
fresh engine per export (20 releases). B grows from 127.1 to 238.9 to
344.1 MiB and then recycles; eight runtime resets occurred in that harness.
First/last complete job times are 1512 / 1520 ms for A and 1525 / 1468 ms for B.
The browser worker uses the same 256 MiB recycling threshold or eight completed
jobs, whichever occurs first. It keeps no persistent CAD shape cache.

Twenty actual browser downloads were checked for each approach, including all
six ZIP files, one consistent snapshot hash per sequence, schema 36, solid
counts, and AP214 without mesh entities. A's mixed-tray exports have a flat
127.1 MiB heap; B's irregular exports grow through 127.1 / 199.1 / 238.9 /
344.1 MiB before recycling. The two browser sequences use different fixtures
and are recovery evidence, not the cross-backend timing comparison.

Native heap growth remains unexplained despite tracked handle/file cleanup.
Worker recycling is essential; this is not a claim of zero leaks. Maximum Node
RSS observed was about 1024 MiB (A) / 919 MiB (B), including the Vite harness,
JavaScript heaps, kernels and garbage-collection behavior. RSS is not the same
as WASM heap capacity and is not browser process-memory evidence.

The client serializes all CAD preview/export work. Snapshot, project and last
preview data remain outside the worker. Explicit cancellation terminates
synchronous native work and the next job creates a new worker. Actual browser
cancellation and a succeeding retry were observed. A temporary missing-WASM
test shows a clear engine-loading failure with no package, automatic asset
restoration, and a successful retry. A stale built worker URL also produced the
worker-crash message; refreshing the rebuilt page recovered. Unit tests cover
queue ordering, immutable inputs, cancellation, load/error/message failure,
worker recreation, and the hard modeling deadline.

The guards are 20,000 profile segments, 200 authored objects, 120 seconds of
modeling, a 180-second whole-job watchdog, and a 512 MiB between-operation heap
threshold. Generated font curves contribute to the profile budget. Native
allocations cannot be interrupted by a between-operation check; a browser can
terminate first. No boundary is simplified to meet a budget.

## Existing printing versus smooth CAD

These are independently measured mesh-minus-finished-CAD volume differences:

| Fixture | A existing print mesh minus CAD volume | B CAD tessellation minus CAD volume |
| --- | ---: | ---: |
| concave | -10.050134 mm³ | +1.261276 mm³ |
| irregular | -40.579204 mm³ | +0.083226 mm³ |
| mixed | +34.025741 mm³ | +0.072624 mm³ |
| standard-hollow | -0.878023 mm³ | -0.352281 mm³ |
| standard-solid | -1.542715 mm³ | -0.413716 mm³ |
| tilted | -32.101027 mm³ | -0.601707 mm³ |

A retains its current sampled rounding and printing behavior. The smooth CAD
shape is intentionally a separate representation of the authored geometry.
B's tessellation quality affects only meshes, never STEP geometry. Native
faces are tessellated with crease normals for preview; printable interfaces
stitch identical Float32 positions and reject open, inverted or nonmanifold
results. Degenerate native pole/seam facets with identical vertex IDs are
discarded without moving vertices.

Volume differences alone cannot establish local fit error. Maximum local
surface distance, changes around rounded seats/lips, representative material
slices, and physical fit/strength remain qualification work. No shape difference
has been silently approved for production printing. The current printing tests
continue to exercise Manifold geometry even on branch B; they are regression
references, while the CAD fixture/mesh checks and actual B browser exports are
the evidence for its replacement path.

## Browser, repository and distribution checks

Production-built local previews loaded the emitted single-threaded WASM and
produced actual ZIP downloads. B's UI rendered the irregular CAD model and
downloaded STL plus a multi-color 3MF containing the four named parts. Desktop
single-panel and workflow layouts, 390 × 844 phone controls, and 820 × 1180
tablet controls were inspected. Responsive viewport testing is not testing on
physical phones/tablets; their memory and compatibility gates remain pending.
The original user browser project at port 5184 was preserved.

Both branches pass Node 22 `npm run check`, `npm test` (165 files / 2778 tests),
`npm run build`, and `git diff --check`. One A rerun encountered an existing
five-second geometry-test timeout under additional load; a complete rerun
passed without relaxing the test. The early serializer's regression tests also
remain in the suite. Build warnings about chunk size, existing browser
externals and old Browserslist data remain; they are not failed gates.

The kernel exception and LGPL/provenance review are documented in CLAUDE.md
and [cad-engine-review.md](cad-engine-review.md). Actual JS/WASM, all served
notices, complete pinned source archives and their part/full SHA-256 hashes
were checked over the local production HTTP server. The upstream container
digest and bit-for-bit binary rebuild remain unattested. Public distribution
requires its own source-availability and provenance readback.

## Remaining work after selection

1. Complete bin construction: label tabs and named hardware tools, deliberately
   stepped supportless ceilings, crush ribs with bounded spline error, and
   expanded irregular/thick-wall/partial-fill adversarial cases.
2. Complete pockets: profile bottoms, legacy tilted anchors, tilted mouth
   rounding, general rounded vertical/inverted insertion feasibility, multiple
   islands/mirrored-hole/tangency/tiny-floor/extreme-tilt adversarial acceptance,
   and independent local boundary/fit comparisons. Keep strict rejection until
   each case passes.
3. Complete independent objects: every finger-access variant including shallow
   curved mouth rounding, portable-font and linked-object acceptance, and full
   STEP material/color mapping. B additionally needs its CAD fit-check paths,
   broader printing parity, assembled material slicing and physical prints.
4. Resolve the FreeCAD 1.1.4 normal import-dialog crashes observed with both
   irregular STEP files and a FreeCAD-authored box on macOS 26.6.2, then rerun
   that desktop workflow. The
   six-fixture Fusion and FreeCAD native API edit/reconstruction/reopen corpora
   pass. Test actual phones/tablets, cold network loading, memory
   termination/retry and process-memory evidence.
5. Pass the complete release corpus and local gates, update supported-feature
   documentation, and only then replace the early exporter and propose the
   selected production default. Publication, merge and deployment remain
   separately authorized steps.

Select **A** to deliver editable CAD exports while retaining the established
printing path. Select **B** if a single CAD source for all bin outputs is the
priority and the additional preview, mobile-memory, fit-check and printing
qualification work is acceptable. No selection has been made automatically.

Evidence and reproducible artifacts are in
`outputs/cad-investigation/` in each worktree. The compact tracked
[evidence record](cad-investigation-evidence.json) contains acceptance results,
benchmark measurements, served-asset checks and browser download hashes.
The scripts in [step-export.md](step-export.md) reproduce the corpus and
independent acceptance.
