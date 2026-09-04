# CLAUDE.md

This file is the single source of truth for all agents and tools working in this repository.

## Project Overview

Pocketry is a web application that converts raster images (PNG, JPG) into editable
vector outlines and printable Gridfinity tool bins. Users upload images, detect the
tool's silhouette (including concave regions and interior holes), calibrate it to real
dimensions, refine the rings, and export SVG, DXF, DWG-compatibility, or STL files.
Calibrated traces can also be handed to the bin designer, arranged as pockets, and
exported as 3MF or STL; top-down bin layouts export as SVG or DXF for shadow boards and
CNC work.

The Gridfinity G1–G5 bin software scope is implemented: bins support
full/half/quarter pitches, configurable preview/material colors, and
single- or multi-color 3MF export. Baseplate generation is intentionally left
to dedicated Gridfinity tools. Optional server persistence and lower-priority
upstream parity remain deferred. The G1 empty-bin and G3 real-tool physical
print gates are still pending. See `docs/gridfinity-plan.md` for the completion
ledger and roadmap.

## Objectives

- Preserve code integrity: correctness, backward compatibility, style.
- Encourage incremental improvement: refactor only with justification and coverage.
- Keep docs/tests current with each change.

## Repository Structure

```
client/               # React 18 frontend (Vite)
  index.html
  public/             # Static assets, incl. bundled OpenCV.js (the only copy)
  src/
    components/
      layout/         # App shell: header, workspace split, panel + canvas slots
      canvas/         # Content-agnostic viewport frame (SVG today, WebGL later)
      trace/          # The tracing workspace: canvas, scene, controls, ring list
      gridfinity/     # Bin controls, 3D viewport, and top-down layout editor
      help/           # Help dialog
      ui/             # shadcn/ui primitives
    hooks/            # use-element-size, use-viewport-transform, use-toast, ...
    lib/
      calibrate/      # ArUco sheet: template SVG, marker detection, scale solver
      detect/         # Segmentation → score field → threshold (OpenCV + JS backends)
      geometry/       # Rings: hierarchy, simplification, tracing, offsetting, hit-test
      export/         # SVG / DXF / STL writers, and the one px→mm + Y-flip boundary
      gridfinity/     # Gridfinity solids, pockets, features, and worker handlers
      manifold/       # manifold-3d runtime loader and the WASM-handle Arena
      mesh/           # Mesh conversion and deterministic 3MF serialization
      project/        # Versioned ProjectDoc persistence over IndexedDB
      worker/         # Typed worker RPC with supersede + cancel
    pages/            # Routed workspaces (wouter)
    state/            # Trace/bin reducers and the cross-workspace shape library
server/               # Express backend
  index.ts            # App entry — serves API + Vite middleware on port 5000
  routes.ts           # REST API (/api/images CRUD, session-scoped)
  storage.ts          # IStorage abstraction; currently MemStorage only
  vite.ts             # Dev-mode Vite middleware integration
shared/
  schema.ts           # Drizzle table definitions + Zod schemas (client + server)
  geometry/           # Dependency-free ring types, ring maths, and scale/calibration
  gridfinity/         # Bin/project schemas, constants, placement, and validation
drizzle.config.ts     # Drizzle Kit migration config (PostgreSQL / Neon)
vite.config.ts        # Vite build config
vitest.config.ts      # Test config (mergeConfig over vite.config.ts)
```

### Geometry model

Outlines are **rings**, not a flat point list: `Outline = Shape[]`, where
`Shape = { outer: Ring; holes: Ring[] }` and a `Ring` is implicitly closed (never repeat
the first point). This is what lets a concave tool and its interior holes be represented
at all.

**Orientation is an invariant, not a runtime check**: outer rings have positive signed
area, holes negative. It holds in both the y-down image frame and the y-up millimetre
export frame, which is why `flipOutlineY` reverses each ring as well as negating y.
Offsetting, triangulation and STL winding all depend on it, so anything producing rings
must run them through `normalizeOutline`.

**px→mm and the Y-flip happen exactly once**, at the export boundary
(`lib/export/scale.ts`). Do not add a second conversion — the exporters previously
disagreed about Y, which shipped mirrored STLs.

## Git

- Author: Will Cobb <will.cobb@sugarcreekresearch.com>
- Never add Co-Authored-By lines

## Runtime & Dependencies

- Node.js 22, npm with a committed `package-lock.json`.
- Use `npm ci` for clean installs (sandbox/CI); `npm install` only when intentionally changing dependencies.
- New dependencies go into `package.json` with a rationale — no ad-hoc one-off installs.
- **Licence policy:** record the licence and provenance of every direct dependency,
  bundled artefact, and adapted source. New code must be compatible with Pocketry's
  distribution model; copyleft and source-available terms require an explicit
  compatibility review before they are linked, bundled, or ported. Pocketry's original
  work ships under AGPL-3.0-only (`LICENSE`); third-party portions retain their own
  licences and attribution in `NOTICE`, which must be updated whenever a direct
  dependency, bundled artefact, or adapted source is added.
- ArUco specifics: marker *patterns* and OpenCV's aruco module (Apache-2.0, in
  `objdetect` since 4.7) are the sanctioned sources — Pocketry's custom v2
  dictionary is deterministically generated with OpenCV 4.11.0, pinned in
  `client/src/lib/calibrate/aruco-4x4.ts`, and covered by NOTICE attribution.
  The standalone
  ArUco library from the University of Córdoba is **GPLv3 and specifically
  off-limits**, including as a porting reference.
- Keep one major version of Vite in the tree. Vitest must dedupe onto the app's Vite so tests transform what actually ships (this is why Vitest is pinned to v3 while the app is on Vite 5).
- `manifold-3d` (Apache-2.0) is the single geometry kernel — Clipper2-backed 2D offsetting, triangulation, and CSG. Do not add a second geometry library (`earcut`, `polygon-clipping`, `clipper-lib`); two kernels disagree at the seams.

## Build & Development Commands

```
npm ci               # Install dependencies from lockfile
npm run dev          # Express + Vite dev server with HMR on http://localhost:5000
npm run build        # Vite bundles client to dist/public; esbuild bundles server to dist/index.js
npm run start        # Run the production build
npm run check        # TypeScript type-check (tsc)
npm test             # Vitest (run once)
npm run test:watch   # Vitest in watch mode
npm run db:push      # Push Drizzle schema to the database (needs DATABASE_URL)
```

**`npm run check && npm test` is the required gate for every change.**

Vitest config lives in its own `vitest.config.ts` that `mergeConfig`s `vite.config.ts` —
never add a `test` key to `vite.config.ts`, because `server/vite.ts` imports that file
into the bundled Node server. Two projects are configured: `geometry` (node env, covers
`shared/**` and `client/src/lib/**`) and `ui` (jsdom, covers components/hooks/pages/state).
Tests are type-checked — `tsconfig.json` deliberately does *not* exclude `*.test.ts`.

No linter is configured yet (prefer ESLint when one lands).

## Code Conventions

- TypeScript strict mode; no `any` unless annotated with a reason.
- Path aliases per `tsconfig.json` (`@/...` for client src, `@shared/...` for shared).
- Shared validation lives in `shared/schema.ts` as Zod schemas derived from Drizzle tables (`drizzle-zod`); never duplicate validation logic client- or server-side.
- Storage access goes through the `IStorage` interface in `server/storage.ts` — do not reach around it to Drizzle directly from routes.
- UI: compose shadcn/ui components from `client/src/components/ui`; TailwindCSS for styling, with the shadcn design tokens defined as CSS variables at the top of `client/src/index.css`; `lucide-react` for icons.
- No Replit-specific tooling. The app builds and runs anywhere with plain Node — do not reintroduce `@replit/*` plugins or a `theme.json`.
- Server state via TanStack Query; local state via React hooks; routing via wouter.
- Image processing runs client-side (canvas + OpenCV.js); keep heavy processing off the server.
- Detection has **one** pipeline (`lib/detect/pipeline.ts`) with two interchangeable
  backends — OpenCV and pure JS — that must stay behaviourally equivalent. The JS one is
  a real fallback and the reference implementation, not a degraded second mode. Never
  reintroduce a parallel "experimental" path.
- OpenCV and manifold are **injected, never imported** by geometry code (`cv` and
  `Kernel` are parameters). That is what lets the same modules run on the main thread, in
  a worker, and under Vitest in Node.
- WASM handles from manifold (`Manifold`, `CrossSection`) and OpenCV (`cv.Mat`) are not
  garbage collected. Track every one in an `Arena`/`MatScope` disposed from a `finally`.

## Agent Working Principles

1. Ask if unclear, don't assume.
2. One PR = one concern. Small diffs, full tests.
3. Evidence beats speculation. Include test proof or benchmark.
4. All code must be typed and documented.
5. All new code must have tests.

## Guardrails

- No hard-coded secrets or tokens (`DATABASE_URL` and friends come from the environment).
- No dependency bumps without rationale.
- No unreviewed performance-critical refactors.
- All changes tested and documented before PR.

## Human Oversight

- Human reviewers own final merges.
- Agents may propose and test PRs but must not merge.
