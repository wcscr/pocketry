# ULTIM8-compatible fixture entry

## Approach and state flow

- `spec.pegBottom` is the only fixture-profile signal, including old projects,
  imports, undo/redo, and visits to `/bin`. No mode field or schema migration.
- `/ultim8` and `/bin` render the same mounted designer. The entry waits for
  working-copy and library hydration. An existing peg project is retained exactly.
  Otherwise the existing `ProjectControls.createNewProject` path starts a fixture:
  a fresh empty profile starts immediately; named work uses the existing confirmation
  and save-before-replace transaction; unnamed work requires save/discard/cancel.
  Success or cancellation replaces the URL with `/bin`. Failure keeps the original
  design and the retryable prompt. The workspace registry stays unchanged.
- Extract a pure typed settings helper returning the spec and material patches
  used by both setup and entry. Preserve the dialog's reducer preview and original
  finger-access depth checks. Entry uses the initial project's body thickness;
  both paths use flat backing, pegs-up export, default pegs, no lip, solid 100%,
  arbitrary rectangular dimensions, and one color. Custom legacy footprints keep
  their exact shape; opening a saved project never reapplies defaults.
- Peg controls are available whenever pegs exist; creation from a regular Bottom
  selector remains Experimental-only. Show a small Beta label. Wall slant, custom
  wall thickness, design links, and all other experimental gates remain unchanged.
- `projectUsesExperimentalFeatures` currently has no production callers; only its
  unit tests and the experimental-provider test use it. Exclude pegs in current
  and historical snapshots because they no longer require opt-in tools. Keep
  other experimental detection intact. Remove pegs from the panel notice too.
- Reuse the existing panels with profile conditions and fixture wording. Display
  millimetres for legacy rectangular peg projects without mutation; a user size
  edit may explicitly convert to arbitrary dimensions. Custom footprints retain
  their stored geometry and expose their existing footprint editor in a collapsed
  legacy-shape section.
- Put the fixture empty-state hint and Trace action on the canvas, visible on
  desktop and phones: add object → set thickness → export fixture + alignment SVG.
  Keep Add pocket and all existing creation tools. Flush the current project before
  leaving for Trace; use the existing destination fingerprint/ID on handoff.
- Lead the existing export panel with fixture STL/3MF and 1:1 alignment SVG. Say
  pegs up only for flat backing; legacy sloped/bridged designs retain their actual
  orientation. No exporter or geometry change is needed.
- Skip the generic first-visit welcome for this entry so it cannot obscure the
  fixture start. Add linkable Help content, update the peg guide, README, changelog.
  Use ULTIM8-compatible wording and retain NOTICE provenance/trademarks unchanged.

## Gridfinity-only control inventory

| Existing control | Fixture treatment |
| --- | --- |
| Grid pitch selector; full/half/quarter cells and size sliders | Hide for rectangular fixtures; width/length in mm instead |
| Height-unit slider and unit field | Body thickness in mm instead |
| Edit footprint / reset rectangle | Hide for rectangles; collapse together with cell-size explanation for legacy custom footprints |
| Stacking lip switch | Hide; retain existing saved lip geometry |
| Magnet holes, crush ribs, screw holes | Already hidden by smooth-base condition, retain that behavior |
| Label-tab shelf / wall / choose-edge controls | Hide for fixtures; retain any saved shelf geometry |
| Keep bin size fixed | Fixture wording; arbitrary sizes remain fixed |
| Gridfinity dimensions help and cell/unit summaries | Fixture dimensions, body thickness and peg extension wording |
| Bottom selector | Keep as explicit conversion back to a regular project; peg controls remain visible |

Solid fill, pocket depths, finger access, surface text, colors, fit checks,
arrangement, validation, and undo remain relevant and available. Navigation,
inspector headings, export descriptions, and model labels use fixture wording.

## Adversarial self-review and revisions before implementation

1. Hydration races could replace a real project with defaults. Gate entry on both
   hydration and library readiness, use one request per visit, and share one route
   component so replace navigation cannot remount and race an autosave.
2. An unnamed draft may contain only changed dimensions/colors/history. Reuse the
   existing comprehensive `hasDraftWork`, not just a pocket count. Await all saves;
   failed restore/save must prevent replacement. Cancel must retain the design.
3. A route effect could run twice in StrictMode or open two dialogs on a phone.
   Guard the request with a ref; keep the existing project controller mounted with a stable portal host while its panel section is closed. The first workflow run exposed that collapsed sections otherwise unmount it.
4. A fresh fixture could be lost on an immediate Trace click. Flush persistence
   before navigation and block navigation on a failed save. Verify the returning
   destination fingerprint and pegs, including unnamed fixtures.
5. A broad Experimental override would leak unrelated tools. Change only the peg
   control condition and peg-only notice/detection; test other gates with opt-in off.
6. Reapplying defaults to old projects would alter material partitions, dimensions,
   lips, and underside orientation. Apply defaults only at creation/explicit setup;
   test restored specs and export inputs for exact equality.
7. Hiding grid UI could strand custom footprints or confuse regular users. Keep
   legacy custom shape controls collapsed, preserve Bottom conversion, derive the
   profile immediately from the current spec (including undo), leave tabs unchanged.
8. The generic welcome would obscure the entry after URL replacement. Dismiss it
   for an explicit `/ultim8` visit using the existing welcome lifecycle.

## Test and delivery plan

- Pure defaults/immutability tests, plus dialog/entry equality and depth conflicts.
- Route workflows: fresh profile, saved peg project, named Gridfinity project,
  unnamed draft save/discard/cancel, failed save/restore, repeat entry, replaced
  history and Back; desktop/mobile and both existing panel layouts.
- Gate/profile assertions, legacy spec/export preservation, real Trace handoff
  into the same fixture; Help anchor and welcome behavior.
- Node 22: `npm run check && npm test`, all workflow tests for the shared page,
  relevant existing peg/export qualification, `npm run build`, `git diff --check`.
- Run localhost:5000 in a clean browser at desktop/mobile widths, create a pocket,
  export STL and alignment SVG, inspect files and capture screenshots for the PR.
- Small commits, Will Cobb as author, brief PR for human review; do not merge or
  run/enable GitHub CI.

## Follow-ups (out of scope)

Mat peg-field view; XL/MINI presets; xTool/Gweike/Morpho laser/UV mats (only
eufyMake E1 peg layout is validated); graduating other Experimental features;
analytics; server changes. Physical print and mat-fit qualification remain separate
from the browser/export checks in this change.

## Local verification — 2026-10-19

- Node 22: `npm run check` passed; `npm test` passed 200 files / 3,114 tests;
  `npm run test:workflows` passed 11 files / 467 tests.
- `npm run test:geometry -- peg-bottom.qualification` passed 31 tests, including
  legacy underside modes and pegs-up exports. `npm run build` and
  `git diff --check` passed. No geometry or serializer implementation changed.
- Clean task browser at `http://127.0.0.1:5000/ultim8`: entry replaced the URL
  with `/bin` with Experimental off. Tested 1440×1000 desktop and 390×844 mobile,
  changed body thickness to 8.5 mm, added a rectangle/circle pocket respectively,
  and downloaded STL plus alignment SVG at each width. Direct fixture Help link
  opened its section. Screenshots below show the adjusted fixture and export UI.
- Both downloaded STLs have positive signed volume, every edge shared by two
  triangles, bounds 83.5×83.5×12.5 mm with minimum Z=0. Both SVGs declare
  83.5×83.5 mm and include pocket openings plus four retained peg circles.
  [Export measurements and SHA-256 hashes](ultim8-entry-evidence/exports.json).
- Existing blind-pocket roof warning remains visible. These checks do not
  qualify slicer settings, physical print quality, or mat fit. GitHub CI remained
  disabled; no hosted verification was run.

| Desktop entry and dimensions | Desktop export |
| --- | --- |
| ![Desktop fixture entry](ultim8-entry-evidence/desktop-entry.png) | ![Desktop fixture export](ultim8-entry-evidence/desktop-export.png) |

| Mobile entry | Mobile export |
| --- | --- |
| ![Mobile fixture entry](ultim8-entry-evidence/mobile-entry.png) | ![Mobile fixture export](ultim8-entry-evidence/mobile-export.png) |
