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
- Publish a fast draft for layouts with pocket rounding, then restore the
  authored top/bottom fillets after 300 ms of idle input and completion of the
  draft. Drafts retain outline resolution, corner rounding, split depths,
  finger access, and material colors. Layouts without pocket rounding build
  once. The UI labels omitted rounding and withholds draft statistics and
  collapse reports.
- Batch initial interactive input for 32 ms without resetting the deadline on
  each edit. Once running, immediately drain only the latest pending request.
  This also produces drafts during continuous 60/120 Hz gestures, which a
  restarting debounce would starve. Each lane retains one physical RPC until
  completion; cancellation cannot interrupt synchronous WASM.
- Use at most two lazy workers: interactive previews have their own worker;
  refinement and all three export channels share the other. A slow detailed
  build or export cannot queue ahead of a new draft. Wait for the current draft
  before starting its refinement to avoid competing during initial feedback.
  A previously running refinement may overlap later drafts.
- Preview live gesture values while normal exports, surface-fit exports, and
  autosaves retain their committed snapshot; individual fit checks retain their
  explicit shape/cutout arguments. Committing a gesture refreshes export
  callbacks even when the preview geometry key has not changed. Preview tiers
  never modify saved settings. Export topology explicitly ignores the draft
  flag as an additional boundary guard.
- On worker `error` or `messageerror`, terminate that endpoint, reject affected
  calls, and allow a subsequent request to create a new worker. Failed exports
  are surfaced rather than silently retried. Synchronous spawn/post failures
  also remove the pending RPC entry.
- Return empty mesh buffers when a section removes the entire solid. The
  previous normal-channel check incorrectly rejected empty Manifold meshes;
  nonempty meshes retain strict validation.

Persistent WASM caching, GPU section clipping, split-cutter refactoring, and
alternative normal generation remain separate follow-ups. The latter prototypes
need seam/shading validation; none is needed for this progressive preview.

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

With progressive preview implemented, another five alternating calls per tier
on the same device measured **142.0 ms median for drafts**, versus **1,511.4 ms
for the detailed result**. Drafts have 10,066 aggregate triangles. Detailed mesh
buffers still match the SHA-256 above exactly. This is about 10.6× faster geometry
preparation for the first update, not a reduction in the detailed build time or
a browser input-to-paint benchmark. Add the initial scheduling window, worker
startup/transfer, and drawing costs to handler timings.

The latest draft can still wait for an older interactive job, but it never waits
for refinement on the other worker. Both WASM runtimes remain loaded until the
workspace unmounts, trading memory for responsiveness. Slower/mobile devices need
separate latency and memory qualification.

## Regression coverage

`client/src/hooks/use-bin-geometry.test.tsx` exercises the actual hook and
WorkerClient through a controlled Worker endpoint. It covers debounce boundaries,
stale progress/results/errors, A→B→A, replacement of pending work, preservation
and disposal of existing geometry, section/material changes, all three export
payloads, unmount, StrictMode replay, and worker failure/recovery. Progressive
coverage adds 120 Hz input, two independent lanes, idle refinement, stale detailed
results, draft/detail errors, removing rounding, statistics withholding, and live
preview versus committed export payloads. Page coverage verifies that a pointer
drag reaches the live input while the export snapshot remains committed. Geometry tests
exercise actual material availability, fallback normals, cut sections, empty
section buffers, and transferable buffer ownership. Worker RPC tests cover
failure of all pending channels, detached endpoints, and synchronous post errors.

Validation on 2026-09-23: `npm run check`, all 1,841 tests in 107 files,
`npm run build`, and `git diff --check` passed. These local checks used Node
26.8.1; the repository's target runtime remains Node 22. The production build
retains its existing large-chunk warning.

The imported Wiha project was exercised in an isolated in-app browser origin:
live height changes produced visible drafts before Enter, rapid edits during
refinement settled on the latest design, and the export panel withheld draft
volume. Draft and detailed geometry were visually inspected, and a full
multicolor export reached its success notification. The prior fixes also
verified material toggles and empty sections. This does not establish performance on slower devices,
validate a slicer's interpretation of the export, or validate physical print fit.
