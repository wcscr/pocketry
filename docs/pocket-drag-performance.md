# 3D pocket movement performance

Validation on 2026-10-05, following a report of slow 3D Move controls on a
powerful desktop. Baseline: UI/mobile PR #125 at `ec0799a`.

## Cause and correction

The 3D gizmo already kept drag edits local until release. However, each local
pose updated `PocketTransformWire`, which asked `usePocketGeometry` to generate
the complete rounded cutter, its projection, section, and mesh through the
browser's main-thread Manifold runtime. Crease-edge extraction also ran there.
An asynchronous promise around these synchronous operations did not make them
nonblocking. The cache keyed by placement object missed on every new drag pose.

Active Move and Rotate gestures now use the existing kernel-free source wires.
They follow position, elevation, rotation, concavities, holes, and split seats;
rounding and clearance details return in the settled exact outline. The bin
mesh stays at its committed pose during the gesture and rebuilds on release.
The final model, exports, history, and Library save path are unchanged.

Exact selection geometry and its crease edges now build in a shared lazy
worker. Picking and outline consumers share in-flight requests and detached
results. The queue permits one physical batch and only the newest pending pose
per pocket, since cancelling a promise cannot interrupt synchronous CSG. Views
ignore obsolete replies, and the worker and pending requests are released when
the final consumer unmounts. This can add one selection worker alongside the
two existing bin-preview/detail workers; it does not create a worker per pocket.

## Measurement

The existing `wiha-40mm-4-pocket.pocketry.json` from the calibrated, smooth,
linked four-driver design was evaluated under Node 22. The first pocket was
converted to its equivalent rigid representation and translated through seven
X positions. The first run was excluded from the median. The rounded split
solid contained 71,628 triangles; its source wires contained 69 line segments.

| Work per pose | Warm median |
| --- | ---: |
| Exact selection solid, projection, section, and mesh | 2,139.97 ms |
| Crease-edge extraction from that mesh | 123.73 ms |
| Kernel-free drag wires | 0.20 ms |

The exact work is now outside the active drag and off the main thread. These
are Node geometry timings, not measured browser frame rates, pointer latency,
or phone performance. They establish the cost of the removed synchronous path.
The measurement source and detailed results are temporary local artifacts at
`/private/tmp/pocketry-3d-drag-benchmark.test.ts` and
`/private/tmp/pocketry-3d-drag-benchmark.json`.

## Verification

Regression tests cover 120 drag poses with no exact-geometry requests, one
request for the released pose, shared requests, pending-pose coalescing, stale
responses, shape/fill invalidation, worker failure recovery, and worker disposal.
A component contract test requires every active selected-pocket preview to use
the kernel-free path. Worker tests compare the rounded, mirrored, rotated split
mesh and its boundaries with the existing exact implementation, verify prepared
edges and transfer buffers, retain legacy profile boundaries, and reject invalid
or cancelled requests. Existing commit/cancel/undo contracts remain in place.

Node 22 gates passed: `npm run check`, `npm test` (2,627 tests in 151 files),
`npm run build`, and `git diff --check`. GitHub CI remains disabled.

Desktop browser checks imported the original four-driver project, selected the
first pocket, and used the 3D Move controls. A pointer X drag changed the offset
from 0 to 7.7058 mm and created one history entry; one Undo restored X/Y/Z to 0
and the original 10.25 mm depth. A numeric Z move to 1 mm also rolled back in one
Undo. The restored project visibly saved to the browser Library. These checks
verify editing and history behavior, not frame rates or printable clearance
after the deliberately displaced test poses.
