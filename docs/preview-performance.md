# Bin preview performance

The September 2026 Wiha investigation reproduced slow preview updates with a
3 × 7 × 3u bin, 80% fill, five split-depth pockets, top and bottom fillets,
and an oblong finger-access opening. Fillet construction and material-mesh
normal calculation dominate this case. The saved project's large shape library
and history are not sent to the geometry worker; only referenced shapes are used.

## Implemented changes

- Skip aggregate normal calculation when actual material parts provide the
  displayed meshes. Preserve normals for every displayed material mesh and for
  fallback previews without material parts. Aggregate topology/statistics and
  export topology remain available.
- Keep one dispatched preview and one replaceable pending preview after the
  existing 120 ms debounce. A committed edit immediately invalidates older UI
  callbacks, including while the new edit is debouncing. Let the physical RPC
  finish before starting the latest pending preview: cancelling its promise
  cannot interrupt synchronous WASM and would recreate the backlog.
- Keep normal export, individual fit-check, and surface-fit-check requests on
  their existing channels with their captured payloads. Preview coalescing does
  not drop these requests. They still share CPU time with the preview worker.
- On worker `error` or `messageerror`, terminate that endpoint, reject affected
  calls, and allow a subsequent request to create a new worker. Failed exports
  are surfaced rather than silently retried. Synchronous spawn/post failures
  also remove the pending RPC entry.
- Return empty mesh buffers when a section removes the entire solid. The
  previous normal-channel check incorrectly rejected empty Manifold meshes;
  nonempty meshes retain strict validation.

No persistent WASM cache or split-cutter geometry refactor is included. Both
need separate ownership/invalidation and seam-correctness work.

## Measurements

On an Apple M5 Max with Node 26.8.1 and Manifold 3.5.1, five alternating calls
per version to the real worker handler gave these medians for the supplied Wiha
design at the unchanged preview quality:

| Handler | Median |
| --- | ---: |
| Baseline (`50f55f0`) | 1,916.9 ms |
| Implemented normal extraction | 1,449.6 ms |

This is a 24.4% reduction in handler time. All ten builds produced byte-identical
displayed position, normal, and index buffers: SHA-256
`672f66eba2578ce1202933b86d9e888a64f5820bf95481a98954b5f32661b51b`.
The model retained 47,964 aggregate triangles and 49,650 displayed material
triangles. Timing includes mesh extraction and excludes WASM startup, browser
scheduling, transfer, and GPU drawing; it is not an end-to-end latency claim.

The scheduler's regression tests verify that intermediate pending edits never
reach the worker. A latest preview still waits for the running job and its own
build; coalescing removes accumulated obsolete work without making one build
instantaneous. The earlier queue-only prototype measured 7.26 s versus 3.65 s
for four edits 150 ms apart, but that single-run experiment is not a benchmark
of the integrated hook or a combined speedup claim.

## Regression coverage

`client/src/hooks/use-bin-geometry.test.tsx` exercises the actual hook and
WorkerClient through a controlled Worker endpoint. It covers debounce boundaries,
stale progress/results/errors, A→B→A, replacement of pending work, preservation
and disposal of existing geometry, section/material changes, all three export
payloads, unmount, StrictMode replay, and worker failure/recovery. Geometry tests
exercise actual material availability, fallback normals, cut sections, empty
section buffers, and transferable buffer ownership. Worker RPC tests cover
failure of all pending channels, detached endpoints, and synchronous post errors.

Validation on 2026-09-23: `npm run check`, all 1,822 tests in 107 files,
`npm run build`, and `git diff --check` passed. These local checks used Node
26.8.1; the repository's target runtime remains Node 22. The production build
retains its existing large-chunk warning.

The imported Wiha project was also exercised in the in-app browser: rapid height
edits during a running preview, single/multicolor toggles, and the X-section
minimum of −62.75 mm completed without browser errors. Full and single-material
geometry were visually inspected, and the full multicolor 3MF export reached its
success notification. This does not establish performance on slower devices,
validate a slicer's interpretation of the export, or validate physical print fit.
