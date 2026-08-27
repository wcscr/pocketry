# Direct open-source review

Reviewed: 2026-08-27

## Scope

This review covers open-source projects Pocketry directly chose, bundles, or
adapted: direct npm dependencies, copied component source, the bundled OpenCV.js
and Manifold artifacts, and the Gridfinity port. It intentionally does not
enumerate transitive dependency trees.

The review inspected the tracked source tree, package manifests and lockfile,
the production browser build, source comments and provenance files, and the
history of files that appeared likely to have been copied or generated.

## Confirmed direct upstream work

| Project | How Pocketry uses it | Licence | Attribution location |
|---|---|---|---|
| OpenCV 4.11.0 | Bundled OpenCV.js and eight ported ArUco marker patterns | Apache-2.0 | `NOTICE`; source header in `client/src/lib/calibrate/aruco-4x4.ts` |
| manifold-3d 3.5.1 | Geometry API and redistributed WASM binary | Apache-2.0 | `NOTICE` |
| gridfinity-rebuilt-openscad | Geometry and constants ported from commit `910e22d8607fd7f5f51ad5e5cbc5287a76810bfd` | MIT | `NOTICE`; `client/src/lib/gridfinity/UPSTREAM.md`; port headers |
| Gridfinity | Upstream basis acknowledged by Gridfinity Rebuilt | MIT | `NOTICE` |
| shadcn/ui | Component and hook source scaffolded into the repository and adapted | MIT | `NOTICE` |
| Direct npm packages | Application, server, build, and test packages declared by Pocketry | MIT, Apache-2.0, ISC, or Unlicense | Grouped inventory in `NOTICE`; exact versions in `package-lock.json` |

No directly used third-party GPL, AGPL, or LGPL project was found. The
University of Córdoba ArUco library and `andymai/gridfinity-layout-tool` occur
only in documentation as explicit sources not to use; no code from either was
found.

## Corrections made

- Rebranded the legal notice from ToolTrace to Pocketry.
- Added the missing shadcn/ui copyright and MIT licence notice for copied
  component source.
- Replaced the inaccurate claim that every npm dependency was MIT, ISC, BSD,
  or Apache-2.0. The direct `wouter` package is under the Unlicense.
- Removed the Arthur Moore baseplate attribution. The pinned upstream archive
  places that notice on `gridfinity-baseplate.scad`, which Pocketry did not
  port and no longer implements.
- Corrected the Gridfinity Rebuilt source header from `© 2022 kennetek` to the
  upstream licence's `© 2023 Kenneth Hodson`.
- Added a build step that emits `LICENSE.txt` and `NOTICE.txt` into the static
  release, so the legal files are not lost when only `dist/public` is deployed.
- Replaced the obsolete commercial-friendly dependency allowlist with a
  compatibility-and-provenance rule in `CLAUDE.md`.

## Other findings

The following production dependencies are declared but have no import or other
code reference in the tracked project: `@hookform/resolvers`,
`@jridgewell/trace-mapping`, `@neondatabase/serverless`, `connect-pg-simple`,
`express-session`, `framer-motion`, `memorystore`, `passport`,
`passport-local`, `react-icons`, `ws`, and `zod-validation-error`. Their
presence is not a licence conflict, and they remain acknowledged in `NOTICE`,
but they are candidates for a separate dependency-cleanup change.

Named algorithms and formats in the source—Ramer–Douglas–Peucker, Taubin
smoothing, marching squares, Otsu thresholding, DXF, STL, SVG, and 3MF—do not
carry evidence of copied implementations. The implementations in this tree
appear project-authored and contain no external source or licence markers.

A repository-hygiene follow-up removed the unreferenced Replit configuration
and notes, pasted-session `attached_assets/`, root `generated-icon.png`, and an
unused deprecated point-simplifier compatibility shim. The pasted images and
prototype material were not shipped by the application and had no confirmed
provenance, so removing them also eliminated an unnecessary public-release
risk. The same pass found no tracked build output, logs, caches, editor state,
or operating-system metadata.

## Project-licence decision

Following this review, Pocketry's original work was relicensed from MIT to
**AGPL-3.0-only** on 2026-08-26. The intent is to keep distributed derivatives
and modified hosted versions open while still permitting personal and
commercial use. A modified version used over a network must offer its
corresponding source to its users under AGPL-3.0-only.

The software licence does not claim ownership of designs or ordinary output
files users create with Pocketry. Third-party portions retain the licences and
notices recorded in `NOTICE`.

Relevant primary sources:

- <https://opensource.org/osd>
- <https://www.gnu.org/licenses/agpl-3.0.html>
- <https://www.gnu.org/licenses/why-affero-gpl.html>

The relicensing assumes Pocketry controls the copyright in all original
contributions. It does not relicense OpenCV, Manifold, Gridfinity Rebuilt,
shadcn/ui, or npm package code. If Pocketry later offers paid proprietary
exceptions, future outside contributions should be covered by a contributor
agreement that preserves Pocketry's ability to offer both licences.

## Maintenance rule

For each new direct dependency, bundled binary, copied file, or port:

1. Record its project, version or commit, licence, and how it is used.
2. Confirm compatibility with Pocketry's then-current project licence.
3. Preserve required copyright and licence text in `NOTICE` or a referenced
   provenance file.
4. Run a production build and confirm `dist/public/LICENSE.txt` and
   `dist/public/NOTICE.txt` are present.
