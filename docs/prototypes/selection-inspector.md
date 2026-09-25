# Selection inspector prototype

This prototype separates choosing objects from editing them. It starts from
`codex/pocket-tilt` at `169277ff`, preserving pocket tilt, design links, mixed
selection, arrangement, geometry validation, and the existing project format.

## Try it locally

Use Node 22, run `npm ci`, then:

```sh
npm exec -- vite --host 127.0.0.1 --port 5187 --strictPort
```

Open `http://127.0.0.1:5187/bin?inspector=1`, or enable **Settings → Show properties
on the right**. The layout choice is saved for this browser and survives Trace,
Bin, Library, About, and page refreshes. The preview link sets the preference once
and removes its flag, preserving other query parameters and the URL fragment.
Turn the setting off (or open `/bin?inspector=0`) to compare the original layout.
With browser storage blocked, the preference lasts until the tab reloads. The
inspector includes object tools without changing the separate experimental-tools
preference or project data.

Open `selection-inspector-demo.pocketry.json` through **Project → Open project**. It contains four pockets and two finger accesses.
This is synthetic test data; importing uses the normal browser-local project flow.

## Interaction

- **Objects** is the single left-hand design tree. Choose **Bin** for size,
  construction, and materials, or a pocket/finger access for its properties.
  Row menus contain rename, duplicate, and remove actions. Checkboxes and
  Shift/Command/Control-click build a selection without closing the mobile
  object drawer. A regular row click opens Properties, even when reselecting.
- **Properties** occupies the right pane. Its heading always identifies the
  selected object, including while moving or rotating. No object selected means
  Bin settings. Pocket depth, clearance, and top rounding are visible; size,
  other edge details, position, and linked copies use collapsible groups.
  Several selected objects get shared fields with **Mixed** for differing values
  and explicit **Apply** buttons. Pocket and finger-access edits have separate scopes.
- **Project**, **Check fit**, and **Export** remain in the project header. They
  open focused dialogs without changing selection. The header also shows the
  project name and save status. Cross-section view is available below the tree.
- Bulk fields cover fixed cut depth and top rounding, plus pocket clearance.
  Setting pocket depth converts selected depth modes to fixed millimetres and
  updates both sections of split pockets. Boundary shapes remain unchanged.
- The labeled **Select**, **Move**, **Rotate**, **Arrange**, and **Link** toolbar
  stays above the canvas in both views. Unavailable tools stay visible but
  disabled. The active tool is highlighted and named in Properties; **Done**
  returns to regular editing, including when editing a contour.
  Move and Rotate activate their 3D gizmos. The X/Y/Z letter grips support the
  same axis constraints, snapping, and undo as their lines or rotation rings.
  Arrange and Link require multiple objects; their controls operate on the
  existing selection and preserve each object's identity and position unless
  explicitly changed.
- Move and rotation fields keep typing as a draft. **Enter**, **Tab**, or clicking
  away commits that axis for the full selection in one undo step; **Escape**
  cancels it. Invalid or incomplete values restore the current value and show an
  error. Untouched axes retain their individual values and full precision.
  These fields no longer need an Apply button.
- **Duplicate** makes independent copies of the selection with a common offset.
  **Delete** removes the entire selection. Each command and bulk edit creates one
  undo step. Delete/Backspace also removes the selection when the canvas owns
  keyboard shortcuts.
- Existing design links remain available. The inspector discloses unselected
  linked copies affected by property edits; the complete edit must fit the bin,
  including tilted linked copies, or nothing is applied.

Wide screens show the object tree, canvas, and properties in three columns.
Either panel can collapse. Compact screens have persistent **Objects** and
**Properties** buttons and show one pane at a time. On phones, Objects is a side
drawer and Properties is a bottom sheet that leaves a visible canvas above it.
Short landscape screens use a side inspector to preserve editing height. The editing canvas remains mounted in
the same untransformed container across panel changes and window resizing.

## Evaluation and limits

Select Driver, Probe and Driver access. The pocket depth shows Mixed; the finger
depth is separate. Apply a pocket depth, undo it, then align or rotate the
selection. Switch objects repeatedly and verify that the list stays in place.
Also test a long imported project, linked designs, and tilted or split pockets.

Panel widths are fixed for this prototype. Bulk editing exposes a small set of
shared fields; use single-object controls for contour, size and shape-specific
edits. Design links are retained, but persistent spatial groups are not added.

Validation is local: `npm run check`, `npm test`, and `npm run build`. Coverage
includes selection identity and scoped batch edits, undo, transforms, persistent
layout preferences, header dialogs preserving selection, and the canvas staying
mounted across panel toggles and responsive changes. Browser checks exercise bin
size, single-pocket depth, multi-edit, project management, and export.
HTTP tests need localhost binding permission in a restricted sandbox.
No hosted CI or physical-print qualification is part of this UI prototype.
