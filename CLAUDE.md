# CLAUDE.md

This file is the single source of truth for all agents and tools working in this repository.

These public instructions apply to contributors and maintainers. Read
`CLAUDE.local.md` at the repository root if present, or `AGENTS.local.md` if that
is the local file in use, for personal preferences and maintainer context.
Both are optional and gitignored; never commit them or copy their private
contents into public documents. Local preferences supplement
these rules and do not waive contributor licensing, provenance, human credit,
or verification requirements.

## Project Overview

Pocketry is a browser-based tool for tracing photographs into editable,
calibrated outlines and designing printable storage bins and positioning fixtures.
The **Trace** workspace handles detection, contour editing, measurement, and
perspective correction. **Bin** combines traced or drawn pockets with finger
access, hollow compartments, label tabs, text, and material colors. Bins support
full/half/quarter Gridfinity pitch, custom footprints, and arbitrary rectangular
flat-bottom sizes. The `/ultim8` entry starts Wham Bam Systems ULTIM8-compatible
fixtures. Baseplates are outside the application's scope.

Exports include single- or multi-color 3MF, STL, fit checks, and SVG/DXF outlines
and layouts. Processing, geometry generation, autosave, and the named project
library run on the user's device. Editable project/library downloads provide
backups; there is no server-side project storage or cross-device sync.

Slanted walls, linking, and grouping have experimental editing controls; saved
designs remain visible and exportable. See [the documentation index](docs/README.md)
and [bin implementation reference](docs/gridfinity-plan.md) for current behavior
and source locations. The [sample library](samples/README.md) includes physical
print evidence; a software or export check alone does not qualify every feature
or printer/material combination.

[GitHub issues](https://github.com/wcscr/pocketry/issues) hold enhancement requests,
problem reports, and the roadmap. Keep documentation about current behavior and
constraints; link relevant issues rather than maintaining a second roadmap here.

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
server/               # Local editor/static-asset host
  index.ts            # App entry — serves Vite or built assets on port 5000
  app.ts              # App factory; rejects retired /api routes before SPA fallback
  vite.ts             # Dev-mode Vite middleware integration
shared/
  geometry/           # Dependency-free ring types, ring maths, and scale/calibration
  gridfinity/         # Bin/project schemas, constants, placement, and validation
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

- Use the actual contributor's Git identity; do not overwrite an outside
  contributor's author with the maintainer's name.
  Git attribution does not establish copyright ownership or replace an assignment.
- Preserve authorship and copyright notices when integrating contributions.
  Use accurate human Co-Authored-By credit when a squash or combined commit would
  otherwise lose it. For outside contributions with material AI assistance,
  include and preserve tool Co-Authored-By credit under `CONTRIBUTING.md`.
  Maintainer work covered by the standing project acknowledgment need not repeat
  AI credit in every commit or PR. Tool credit does not establish copyright
  ownership or authority to accept the CLA. Do not invent authors.
- Keep commit messages, PR titles/descriptions, and review comments brief and
  concise. Include only the change, its purpose, and essential validation.

## Contributions and licensing

- Follow `CONTRIBUTING.md` and the maintainer checklist in
  `docs/contribution-maintenance.md`. All original contributions are submitted under
  AGPL-3.0 (version 3 only, as defined in `CLA.md`). Contributors retain copyright;
  the separate CLA grants Sugarcreek Research, LLC permission for additional licensing, including
  proprietary licensing. Do not call this a copyright ownership assignment.
- The CLA does not itself require publication of private submissions or privately
  licensed versions, or create confidentiality or embargo obligations. Contributions
  incorporated into the public repository are published under AGPL-3.0;
  applicable third-party license obligations and existing AGPL grants still apply.
  Only the Company receives the additional copyright grant directly; others need
  an authorized sublicense to exercise those additional copyright permissions.
- Follow `CLA.md`. Do not treat past submissions as having accepted it.
  Maintainers must verify each rights holder's explicit acceptance of the exact
  published agreement version and current authority before public or private
  incorporation. The acceptance statements include the default version link;
  maintainers verify and retain the exact accepted revision and record account IDs, acceptance
  evidence, and the submitted PR's base commit; do not make contributors manage
  these records or guess an unversioned patch's patent scope. Reuse valid acceptance
  rather than collecting it again on every PR. Agents cannot accept for anyone.
  Keep private contributor records and legal documents out of public commits and PRs.
- Every contribution needs a dependency/provenance review, including an explicit
  "None added or changed" when applicable. Review AGPL compatibility and the
  ability to use/distribute the actual integration under proprietary terms,
  affected transitive components, copied/adapted code and assets, security
  advisories, and delivered notices.
  Contributors disclose known facts and uncertainty; maintainers complete the
  detailed compatibility and notice checks. Third-party rights cannot be expanded
  by the CLA. Record the review in the PR
  or, for local-only work, its accompanying review note.
- Follow the AI attribution policy in `CONTRIBUTING.md`, including disclosure of
  known restrictions or provenance uncertainty. Routine autocomplete/formatting
  needs no separate log; do not include confidential prompts or credentials.

## Versions & Changelog

- About reads `package.json`; keep `package-lock.json` in sync when bumping it.
- Add notable user-visible changes to **Unreleased** in `CHANGELOG.md`. Keep
  entries to a few short bullets describing the user impact. Contributors include
  the entry with their change; maintainers check, edit, and combine entries.
  Documentation-only changes, tests, and internal-only refactors usually need none.
- On release, use major/minor/patch versioning and a dated changelog section,
  newest first. Maintainers own release versions and dates. Application and
  saved-project schema versions are independent.
- Update affected current documentation in the same change. Keep dated design
  and validation records clearly historical; track planned work in GitHub issues.

## Runtime & Dependencies

- Node.js 22, npm with a committed `package-lock.json`.
- Use `npm ci` for clean installs (sandbox/CI); `npm install` only when intentionally changing dependencies.
- New dependencies go into `package.json` with a rationale — no ad-hoc one-off installs.
- **Licence policy:** record the licence and provenance of every direct dependency,
  bundled artefact, and adapted source, and review affected transitive components.
  New material must support Pocketry's AGPL distribution and future proprietary
  licensing; copyleft, source-available, and custom terms require an explicit
  review of the actual integration and obligations before inclusion. Development
  tools need not be relicensed with the app; review their redistributed output
  and any distribution of the tools themselves. Do not accept material whose
  obligations cannot be met in the intended use under both models. Pocketry's
  original work ships under AGPL-3.0 (`LICENSE`); third-party portions retain their own
  licences and attribution in `NOTICE`, which must be updated whenever a direct
  dependency, bundled artefact, or adapted source is added. Required third-party
  notices must reach recipients even when code is bundled; package metadata alone
  is not proof that a shipped artifact contains them.
- ArUco specifics: marker *patterns* and OpenCV's aruco module (Apache-2.0, in
  `objdetect` since 4.7) are the sanctioned sources — Pocketry's custom v2
  dictionary is deterministically generated with OpenCV 4.11.0, pinned in
  `client/src/lib/calibrate/aruco-4x4.ts`, and covered by NOTICE attribution.
  The standalone
  ArUco library from the University of Córdoba is **GPLv3 and specifically
  off-limits**, including as a porting reference.
- Keep one major version of Vite in the tree. Vitest must dedupe onto the app's Vite so tests transform what actually ships. Vite 6 and Vitest 4 share the same installed Vite; keep Vitest and its coverage package on matching versions.
- `manifold-3d` (Apache-2.0) is the single geometry kernel — Clipper2-backed 2D offsetting, triangulation, and CSG. Do not add a second geometry library (`earcut`, `polygon-clipping`, `clipper-lib`); two kernels disagree at the seams.

## Build & Development Commands

```
npm ci               # Install dependencies from lockfile
npm run dev          # Express + Vite with HMR on loopback http://127.0.0.1:5000
npm run build        # Vite bundles client to dist/public; esbuild bundles server to dist/index.js
npm run start        # Run the production build
npm run check        # TypeScript type-check (tsc)
npm test             # Quick unit/component/small-geometry checks (default)
npm run test:quick   # Same quick suite, explicitly named
npm run test:geometry # Detailed geometry/export qualification (2 workers)
npm run test:workflows # Bin-designer UI workflows, grouped by feature
npm run test:full    # All quick, geometry/export, and workflow tests
npm run test:watch   # Quick suite in watch mode
npm run test:coverage # Coverage across the full suite
```

**`npm run check && npm test` is the routine gate for every change.** `npm test`
runs the quick suite. Add the relevant qualification/workflow tests below; a quick
pass alone does not qualify changes to detailed CAD geometry or serialized exports.
Run `npm run build` for application/build changes and `git diff --check` before delivery.

### Choose tests by the change

| Change | Additional verification |
| --- | --- |
| UI behavior, controls, project management, or canvas interaction | Run the affected feature file(s) with `npm run test:workflows -- bin-designer.pockets` (replace the filter as needed). Run all workflows for shared page/provider changes. |
| Pocket construction, insertion, rounding, bases, or material masks | Run the affected `*.qualification.test.ts` files with `npm run test:geometry -- pocket-color.qualification pocket-insertion.qualification`. Include related interactions and inspect a representative exported artifact. |
| Shared kernel/mesh preparation, material partitioning, or STL/3MF serialization | Run the complete `npm run test:geometry`; check the serialized meshes as well as in-memory geometry. |
| Sample documents or labels | Quick tests check metadata, hashes, and library agreement. Also run the affected sample export, e.g. `npm run test:geometry -- sample-labels -t wiha-drivers`. |
| Printable calibration/measurement aids | Run the measurement-aid qualification tests and the relevant calibration tests. |
| Release, broad cross-cutting change, or uncertainty about affected areas | Run `npm run test:full`. |

File filters and `-t` work with every command. `npm run test:full -- <file>` can
run a specific file from any group. A filter passed to `npm test` searches only
the quick projects; use the appropriate command for qualification/workflow files.
`npm run test:coverage` measures the full suite, rather than quick-only coverage.

Keep small synthetic geometry regressions, schema/persistence checks, worker
boundary checks, and component tests in the quick suite. Put detailed real-project
CAD, parameter matrices, material/topology contracts, and sample exports in
`*.qualification.test.ts`. Put page-level UI workflows in feature-specific
`*.workflow.test.tsx` files; keep a small page smoke test in the quick suite.
Use `*.test-support.ts(x)` for shared fixtures and hooks, never import another
`*.test.ts(x)` file for setup. Separate inexpensive metadata assertions from
expensive model generation. Preserve assertions when moving a test; verify full
collection after a suite split so tests are neither dropped nor run twice.

Report which commands/files ran, their results, and any unrun relevant coverage.
Timeouts are failures, not passes. For a timeout, rerun the affected case in
isolation or profile its cost instead of repeatedly rerunning the full suite or
blindly increasing limits. Full-resolution CAD can take minutes, and synchronous
WASM work may finish after Vitest's timeout. Avoid concurrent full-suite runs;
`test:geometry` limits workers to two to reduce local CPU/memory contention.

### Local-only verification

- Run type checks, tests, and production builds locally. Do not run CI on GitHub
  for routine updates, pushes, or PRs.
- Do not enable, dispatch, or rerun GitHub CI unless the user explicitly
  authorizes that hosted run. Do not add automatic push or pull-request triggers.
- The repository's CI workflow is disabled in GitHub. Keep it disabled unless
  the user explicitly changes this policy.
- Include the local verification commands and results in the PR or completion
  report. Missing hosted checks are expected and are not a reason to start CI.

Vitest config lives in its own `vitest.config.ts` that `mergeConfig`s `vite.config.ts` —
never add a `test` key to `vite.config.ts`, because `server/vite.ts` imports that file
into the bundled Node server. Four disjoint projects are configured:
`quick-unit` (node: ordinary shared/lib/server tests), `quick-ui` (jsdom: ordinary
component/hook/page/state tests), `geometry` (node: qualification tests), and
`workflows` (jsdom: feature workflow tests). The default and watch commands select
only the two quick projects; `test:full` selects all four. New qualification tests
belong under `client/src/lib/`, and workflow tests under `client/src/`.
Tests are type-checked — `tsconfig.json` deliberately does *not* exclude `*.test.ts`.

No linter is configured yet (prefer ESLint when one lands).

### Photo outline regression testing

- **Every photo-based outline detection test and evaluation must start with the
  original, unmodified photo on its calibration sheet.** Run the full application
  workflow: load the photo, detect its calibration markers, accept the available
  auto-calibration/perspective option, select the tool region, then detect the
  outline. Do not start from a crop, rectified image, cached detector pixels,
  precomputed calibration, or saved outline.
- **Choose detection and simplification settings only through the controls the
  UI actually provides, in a sequence the UI permits.** Exercise the defaults
  first; open manual settings before adjusting them, handle any confirmation,
  and wait for each operation to finish before the next action. Do not inject
  settings or seed application state to bypass a preceding step. Test method
  switching, restart, and auto simplification from states reached through these
  same user actions.
- Record the original photo's hash, selected region, ordered UI actions, and
  resulting settings with each evaluation. A missing original, unsuccessful
  calibration, or unavailable UI action is a failed/incomplete case, never a
  reason to substitute a prepared image or silently skip the case.
- Apply this rule to all photo regression tests and comparisons, including
  existing cases when revisiting them. Cropped-image replay and direct detector
  probes are diagnostic evidence only and cannot qualify a photo regression or
  support a claim that the end-to-end workflow passes. Synthetic unit tests may
  continue checking isolated algorithms and state transitions; report their
  results separately from photo workflow validation.

## Code Conventions

- TypeScript strict mode; no `any` unless annotated with a reason.
- Path aliases per `tsconfig.json` (`@/...` for client src, `@shared/...` for shared).
- Shared project and geometry validation lives under `shared/`; never duplicate validation logic client- or server-side.
- Projects and traces are browser-local. Do not restore the retired image upload API or server-side session/storage scaffold.
- UI additions should maintain a consistent style, interaction design, and layout with existing controls. Reuse established patterns for similar tasks (including compact label/input rows, object lists, selection, renaming, property panels, toolbars, and hover hints) before introducing a new pattern.
- UI: compose shadcn/ui components from `client/src/components/ui`; TailwindCSS for styling, with the shadcn design tokens defined as CSS variables at the top of `client/src/index.css`; `lucide-react` for icons.
- Keep build tooling platform-independent. The app builds and runs anywhere with plain Node; do not add hosted-IDE-specific build plugins or theme configuration.
- Server state via TanStack Query; local state via React hooks; routing via wouter.
- Image processing runs client-side (canvas + OpenCV.js); keep heavy processing off the server.
- Detection has **one** pipeline (`lib/detect/pipeline.ts`) with behaviourally
  equivalent base segmentation backends — OpenCV and pure JS. Guarded CPU GrabCut
  may refine the baseline when OpenCV is available; rejection or unavailability
  preserves the original pipeline. Keep the JS baseline complete and never
  reintroduce a parallel "experimental" path.
- OpenCV and manifold are **injected, never imported** by geometry code (`cv` and
  `Kernel` are parameters). That is what lets the same modules run on the main thread, in
  a worker, and under Vitest in Node.
- WASM handles from manifold (`Manifold`, `CrossSection`) and OpenCV (`cv.Mat`) are not
  garbage collected. Track every one in an `Arena`/`MatScope` disposed from a `finally`.

## Agent Working Principles

1. Ask if unclear, don't assume.
2. One PR = one concern. Small diffs, quick tests plus relevant qualification/workflow coverage as described above.
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
