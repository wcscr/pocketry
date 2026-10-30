# Wiha CAD memory investigation

Measured locally on 2026-10-30 with Node 22.23.3. This investigation applies to
both experimental CAD branches; it does not select a production backend.

## Inputs and scope

The input is `samples/wiha-drivers/wiha-drivers.pocketry.json`: five driver
pockets, 275 authored profile segments, split seats, shared finger access, and
surface text. The original file and every stored outline remain unchanged.

Two inputs are explicitly distinguished:

- **Authored:** the original sample, including its requested radii. It already
  fails the first driver's bottom fillet with an invalid-solid error.
- **Sharp diagnostic:** the historical memory-control fixture, made by setting
  15 pocket corner/bottom/top rounding settings to zero in an in-memory clone.
  This is not an application fallback or a claim that the authored sample
  exports successfully. Before/after geometry comparisons use this same input.

`scripts/profile-cad-memory.mjs` records the original file hash, exact overrides,
normalized input, phase and operation events, WASM capacity, tracked native
wrappers, observed Node RSS, engine hash, and package report. It rejects a
nonempty output directory so failed runs cannot retain a stale successful ZIP.
Only `--sharp-control` applies the diagnostic overrides. The browser never
applies them.

## Root causes

The published `replicad-opencascadejs@1.1.0` binary registers empty native
destructors for 171 of its 454 bound classes. The compiler treats the presence
of placement `operator delete` as a reason to suppress ordinary destruction.
OCCT's `DEFINE_STANDARD_ALLOC` supplies both a public ordinary delete and a
placement delete, so this rule incorrectly suppresses valid destruction.

Calling the JavaScript handle's `.delete()` therefore marks its wrapper deleted
without running the native destructor. Temporary Boolean workspaces, topology
objects and validation data accumulate even when the application's handle
accounting reaches zero. Binary inspection found the affected classes pointing
to an empty WASM function, not merely an absent JavaScript finalizer.

The exact checker was especially costly: repeated fresh
`BRepCheck_Analyzer(shape, true, false, true)` construction/deletion grew memory
by approximately 64 KiB per check on a box. More than 4,200 checks grew capacity
from 100 MiB to 412.875 MiB. Reusing `Init(shape, true)` for 10,000 checks stayed
at 100 MiB. Raw allocator allocate/free controls also remained stable; this was
not caused by excessive shape detail.

The repair restores 169 owning destructors when a public one-argument operator
delete exists. Two protected base-class destructors (`BRepAlgoAPI_Algo` and
`CDM_Document`) correctly remain suppressed. It changes generated bindings,
not OCCT geometry algorithms. The
same pinned compiler image, original kernel libraries, binding configuration,
and Emscripten version are used. The exact recipe, patch, hashes, and licensing
review are distributed with the library; see `cad-engine-review.md`.

Application scopes also release intermediate construction objects promptly,
discard superseded bin bodies, avoid unused Boolean history, and reuse one
exact checker per modeling context. Retained source bodies and cutters remain
independent outputs. Modeling tolerances, operation order, profiles, dimensions,
and requested radii are unchanged. Returned `Append(shape)` value wrappers are
now explicitly owned as well as their lists. Memory checks also run immediately
after native Boolean/fillet calls return, including before result validation.

After repairing destruction, Wiha's printing path still reached 594.625 MiB.
The native packed output was only about 2 MiB, with 74,263 triangles before
stitching. Releasing triangulation caches and construction tools did not lower
that capacity. An instrumented loader observed an actual allocator request of
589,324,432 bytes, so Emscripten's growth padding alone could not explain the
remaining failure.

The original single-thread build selects **mimalloc**, whose WASM port layers
size-class pages and retained arenas over emmalloc. An allocator-only relink
using **emmalloc directly** reduced the same printing job to 207.375 MiB. The
complete/body/text position and index arrays remained byte-identical. STEP
fell further to 120 MiB; the authored fillet attempt stayed at 100 MiB. This
isolates a second cause: allocator overhead in this single-threaded workload.
It does not establish a byte-by-byte accounting of live versus reserved memory.

The final package, `1.1.0-pocketry.2`, includes the destructor repair and the
explicit `-sMALLOC=emmalloc` link setting, with unchanged OCCT libraries and
mesh quality. Both allocator sources already belong to the pinned Emscripten
5.0.1 source archive. The earlier destructor-only `.1` build remains documented
as comparison evidence. See the [allocator guidance](https://emscripten.org/docs/tools_reference/settings_reference.html#malloc).

## Baselines

| Sharp diagnostic run | Result | Peak WASM capacity | Duration |
| --- | --- | ---: | ---: |
| Original code, 512 MiB guard | Fails subtracting driver 4 | 594.625 MiB | 5.23 s |
| Original code, diagnostic-only 1 GiB guard | Complete package | 811.0625 MiB | 9.07 s |
| Scoped handles alone | Still fails at the guard | 594.625 MiB | — |
| Scopes, no Boolean history, reusable checker | Complete package | 412.875 MiB | 9.13 s |
| Repaired native bindings plus lifetime fixes | Complete package | 163.0625 MiB | 9.58 s |
| Final repair with direct emmalloc | Complete package | 120 MiB | 9.20 s |

The 1 GiB baseline is confined to the profiling process; it is needed to obtain
a successful unchanged reference package. No browser limit was raised.
The authored rounded sample's original first-fillet failure reached
1,094.0625 MiB before the synchronous operation returned.

The checker-reuse package was independently reopened with OCCT 7.8 through
cadquery-ocp 7.8.1.1.post1. All 15 named bodies across the two STEP files retained
their names, placements, topology, curve/surface classes, bounds, and volumes.
All 30 directional Boolean differences were exactly zero cubic millimetres.
Source projects and snapshot hashes matched, and neither STEP contained
faceted/tessellated geometry.

The destructor-only package independently passed the same complete comparison:
all 15 named bodies match, and all 30 directional differences are exactly zero.
Its WASM SHA-256 is
`6d0c2946d642e5edf83482218717aa006dd562a701dbbc645a0282d6bbc6de35`.
Five native-lifetime qualification tests pass, including 2,000 fresh exact
analyzer allocations/deletions and retained builder/list/reference-counted shape
values. A separate 5,000-fresh-analyzer probe stays at 100 MiB without reuse.

The final emmalloc build also passed all 30 directional STEP comparisons and
the independent mesh fingerprint comparison. Its WASM SHA-256 is
`c4dec33bb5c623782ccdba290c5c4b280cf9a458b2d62d59dc4f900d6f87a255`.
The native ownership/destructor probes pass for both builds. Six additional
tests verify exact repeated meshes, unchanged curves/volumes, cache cleanup,
and retry after safely injected extraction/copy errors.

**The authored rounded sample still does not export.** With the final allocator
repair its first bottom-fillet call stays at 100 MiB, but produces the same
invalid solid. The destructor-only build reached 1,072.875 MiB at that call;
even a diagnostic-only 2 GiB allowance did not make its geometry valid. Every
failed run created no package. More memory is therefore not a solution to that
geometry failure. Requested outlines and radii were not changed, and no sharp
package is substituted for an authored request.

## Repeated jobs in both approaches

Final `.2` runs use the unchanged 512 MiB guard and the same sharp diagnostic.
All jobs passed, with zero tracked native wrappers left after context disposal.

| Approach | Jobs | Runtime initializations | Peak WASM capacity | Median job time |
| --- | --- | ---: | ---: | ---: |
| A, dedicated STEP | 20 STEP exports | 20 | 120 MiB | 9.12 s |
| B, unified CAD | 10 STEP, 5 preview, 5 printable meshes | 3 | 207.375 MiB | 8.76 s |

B recycled after each eight jobs. Within each runtime, capacity stabilized at
207.375 MiB after meshing; it did not grow with successive jobs. Repeated meshes
were identical within each quality mode, and every STEP report retained the
same snapshot and final engine version. B's median times by operation were
9.06 s STEP, 8.13 s preview, and 8.64 s printable mesh. These are instrumented
Node construction/export timings, not browser interaction latency.

Observed peak Node process RSS was 850.23 MiB for A and 918.05 MiB for B. That
includes Vite, JavaScript data, profiling records, compiled code, and retired
runtimes awaiting garbage collection. The Node harness initializes replacement
runtimes rather than terminating real browser workers, so these numbers are
not browser process-memory measurements. **The repair meets the existing WASM
guard; it does not establish total browser RAM below 512 MiB.**

Evidence is saved locally under `outputs/wiha-cad-memory-2026-10-30/` in the
primary checkout. `dedicated-final-step20/` and `unified-final-mixed20/` contain
profiles and real ZIP/STEP outputs. `independent-final-mixed20.json` records the
independent OCCT checks against the original successful baseline.
`final-cross-approach.json` verifies that both final STEP DATA sections are
byte-identical between A and B; complete files differ only in header timestamps.

## Local verification

Node 22 checks completed with GitHub CI disabled:

- Both worktrees: `npm run check`, `npm test` (215 files / 3,416 tests each),
  `npm run build`, and `git diff --check` passed.
- Unified: complete `npm run test:geometry` passed (27 files / 293 tests),
  including the shared CAD and existing printing qualification coverage.
- Dedicated: all CAD qualification tests passed (8 files / 38 tests). Shared
  modeling code and engine assets are identical to the full-suite-tested branch.
- Source preparation controls: 5 passed; independent comparator controls: 8
  passed. Native memory/cache lifetime coverage: 11 passed.
- Both production builds emit the final WASM hash recorded above.

The first sandboxed quick run could not bind local server-test ports. Those
three files passed with loopback permission, and the final complete quick runs
then passed in both worktrees. The source preparation script also passed an
offline run with source/notices and repair metadata intact.

This pass does not claim new FreeCAD/Fusion UI, browser device-memory, slicer,
or physical-print qualification. The independent reader is OCCT 7.8, and the
memory benchmarks run in Node. The native code and printing mesh equivalence
checks above support the memory repair; they do not resolve authored fillets or
the wider experimental backend-selection gate.

## Memory-limit decision

Keep **512 MiB as the default**. Raising the cap to mask leaked native objects
would only postpone failure, especially for a reused preview worker. A repaired
allocator/lifetime path should be qualified before considering larger models.

The guard measures allocated WASM capacity, not live native allocations or all
browser RAM. Emscripten grows memory in increments and does not shrink that
buffer when objects are freed. JavaScript copies, ZIP buffers, meshes, rendering,
and other tabs use additional memory. A synchronous native call can exceed the
guard before it returns; the guard is an operational limit, not a hard memory
sandbox. Cancellation must terminate the worker. The existing client releases
A's worker after export and recycles B's worker after eight jobs, after a large
job, or after an error.

A future **one-export 1 GiB retry with explicit confirmation** can be reasonable
for a measured, otherwise valid design that still reaches the guard after these
fixes. It should start a fresh worker, preserve the committed project outside
that worker, retain time/topology/geometry checks, record the chosen allowance,
and always release the worker afterward. It should not become an automatic
retry, a persistent default, or an unlimited setting. A coarse
`navigator.deviceMemory` value cannot establish that a retry is safe. No new
adjustable-limit UI is introduced by this repair; phone/tablet qualification
remains necessary before offering the higher tier.

Primary runtime references:

- [Emscripten memory growth settings](https://emscripten.org/docs/tools_reference/settings_reference.html#memory-growth-geometric-step)
- [Worker termination](https://developer.mozilla.org/en-US/docs/Web/API/Worker/terminate)
- [Device memory precision and availability](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory)

## Reproduction

Use Node 22 and an empty output directory:

```sh
node scripts/profile-cad-memory.mjs samples/wiha-drivers/wiha-drivers.pocketry.json /tmp/wiha-authored
node scripts/profile-cad-memory.mjs samples/wiha-drivers/wiha-drivers.pocketry.json /tmp/wiha-sharp --sharp-control
```

`--repeat=20` repeats the same input. `--mixed` cycles STEP, preview, printable
mesh, and STEP jobs using that same input. `--recycle=dedicated` or
`--recycle=unified` models the corresponding runtime replacement policy in Node;
it is not a browser worker/process-memory measurement. `--mesh` exercises the
CAD mesh construction used by B. Independent geometry comparison uses
`scripts/verify-cad-memory.py BEFORE AFTER --variant sharp-diagnostic
--symmetric-difference all --output REPORT.json` in the separately installed
OCP verification environment. No design is uploaded.
