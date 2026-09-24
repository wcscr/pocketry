# Selection inspector prototype

This prototype separates choosing objects from editing them. It starts from
`codex/pocket-tilt` at `169277ff`, preserving pocket tilt, design links, mixed
selection, arrangement, geometry validation, and the existing project format.

## Try it locally

Use Node 22, run `npm ci`, then:

```sh
npm exec -- vite --host 127.0.0.1 --port 5187 --strictPort
```

Open `http://127.0.0.1:5187/bin?inspector=1`. The regular `/bin` URL retains the
existing layout for comparison. The query flag enables the rotation branch's
object tools for this session without changing the saved experimental preference.

Open `selection-inspector-demo.pocketry.json` through **Workflow →
Project → Open project**. It contains four pockets and two finger accesses.
This is synthetic test data; importing uses the normal browser-local project flow.

## Interaction

- **Workflow** keeps project, size, construction, pocket creation, finger access,
  materials, fit checks and export in one continuous left pane.
- **Objects & properties** keeps the pocket and finger-access lists in their own
  scroll area above the right-side property inspector.
  Selecting objects does not scroll the list to a properties section. Use row
  checkboxes or Shift/Command/Control-click to add and remove objects.
- The inspector shows existing detailed controls for one object. Several selected
  objects get shared fields, with **Mixed** for differing values and explicit
  **Apply** buttons. Pocket and finger-access edits have separate scopes.
- Bulk fields cover fixed cut depth and top rounding, plus pocket clearance.
  Setting pocket depth converts selected depth modes to fixed millimetres and
  updates both sections of split pockets. Boundary shapes remain unchanged.
- **Move**, **Rotate**, and **Arrange** icons beside the ruler open the matching
  right-side controls. Move and Rotate activate their 3D gizmos; Arrange appears
  for multiple selected objects. Alignment and distribution use standard icons
  for both axes, with tooltips and accessible labels. Selection remains active
  while switching tools, bin settings, and 2D/3D views.
- **Duplicate** makes independent copies of the selection with a common offset.
  **Delete** removes the entire selection. Each command and bulk edit creates one
  undo step. Delete/Backspace also removes the selection when the canvas owns
  keyboard shortcuts.
- Existing design links remain available. The inspector discloses unselected
  linked copies affected by property edits; the complete edit must fit the bin,
  including tilted linked copies, or nothing is applied.

Both panels have independent collapse/expand buttons in a persistent bar above
the workspace. Wide screens show the workflow, canvas, and objects/properties in
three columns. Compact windows show one panel at a time beside the canvas; on
phones it overlays the canvas. The panel buttons remain visible at every size,
and canvas tools reopen the object inspector. Toggling panels or resizing does
not remount or transform the canvas.

## Evaluation and limits

Select Driver, Probe and Driver access. The pocket depth shows Mixed; the finger
depth is separate. Apply a pocket depth, undo it, then align or rotate the
selection. Switch objects repeatedly and verify that the list stays in place.
Also test a long imported project, linked designs, and tilted or split pockets.

Panel widths are fixed for this prototype. Bulk editing exposes a small set of
shared fields; use single-object controls for contour, size and shape-specific
edits. Design links are retained, but persistent spatial groups are not added.

Validation is local: `npm run check` and `npm run build` pass; `npm test` passes
all 2,013 tests across 120 files using Node 22. HTTP tests need localhost binding
permission when run in a restricted sandbox. Browser
checks cover desktop, tablet, portrait phone and short landscape layouts,
mixed selection, scoped edits, arrangement, undo, gizmos, and panel toggling.
No hosted CI or physical-print qualification is part of this UI prototype.
