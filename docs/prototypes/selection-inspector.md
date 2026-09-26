# Selection inspector prototype

This prototype separates choosing objects from editing them. It starts from
`codex/pocket-tilt` at `169277ff`, preserving pocket tilt, design links, mixed
selection, arrangement, geometry validation, and the existing project format.

## Try it locally

Use Node 22, run `npm ci`, then:

```sh
npm exec -- vite --host 127.0.0.1 --port 5187 --strictPort
```

Open `http://127.0.0.1:5187/bin?layout=workflow`, or choose a layout under
**Settings → Bin editor layout**:

- **Controls on the left** (`?layout=standard`): the original combined panel,
  the default, with Hide controls at its top right and a narrow, full-height restore strip
  beside the canvas.
- **Workflow left, properties right** (`?layout=workflow`): every workflow section
  stays in order on the left; its property editor opens on the right. Pockets and
  Finger access retain their add actions and object lists on the left. The pinned,
  color-coded **Find a setting** shortcuts open settings directly or reveal the
  matching object list. On short screens the section headers remain available
  while the shortcuts hide to leave room for controls.
  Section headings and their status badges share one compact row.

The layout choice is saved for this browser and survives Trace,
Bin, Library, About, and page refreshes. The preview link sets the preference once
and removes its flag, preserving other query parameters and the URL fragment.
Retired `?layout=objects` and `?inspector=1|0` links return to Controls on the left.
Saved object-tree and legacy inspector preferences also fall back to this default.
With browser storage blocked, the preference lasts until the tab reloads. The
inspector includes object tools without changing the separate experimental-tools
preference or project data.

Open `selection-inspector-demo.pocketry.json` through **Project → Open project**. It contains four pockets and two finger accesses.
This is synthetic test data; importing uses the normal browser-local project flow.

## Interaction

- **Workflow** keeps each design section on the left. Choose a section for its
  settings, or a pocket/finger access for its properties.
  Row menus contain rename, duplicate, and remove actions. Checkboxes and
  Shift/Command/Control-click build a selection without closing the mobile
  object drawer. A regular row click opens Properties, even when reselecting.
- **Properties** occupies the right pane. Its heading always identifies the
  selected object, including while moving or rotating. No object selected means
  Bin settings. Pocket depth stays visible; size, edges and corners, position,
  and linked copies use collapsible groups. Top edge rounding belongs in Edges
  & corners in every layout.
  Extra pocket clearance is collapsed at the bottom in both layouts.
  Split pocket has its own collapsible group after Depth. It opens for an
  existing split, and Depth identifies the section being edited.
  Several selected objects get shared fields with **Mixed** for differing values
  and explicit **Apply** buttons. Pocket and finger-access edits have separate scopes.
- Every property editor uses the originating section's color: blue for size,
  rose for construction, violet for pockets, cyan for finger access, amber for
  materials, indigo for Check fit, and emerald for Export. Shared spacing, field heights,
  headings, and disclosure arrows apply to single-object, bulk, and transform
  controls. Advanced placement and size groups remain collapsible.
- **Project**, **Check fit**, and **Export** remain in the project header. They
  open their matching right-pane section without changing selection. The header also shows the
  project name and save status. **Check fit → Inspect inside** contains the
  cross-section preview in every layout, followed by **Prepare fit test templates**.
  Template shape, thickness, and export controls sit directly under that heading.
  Enabling the cutaway switches to 3D; exports still contain the complete bin.
  Selecting an object returns the inspector to that object.
  Project shows the current name, then New/Open/Export project, followed by a
  full-width **Manage Browser Library** button for saved projects and library backups.
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
- In Layout view, **Pan** highlights the hand icon and disables conflicting
  selection, transform, contour, and measurement tools. Keyboard edit shortcuts
  are suspended, and transform fields are disabled while panning. Fit to screen
  remains available. Click Pan again or press Escape to restore editing.
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

In Workflow layout, wide screens show workflow sections, canvas, and properties in three columns.
Either panel can collapse. On desktop, each hidden panel leaves a narrow,
full-height strip on its side of the canvas. Its expand icon stays at the same
height as the panel's top collapse control. The same strip restores controls in
the standard layout. Compact screens have persistent **Workflow** and
**Properties** buttons and show one pane at a time. On phones, Workflow is a side
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
includes selection identity and scoped batch edits, undo, transforms, both persistent
layout preferences and retired-layout fallback, workflow sections preserving selection, Pan tool
exclusivity, panel collapse controls, header section navigation, and the canvas staying
mounted across panel toggles and responsive changes. Browser checks exercise bin
size, single-pocket depth, multi-edit, project management, and export.
HTTP tests need localhost binding permission in a restricted sandbox.
No hosted CI or physical-print qualification is part of this UI prototype.
