# Hardware symbols for surface labels

Add a curated, bundled collection of GFLabel hardware outlines. A surface label
may contain one symbol, text, or both. Symbols precede text, with independent
size/rotation and shared raised height, position, whole-label rotation, and color.
No font installation or network request is needed. Existing text-only labels retain their geometry.

## Controls and persistence

- Add → Surface text remains the entry point in standard, workflow, and mobile UI.
- The shared properties editor gains a searchable Symbol picker with named
  previews and a None option. Wording may be empty only when a symbol is present.
- Size, font, height, position, rotation, delete, and inline wording remain in
  their existing locations. Existing slanted-bin restrictions still apply.
  Font selection is disabled with an explanation when wording is empty; the
  saved font stays intact for subsequent wording edits. Symbol changes commit
  the current wording draft atomically, superseding pending font conversion.
- The optional symbol ID is stored in the label and undo history. Version 54
  accepts older projects without adding a symbol or rewriting their wording.
- The picker credits GFLabel; About, README, NOTICE and a served license file
  identify the source project, pinned revision, author, and BSD-3-Clause terms.

## Assets and checks

### Compact settings and independent size follow-up

- Rename the content field to **Text** and use that term in nearby help and
  accessible editing labels. Keep text input, Font, and Text size above Symbol.
- Remove the redundant inner frame/visible legend and permanent picker hint.
  Put Font and Text size side by side. Keep shared Height, Label rotation,
  and X/Y above Symbol. Put only symbol Size and Rotation below its picker. Keep attribution and
  symbol-only guidance in the picker, with all controls available on phones.
- Store optional `symbolSizeMm` (2–40 mm) in this PR's unreleased schema 54.
  Missing values retain the old shared size. When text size changes on an old
  mixed label, capture its existing symbol size in the same transaction, so
  only text changes. Explicit symbol sizes survive text edits, symbol changes,
  None, project reload, and undo/redo.
- Verify independent dimensions, rotated spacing/holes and real exports;
  numeric preview/cancel/undo, old-project round-trips, symbol-only controls,
  ordering/visibility and responsive layout. Keep fonts and source notices.

### Independent rotation follow-up

- Bolt and screw side profiles start upright, head at the top, normalized to the
  label size. Head/drive views and other hardware keep their existing orientation.
- Add **Symbol rotation** immediately below the picker in the shared properties
  editor. Show it only when a symbol is selected; retain its angle when None is
  selected or another symbol is chosen. The existing **Rotation** turns the whole
  label. Both controls use the existing numeric preview/commit and undo path.
- Persist optional `symbolRotationDeg` in schema 54 (this feature's unreleased
  schema); absent means zero. Rotate the symbol before calculating its bounds,
  wording gap, and vertical alignment. The selected picker preview follows it.
- Check arbitrary angles, inverse/whole-label rotation, holes and export topology,
  default vertical profiles, save/history round-trips, undo/redo, invalid input,
  text-only behavior, and visibility in desktop/mobile standard/workflow layouts.

Generate only hardware fragments from pinned GFLabel source; no Open Sans,
electronic symbols, or third-party label bases are incorporated. Commit the
normalized outlines and generator/provenance so ordinary builds remain Node-only.

Before completion, check all catalog shapes and holes, supported-surface bounds,
non-overlap, actual Manifold extrusion, fused STL topology and separate 3MF parts;
round-trip symbol-only/mixed/legacy labels and undo/redo. Exercise search, keyboard
selection, removing a symbol from an otherwise empty label, invalid wording, font
changes, and edits that race with async font conversion. Check desktop and mobile
layouts and local type checks, tests, build, and diff. Physical print quality is a
separate qualification and is not claimed by passing geometry/export checks.

## Completed verification — 2026-10-24

- Node 22: `npm run check`, `npm test` (3,319 tests),
  `npm run test:workflows` (533 tests), `npm run build`, and `git diff --check` passed.
- The five `hardware-symbols.qualification.test.ts` cases check every symbol
  at 2, 6, and 40 mm, source area and holes, disconnected pieces, placement
  failures, and a bin containing all 18 symbols. Its serialized STL has closed,
  consistently directed coordinate edges; its 3MF keeps 18 colored label parts.
- `bin-designer.text.workflow.test.tsx` was rerun (39 tests) after adding actual
  export-UI assertions for the name of a symbol-only part in all export variants.
- Browser checks covered desktop and 390 × 844 layouts, search, mixed labels,
  a symbol-only label, the 3D floor preview, and persistence through reload.
  About credits and the served BSD license were read back. Production NOTICE
  and the license file match their source files byte for byte.
- Two consecutive locked generator runs produced the same asset SHA-256:
  `7b63c9d806421558c45d46c9c2cb03b2f33fbcf837687bc7a977e15d9e877353`
  before the upright-profile follow-up below.
- No deployment, slicer run, or physical print qualification was performed.

### Rotation follow-up verification — 2026-10-24

- Node 22: type check, all 3,331 quick tests, 39 surface-text workflows,
  production build, and diff check passed locally. The quick suite was rerun
  with loopback access after the sandbox prevented server tests from binding.
- All 14 symbol qualification cases passed: every symbol at 2/6/40 mm and
  -180/-45/0/90 degrees, with rotated mixed labels in closed STL and colored 3MF.
- UI tests cover one-entry undo/redo, invalid and cancelled numeric drafts,
  retained angles across wording/symbol edits, and visibility in all four
  standard/workflow and desktop/mobile combinations.
- Browser checks confirmed vertical bolts and screws, independent rotation with
  upright wording, the selected picker preview, reload persistence, and phone
  properties. Shipped NOTICE and GFLabel license match their source files.
- Two locked generator runs produced identical upright-profile assets, SHA-256:
  `4219fe27b338bec5b808b0092f167de13834a05526ce06fd8adff1b0508f1ce7`.

### Compact controls and size verification — 2026-10-28

- Node 22: `npm run check`, `npm test` (3,337 tests), production build, and
  `git diff --check` passed locally.
- `npm run test:workflows -- bin-designer.text bin-designer.mobile`: 60 tests
  passed, including text-before-symbol ordering in all four layout/device modes.
- `npm run test:geometry -- hardware-symbols`: all 14 cases passed with independent
  symbol sizes, including mixed labels in serialized STL and 3MF.
- Numeric tests cover independent sizes, legacy-size preservation, cancel,
  invalid drafts, one-step undo/redo, None/reselection and symbol-only edits.
- Browser checks confirmed compact desktop/phone controls, 8 mm text with a
  12 mm symbol, and both sizes surviving reload. The phone symbol controls fit
  their container without horizontal overflow.
- Final grouping keeps shared X/Y, Height, and explicitly named Label rotation
  above Symbol, with Font and Text size side by side. Browser measurements
  confirm the font and size inputs align on both desktop and phone layouts.
