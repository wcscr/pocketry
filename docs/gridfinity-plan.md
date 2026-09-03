# Gridfinity bin generator — design and roadmap

**Status: G1–G5 software scope landed (G5 on 2026-08-24); both *print gates*
are pending** — G1: print `exports/bin-2x3x6.3mf` and verify grid fit and
stacking; G3: trace a real tool, export its bin, print it, and put the tool in
the pocket. Optional server persistence remains deferred.

Nonrectangular bin footprints landed on 2026-08-27. A bin can now use a
connected, hole-free mask at the selected full/half/quarter pitch, so a 2×2
three-cell mask produces a true L-shaped base, body, wall, and stacking lip.
**Fit bin to contents** preserves relative pocket placement while choosing the
smallest rectangular grid, and Auto-arrange also returns a rectangle. Irregular
connected, hole-free masks are an explicit Layout → Edit footprint option. The
exact footprint is shared by live validation, the 2D editor, worker geometry,
and layout DXF/SVG export. Label tabs can anchor to a specific exterior or
re-entrant boundary edge. Rectangular projects retain the original geometry
path, and schema-v1–v3 projects migrate to an explicit rectangular footprint. A
shaped-bin physical gate remains: print a full-pitch
2×2/three-cell L, verify baseplate fit and the concave wall/lip, stack a matching
footprint, then print an L-tool pocket and check its fit.

G4 delivered **finger holes**, now independent bin-local layout objects rather
than children of a tool pocket. They can be straight cylinders with their own
depth, spherical round scoops, round deep scoops, or oblong deep scoops from the
top surface. Deep
scoops run straight down for the requested shaft depth and terminate in a
rounded bottom, so total depth can exceed the opening width without an
inward-overhanging cavity. The oblong variant has a capsule mouth and swept
hemisphere bottom; it can be moved as a unit, rotated directly, or resized and
rotated by dragging either endpoint. Every hole type has a mouse diameter/width
handle; oblong holes additionally expose both end handles. Round-scoop depth
remains capped at half the opening width. Moving, duplicating, deleting, or
auto-arranging a pocket does not move or remove a hole. **Auto-arrange** uses a
min-area OBB per cutout and shelf-packs pockets into the smallest grid while
leaving independent holes fixed; **undo/redo** covers the material document
`{spec, cutouts, fingerHoles}` (hand-rolled history in the bin reducer, mirroring the
trace store, rather than the zustand+zundo sketched below — drags collapse
to one step via transient dispatches). Both Trace and Bin expose the labeled
history beside Undo/Redo and can jump directly to any retained step; contour
node add, remove, and move gestures are distinct entries. Continuous slider
drags commit as one entry rather than consuming the history frame-by-frame. A
preview-only **section view**
(`trimByPlane`, stats stay whole-bin, exports never cut); explicit
**named Project Library save/open** on top of the autosave; portable
`.pocketry.json` backup import/export (legacy `.tooltrace.json` remains accepted);
and per-pocket duplicate. The Project
section is pinned to the top of the Bin controls: a draft resumes automatically,
Save gives it a library name, Open presents the browser-local named projects,
and New detaches a clean draft without deleting saved projects. The library is
implemented entirely over IndexedDB so its behavior is consistent across modern
browsers; JSON remains an explicit backup/transfer path whose download location
is browser-controlled.

Continuous size and feature controls now rebuild the 3D model only after the
pointer is released: transient slider and drag positions update the controls,
while the geometry worker consumes the last committed history document. The
interactive build also uses a preview-only quality tier (24-segment arcs, a
100-vertex contour budget, and 0.5 mm fillet profile bands). Export remains at
64 segments, 600 vertices, and 0.1 mm bands, so responsiveness never changes
the saved model. A local Node 22 real-WASM probe with two 150-point pockets and
both top and bottom fillets fell from about 9.1 s to 0.59 s (roughly 15×
faster). During any remaining rebuild, the last valid model stays visible and
prominent progress appears both over the 3D view and beside the size controls.
Width and length are shown in standard 42 mm cells and accept half-cell steps;
selecting a fractional span promotes a rectangular bin to the existing 21 mm
half-pitch socket lattice without changing its untouched axis. Height accepts
0.5u steps (3.5 mm) while retaining the 1u minimum required by the base.

The Bin Layout view also supports **selected-pocket contour editing** without a
round trip through Trace: drag vertices, click an edge to insert a point, and
right-click a point to remove it. Each committed gesture creates an immutable
shape revision and updates only the selected pocket, so the worker cache is
invalidated correctly and Bin undo/redo can switch between contour revisions.
The pocket list now explicitly prompts selection before showing these controls;
the selected tool name is editable in place. A per-pocket **fit-template STL**
exports the filled outside silhouette at a user-selected 0.5–30 mm thickness,
including Trace margin, extra pocket clearance, and outline corner rounding but
excluding the bin, interior detection holes, and finger-access features.
The right-side Layout toolbar begins with a 2D ruler: two clicks snap to
visible tool contours and display their planar separation in millimetres. The
ruler is intentionally unavailable in the 3D preview.

G5 completed its local software scope (2026-08-24): the 3D camera now re-fits whenever the bin's
outer dimensions change (preserving the orbit direction), the ground grid
scales with the bin, and the **top-down layout DXF/SVG export** landed —
bin footprint plus pocket silhouettes and independent finger-hole rims in real
millimetres, the CNC shadow-board bridge. The **label tab** is ported
(upstream `TAB_POLYGON` @ the pinned SHA): full-width or 42 mm
left/center/right on any wall, fused into the wall part, with
`label-tab-clipped` and `label-tab-shadow` warnings. **Crush ribs** are in
too — upstream `ribbed_cylinder()`, eight sinusoidal lobes between ⌀5.9
and ⌀6.5 for glue-free press-fit magnets, a per-spec toggle under Magnet
holes. The **lite base** landed as well: hollow thin-shell sockets under a
chamfered bridge lattice with a 1.2 mm floor (`spec.liteBase`; holes are
ignored there with a warning until bosses are ported). **Half/quarter grid**
landed as explicit 21/10.5 mm pitch modes while retaining the upstream 0.5 mm
gap; fractional magnet/screw patterns are disabled until the corner-only hole
layout is ported. Baseplate generation was intentionally removed from
Pocketry; dedicated Gridfinity tools cover that workflow. The only remaining
G5 item is optional server persistence.

ArUco auto-calibration also landed (2026-08-14): photographing the tool on the
printable calibration sheet sets the scale automatically on image load
(least-squares mm/px over all detected marker pairs, skew warning past 2%
pair disagreement), with a manual "Detect markers" button and a hint toast
when a non-Pocketry marker sheet (Original ArUco / 5×5 / 6×6 / 7×7 /
AprilTag) is recognised instead. Detection reads a 1600px frame — small
markers blur out at the 800×600 working resolution. Calibration-sheet v2 uses
a Pocketry-specific custom 4×4 dictionary, requires all four paper-specific
markers, and rejects the stock 4×4 IDs used by generic generators. Before any
scale is proposed, all 16 refined corners must fit the signed sheet geometry
under one homography. Detection and correction results are bound to the source
image and mapped back with exact per-axis factors, so late work from a replaced
photo cannot paint stale rulers or markers. The four-page-corner manual fallback
remains available when markers cannot be used.

G3 delivered the trace → bin integration: "Add to bin" in the trace panel
(hard-gated on calibration — the uncalibrated-scale footgun stops at the
door), an app-level shape library that survives workspace navigation, auto
placement + auto bin sizing (shelf packing, smallest fitting grid), the 2D
layout editor (drag/rotate/snap/nudge with live per-cutout validation
painting and export gating), the pocket pipeline in the worker (vertex
budget → placement transform → clearance → corner round → K-slice bottom
fillet → subtract, with per-cutout `emptied` reports instead of throws), and
the versioned ProjectDoc autosave to IndexedDB (`idb-keyval`, Apache-2.0 —
the plan listed it as MIT; still policy-clean). Solid fill became the schema
default.

G2 delivered the `/bin` workspace: an r3f viewport (three 0.180 + fiber 8 +
drei 9 — ^0.180 rather than the planned ^0.185, staying inside drei v9's
supported window on React 18), the first geometry bound to the worker RPC
(`bin.worker.ts` + `useBinGeometry`, 120 ms debounce, supersede channel,
progress, and configurable body, pocket-floor, and stacking-rim material
groups controlled from View Settings), magnet/screw holes ported from
`gridfinity-rebuilt-holes.scad`
(sequential-bridging ceilings included; crush ribs later landed in G5, while
Refined remains deferred), and
3MF/STL export from the page at export quality. The 3MF flow asks whether to
export one material or a slicer-ready multi-color assembly. Selected blind
pocket floors and the stacking-rim crest become configurable, separate,
non-overlapping material volumes alongside the configurable bin body. Their
default display/material color is pure black, while the body retains its
orange default. Their
depths are independently selectable from 0.2–3.0 mm for pocket floors and
0.2–7.35 mm for the stacking rim (0.6 mm pocket-floor and 1.25 mm rim
defaults). The rim limit is the full
modeled lip depth and does not extend into the bin wall. Both accents are cut
downward from the original surfaces, never added above them; STL warns before
dropping those color assignments. Hole regression worth
remembering: abutting union pieces whose faces share no vertices don't weld —
the genus invariant caught the resulting sealed voids; pieces now overlap.

What landed for G1, all invariant-tested (`shared/gridfinity/`,
`client/src/lib/gridfinity/`, `client/src/lib/mesh/`):

- Ported constants + profiles pinned at upstream `910e22d8`, provenance in
  `client/src/lib/gridfinity/UPSTREAM.md`, MIT text in `NOTICE`.
- `sweepRounded` (the ~80% primitive), validated against a closed form
  (prisms + faceted Pappus, 1e-6) and two independent oracles — a hull stack
  and `minkowskiSum` (which the JS bindings do expose).
- Base/wall/lip/bin builders returning tagged parts (the multicolor hook),
  with exact-bbox, genus, status, closed-form-volume tests, and a **software
  mating test**: a base seated in the lip clears at the spec's 0.35 mm and
  collides past it.
- 3MF (fflate, multi-object, deterministic) + binary STL via the writer split
  out to `lib/export/stl-writer.ts`; `npm run export:bin` emits both.
- **Risk #1 retired**: the K-slice stepped bottom fillet on a synthetic
  200-vertex ring builds in ~18 ms + subtracts in ~0.1 ms (14 slices at
  0.2 mm) — no memoization needed at G3 scale.
- One API drift from this plan: current manifold deprecates non-zero normal
  channels, so it is `calculateNormals(0, 60)` + `getMesh()`, not `(3, 60)` +
  `getMesh(3)`.

This is the durable half of a larger plan. The other half — rewriting outline detection
onto a ring model and rebuilding the workspace layout — is complete, and its rationale
now lives in `CLAUDE.md` and in the code. What follows is the part with shelf life.

## Goal

Pocketry traces physical tools from photos into 2D outlines. This feature turns those
outlines into **pockets in custom Gridfinity bins**: several tools per bin, finger
scoops, printable output. The reference for geometry quality is
[`gridfinity-rebuilt-openscad`](https://github.com/kennetek/gridfinity-rebuilt-openscad)
(MIT); the reference for UX is gridfinitygenerator.com (closed source, not usable).

## Decisions already made

- **Port the MIT OpenSCAD geometry to TypeScript and build solids with `manifold-3d`.**
  `openscad-wasm` and `andymai/gridfinity-layout-tool` were not used; Pocketry's
  implementation is the independently maintained port identified in `NOTICE`.
- **Multicolor is out of scope**, with one no-cost hook preserved (see Milestones).
- Every dependency and ported file requires provenance plus compatibility review under
  the project-wide licence policy in `CLAUDE.md`.

## What already exists

These landed during the tracing rewrite specifically so this phase would not be a
rewrite. Verify against the code before relying on any detail here.

| Foundation | Where | Notes |
|---|---|---|
| AGPL-3.0-only `LICENSE` + `NOTICE`, licence policy | `LICENSE`, `NOTICE`, `CLAUDE.md` | Third-party portions retain their own licences; NOTICE carries Manifold's Apache-2.0 attribution |
| Ring model with enforced orientation | `shared/geometry/types.ts`, `shared/geometry/rings.ts` | outer rings positive signed area, holes negative |
| px→mm and the single Y-flip | `shared/geometry/scale.ts`, `client/src/lib/export/scale.ts` | conversion happens exactly once, at the export boundary |
| `manifold-3d` as *the* geometry kernel | `client/src/lib/manifold/runtime.ts` | resolves in Vite dev, Vite build, and Node/Vitest |
| WASM handle lifetimes | `client/src/lib/manifold/arena.ts` | `Arena` / `withArena`; handles are not GC'd |
| Kernel injection | `Kernel` in `runtime.ts`, used by `client/src/lib/geometry/offset.ts` | never import the singleton from geometry code |
| 2D offsetting + Clipper2 | `client/src/lib/geometry/offset.ts` | `toCrossSection`, `outlineToPolygons` are reusable here |
| Worker RPC with supersede + cancel | `client/src/lib/worker/{client,host,protocol}.ts` | typed, tested; bin geometry is bound to it |
| Correct binary STL writer | `client/src/lib/export/stl.ts` | real per-facet normals, extrude via `CrossSection` |
| Content-agnostic viewport | `client/src/components/canvas/canvas-viewport.tsx` | a three.js `<canvas>` drops in unchanged |
| Data-driven route registry | `client/src/components/layout/workspaces.ts` | adding `/bin` is one entry |
| Panel + canvas workspace shell | `client/src/components/layout/workspace-layout.tsx` | `autoSaveId` per workspace |
| Vitest, node + jsdom projects | `vitest.config.ts` | geometry tests run headless with real WASM |

The previously missing `ProjectDoc` is now implemented with `schemaVersion: 7`,
IndexedDB autosave plus a named Project Library, explicit `.pocketry.json`
backup import/export with legacy `.tooltrace.json` import compatibility, and
reducer-owned undo/redo.

## Approach

**The whole port hinges on one upstream primitive.** `sweep_rounded(size)` in
`src/helpers/generic-helpers.scad` is 4 × `linear_extrude` along the edges of a rectangle
plus 4 × `rotate_extrude(angle=90)` at the corners, unioned — and the base, the stacking
lip, and the lite chamfer all go through it. That maps 1:1 onto `CrossSection.extrude()`
and `CrossSection.revolve()`. **That single primitive is ~80% of the port.**

It is exact rather than approximate (modulo circular segment count), because sweeping is
a Minkowski sum, and the union of per-edge and per-vertex pieces equals the Minkowski sum
of the whole path.

Constants to port into `shared/gridfinity/standard.ts` (verified against upstream
`src/core/standard.scad`):

- grid 42 × 42 mm, height unit 7 mm
- `BASE_PROFILE = [[0,0],[0.8,0.8],[0.8,2.6],[2.95,4.75]]`
- base top 41.5 mm, base gap 0.5 mm, `BASE_TOP_RADIUS 3.75`, `BASE_BOTTOM_RADIUS 0.8`,
  `BASE_BRIDGE_HEIGHT 2.25`
- `STACKING_LIP_LINE = [[0,0],[0.7,0.7],[0.7,2.5],[2.6,4.4]]` — lip intrudes 2.6 mm, is
  4.4 mm tall, support height 3.8 mm
- `d_wall 0.95`, `r_f2 2.8`, `d_div 1.2`
- magnet ⌀6.5 × 2.4 deep (refined 5.86), screw r 1.5, `LAYER_HEIGHT 0.2`

Fillets decompose cleanly: **vertical edge rounding is 2D**
(`cs.offset(-r,'Round').offset(+r,'Round')`); **the bottom edge fillet is 3D** — subtract
a quarter-round complement swept along the ring. `minkowskiSum` exists in manifold 3.x but
is convex-decomposition-based and slow: use it as a test oracle, never in the build path.

## Module layout

```
shared/gridfinity/            standard.ts (ported constants) · types.ts (+ zod) · validate.ts · migrate.ts
client/src/lib/gridfinity/    profiles · sweep · holes · base · wall · cutouts · bin · UPSTREAM.md
client/src/lib/mesh/          meshData · toBufferGeometry · stl · threemf · download
client/src/components/gridfinity/  BinDesigner · BinViewport3D · LayoutCanvas2D · panels/*
client/src/pages/bin-designer.tsx
```

**Hard rule: the gridfinity layer never imports the manifold singleton.** It takes a
`Kernel` (`{ Manifold, CrossSection, triangulate, setQuality, arena }`) by injection, so
the same code runs in the worker, under Vitest in Node, and on the main thread for
debugging. This rule is already established by `client/src/lib/geometry/offset.ts` —
follow that file's shape.

## Cutout model

```ts
interface CutoutPlacement {
  id: string; shapeId: string;
  position: Vec2; rotationDeg: number; mirrored: boolean;   // mm, bin-local, Y-up
  depth: { mode: 'through' } | { mode: 'mm'; value: number }
       | { mode: 'remaining'; floorThicknessMm: number };
  clearanceMm: number;      // 0.0 — optional extra after Trace margin
  cornerRoundMm: number;    // 1.0 — 2D vertical edge round
  topFilletMm: number;      // 0.0 — top-surface pocket-edge round-over
  bottomFilletMm: number;   // 2.8 (r_f2), clamped to depth/2
}

interface ProjectDoc {
  cutouts: CutoutPlacement[];
  fingerHoles: FingerHole[]; // independent bin-local layout objects
}
```

v1 layout is **manual placement on a 2D top-down canvas** — drag, rotate handle,
arrow-key nudge, snapping to 42 mm grid lines, bin edges, and other cutouts. Drag, rotate
and snap are miserable with a 3D gizmo and excellent on a plane. v2 adds auto-arrange
(min-area OBB per shape, then shelf packing); true nesting optimisation is out of scope.

**Validation** (`shared/gridfinity/validate.ts`, pure, no WASM, runs every drag frame):
`out-of-bounds`, `wall-breach`, `lip-collision` (legal at depth but fouls the 2.6 mm lip
at the rim), `cutout-overlap`, a thin-material warning below `d_div = 1.2`, `too-deep`,
`floor-too-thin`, and **`uncalibrated-scale`** — shipping a bin sized from an uncalibrated
photo is the single most likely way a user wastes six hours of print time. Errors block
export; warnings do not.

## Persistence: none server-side in v1

`server/storage.ts` has only `MemStorage` (a `Map`, wiped on restart), there is no Drizzle
implementation and no `migrations/`, and the client never reads anything back. Instead,
the landed client implementation uses a `ProjectDoc` with **`schemaVersion: 7`**, a
hand-rolled reducer history, `idb-keyval` autosave to IndexedDB (not localStorage —
traced shapes plus thumbnails blow past 5 MB), a browser-local named Project
Library with active-project autosave, and explicit `.pocketry.json` backup
import/export (including legacy `.tooltrace.json` imports). Schemas 1–6 migrate
pocket-local finger holes to bin-local coordinates while preserving their
visible position and oblong orientation. The library is cross-browser code,
not cross-device sync: each
browser profile owns its own IndexedDB data.

If server persistence is wanted later it is a `projects` table holding a **JSONB
document**, not normalised rings: the geometry is a tree, edited atomically, and nothing
server-side queries individual rings.

Separately: the fire-and-forget `POST /api/images` was removed from the client
(2026-08-15) — nothing ever read the copies back, and silently uploading every
trace was the wrong default. The server routes remain for a future explicit
opt-in; `images.svgData` must not become the de facto geometry store.

## Export

**3MF as the default** (fflate zip, `<unit>millimeter</unit>`, integer-indexed vertices) —
smaller, unit-carrying, topology-preserving; manifold's own docs discourage STL. STL
second, reusing the existing writer in `client/src/lib/export/stl.ts`. A top-down
**bin-layout DXF/SVG** from the 2D editor is nearly free and ties the CNC shadow-board
product back to the bins. A selected pocket can also export a standalone filled
fit-template STL for a low-material silhouette check before committing to a bin.
For the more reliable multi-tool check, **Complete surface fit test** exports
the bin's full pocket-layout plane as one 0.4–3 mm plate (1.2 mm default), with
the real outer footprint, clearances, top-edge rounds, spacing, and finger
access. It omits the base, wall height, label tab, and stacking lip and moves
the plate to the build plane; it therefore tests surface fit, not pocket depth
or baseplate fit.

Call `manifold.calculateNormals(0, 60)` before `getMesh()` so normals arrive in the
standard vertex-property channel. Using three's `computeVertexNormals()` instead
smooths the base profile's 45° transitions into mush and the preview stops looking like
Gridfinity.

## Performance

Traced outlines carry 500–3000 points per tool, and the exact bottom fillet is O(N)
manifolds — at N=1000 that is catastrophic. Therefore:

- **Always simplify before extruding**: RDP at trace time in mm, then
  `CrossSection.simplify()` before building. Target ≤150 ring vertices for preview and
  ≤600 for export, with the count shown in the UI so the trade-off is legible.
- Cap fillet cost with a K-slice offset stack above a vertex threshold. Sample the
  vertical profile independently of slicer layer height (currently at most 0.1 mm,
  with a quality-dependent angular minimum).
- Preview/export quality presets (~5× triangle difference). Note these are **global** on
  the manifold toplevel, so they are only safe because the worker is single-threaded.
- **Structural-hash memoization split by stage** inside the worker, so the shell is reused
  and only the final subtract re-runs on a drag.
- Debounce 120 ms, supersede with `ExecutionContext.cancel()`, transferables for mesh data.

## Libraries

Landed: `three@^0.180` (MIT), `@react-three/fiber@^8` +
`@react-three/drei@^9` (MIT, kept in their React 18-compatible window),
`idb-keyval@^6` (MIT), and `fflate@^0.8` (MIT). Undo/redo is implemented in the bin
reducer rather than adding `zustand` + `zundo`.

## Attribution

`NOTICE` must gain the full MIT text for `gridfinity-rebuilt-openscad` © 2023 Kenneth
Hodson. Every ported file gets a header naming the upstream file and a pinned SHA;
`client/src/lib/gridfinity/UPSTREAM.md` holds the provenance table so re-syncing upstream
is mechanical. Do not vendor the `.scad` files — it muddies what was actually ported.

`threads-scad` (thumbscrews) is a third-party library vendored *inside* upstream. Check
its licence independently before porting, and drop the feature if it is not permissive.

## Milestones

| | Demo | Contents |
|---|---|---|
| **G1** | Export a correct empty 2×3×6 bin **and print it** | constants, sweep primitive, base/wall/bin, 3MF writer, invariant tests |
| **G2** | Live 3D preview reacting to sliders without jank | r3f viewport, `/bin` workspace, worker pipeline with supersede/cancel/progress, magnet + screw holes |
| **G3** | A photographed screwdriver becomes a printable pocket — **print it and put the tool in it** | shape library + `normalizeTracedShape`, cutouts (clearance, corner round, bottom fillet, depth modes), 2D placement editor, live validation |
| **G4** | 4-tool bin with scoops and finger holes, saved and reloaded | scoop, finger holes, auto-arrange, undo/redo, project save/load, `trimByPlane` section view |
| **G5** | Parity and polish | label tab, crush ribs, lite base, half/quarter grid, layout DXF/SVG, optional server persistence |

**G1 and G3 are physical print gates.** Dimensional correctness is not verifiable any
other way; no amount of unit testing substitutes for putting the tool in the pocket.

**Multicolor hook (deferred, costs nothing now):** have `buildBin()` return tagged parts
(`{ base, wall, lip, infill }`) internally rather than one fused `Manifold`. 3MF expresses
multiple objects and manifold preserves property runs across booleans, so a future
multi-material export needs no restructuring.

## Testing

Invariants over golden meshes. Byte-level goldens go permanently red on any manifold
version bump or quality change; store *golden invariants* instead —
`{ volume, area, genus, bbox, triCount ±10% }` per named spec.

- `status() === 'NoError'` on every built solid.
- `genus()` — an empty bin is 0, blind magnet holes stay 0, through-holes increment. A
  good trap detector.
- `volume()` against an analytic value; `boundingBox()` exact (a 2×3 bin is
  83.5 × 125.5 mm, `min.z === 0`).
- The sweep primitive against a closed form, and one small case against `minkowskiSum` as
  an independent oracle.
- Every rule in `validateBin`, which is pure and needs no WASM.

## Top risks

1. **Bottom-fillet cost on high-vertex outlines** — the highest-uncertainty item here.
   Prototype against a synthetic 200-vertex ring during G1, *before* any UI exists.
2. **Constant-angle draft is not a native manifold op.** `extrude(..., scaleTop)` is a
   scale, not an offset; the two coincide only for circles. A K-slice offset stack is the
   honest implementation. Consider dropping draft from v1 entirely — for FDM pockets,
   clearance is what matters.
3. **WASM memory discipline.** Manifold handles are not garbage collected; without the
   arena convention this leaks and hard-crashes the tab. Enforce in review.
4. **Coordinate-frame confusion** (px/mm, Y-down/Y-up, bbox-centred vs image-origin). Not
   theoretical: the pre-rewrite exporters disagreed about Y and shipped mirrored STLs.
5. **React 18 pins the R3F stack** to v8/v9. A React 19 upgrade is a separate decision
   with its own blast radius — do not let it become implicit.
6. **Dimensional correctness is only verifiable by printing.** Budget the G1 and G3 print
   gates as real schedule.
