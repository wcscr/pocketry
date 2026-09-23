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
- Use full preview detail directly for inexpensive rounded designs. Initial
  estimates account for outline size, fillet bands, split pockets, pocket count,
  and bin area. A bounded cache of detailed build times overrides the estimate
  for subsequent positional edits (150 ms threshold); changed dimensions,
  depth/rounding, shapes, materials, or quality receive fresh estimates.
- Expensive layouts get a fast simplified preview, followed by authored detail
  after 300 ms of idle input and completion of the current preview. Normal drafts
  retain outline resolution, corner rounding, split depths, finger access, and
  material colors while omitting pocket top/bottom fillets. When only fillet
  settings change, a coarser rounded preview retains visible feedback for those
  controls (16 circular segments and a 2 mm fillet-profile step). Section-only
  changes build full detail immediately, retaining the previous mesh until
  completion instead of removing its rounding.
- Batch initial interactive input for 32 ms without resetting the deadline on
  each edit, then drain only the latest pending request. Publish monotonically
  newer intermediate results during the same transient gesture; do not publish
  obsolete detail or results across gesture completion, undo, or project changes.
  The page supplies the stable committed-document identity only while a gesture
  is transient. The hook also advances an epoch at gesture boundaries, preventing
  old replies from reviving after returning to the same history entry.
- Label simplified geometry, withhold its approximate statistics and collapse
  reports, and retain previous exact statistics with an explicit updating label.
  Use stable status text without resetting percentages; show transient busy
  indicators only after 150 ms. A failed refinement retains the simplified label
  and marks previous statistics as unavailable for the current preview.
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
coverage adds continuous input with actual intermediate publication, two independent
lanes, idle refinement, stale detailed results, gesture/undo/project boundaries,
draft/detail errors, adaptive direct builds, rounding edits, section-only changes,
explicitly stale statistics, delayed status labels, and live
preview versus committed export payloads. Page coverage verifies that a pointer
drag reaches the live input while the export snapshot remains committed. Geometry tests
exercise actual material availability, fallback normals, cut sections, empty
section buffers, and transferable buffer ownership. Worker RPC tests cover
failure of all pending channels, detached endpoints, and synchronous post errors.

Validation on 2026-09-23: `npm run check`, all 1,853 tests in 107 files,
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

## UX regression follow-up

The initial progressive implementation discarded every completed result during
continuous input and applied its idle delay even to inexpensive rounded models.
Those cases now have dedicated publication and direct-build regression tests.
A fresh comparison of all eight shipped samples, five synthetic designs, and
Wiha retained byte-identical final displayed meshes, exact volumes, and export
material meshes relative to the original baseline. The new rounded preview tier
is separately checked for preserved rounding feedback, closed indexed topology,
input immutability, and exclusion from exports.

Three-build handler medians on the same M5 Max measured 134 ms for the normal
Wiha draft, 876 ms for its coarser rounded preview, and 1,624 ms for full detail.
The rounded tier is used for fillet-only edits; ordinary edits retain the faster
unrounded draft. Complex fillet tuning and section cuts can still take noticeable
time. The single rounded rectangular test design takes the direct path, avoiding
both the 300 ms idle wait and a temporary sharp opening. These handler measurements
exclude browser paint, scheduling, transfer, and startup costs.
