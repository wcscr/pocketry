# Hardware symbols for surface labels

Add a curated, bundled collection of GFLabel hardware outlines. A surface label
may contain one symbol, wording, or both. Symbols precede wording and share its
size, raised height, position, rotation, and color. No font installation or network
request is needed. Existing text-only labels retain their geometry.

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
  `7b63c9d806421558c45d46c9c2cb03b2f33fbcf837687bc7a977e15d9e877353`.
- No deployment, slicer run, or physical print qualification was performed.
