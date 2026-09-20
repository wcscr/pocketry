# Mobile experience review

Reviewed and fixed on 2026-09-16, starting from `origin/main` at
`3b72a380b6d24e0213194b34138f4e359fcf48b1`. Work is isolated on
`mobile` (renamed from `codex/mobile-usability`).

## Primary friction points addressed

| Area | Finding | Result |
| --- | --- | --- |
| First visit and upload | The controls drawer opened over the photo chooser, without a visible close action. | Mobile starts on the canvas, offers a persistent Choose a photo button, and labels upload for touch. The drawer has Back to canvas. |
| Automatic calibration | The detected ruler appeared on the photo while both acceptance actions were inside the closed drawer. | A persistent mobile action area exposes scale acceptance and perspective correction. Accepting scale advances to region drawing even when the controls panel is unmounted. |
| Manual calibration | Confirming the real ruler length depended on Enter or blur in the controls panel. | The mobile canvas shows the length field and an explicit Confirm scale button, with invalid lengths rejected. |
| Drawing and handoff | Selecting a drawing tool could leave the modal drawer covering the photo. Moving to the bin could carry that open drawer along. | Drawing actions reveal the canvas; Add and arrange reveals the resulting bin. Bin footprint and contour editing also return to the canvas. |
| Trace navigation and editing | Zoom and drawing toolbars overlapped. Pan depended on keyboard modifiers, and removing points required right-click. | Zoom sits in a separate toolbar at the bottom of the canvas, buttons have larger phone targets, and explicit Pan photo and a Remove toggle in contour edit mode support touch. Removal retains the minimum three vertices and supports undo. |
| Contour editing (2026-09-18–19) | Vertex deletion required right-click; the follow-up edit buttons appeared outside edit mode and occupied the photo. | A compact selected-contour indicator and Remove toggle appear only in contour edit mode with a selected contour. Entering Trace contour mode selects the largest outer contour; switching removal on/off retains the selected ring. Mobile Trace keeps the toggle in its action row. Bin vertices turn red in removal mode. Removal preserves three vertices and supports undo/redo. |
| Guidance and step navigation (2026-09-19) | Small gray instructions were easy to miss; returning to an earlier step or restarting was unclear. | Blue guidance has stronger contrast and a brief two-cycle pulse when instructions change, disabled for reduced motion. Back revisits Photo, Scale, and Region without discarding completed work. Start over confirms clearing the trace and invalidates pending decoding/detection; previously added Bin pockets remain. |
| Direct trace adjustments (2026-09-19) | Sensitivity and Detail required opening the controls drawer. | Both sliders are visible below the canvas after region detection, using the same controls as the drawer. Sensitivity commits on release and confirms before replacing manual edits; Detail preserves manual edits. |
| Compact canvas (2026-09-19–20) | Toolbars and instructions competed with the photo on narrow/short phones. | A single row of trace tools leaves history at the lower left and zoom at the lower right. Fitting compact canvases leaves room for toolbars. Landscape phones at least 560 px wide place Trace step controls beside the canvas, reserving at least 320 px of canvas width so its toolbars do not overlap; the action area scrolls independently. |
| Collapsed desktop controls (2026-09-20) | Keyboard focus could enter the invisible controls panel. | The mounted panel becomes inert and hidden from assistive technology while collapsed, then becomes interactive again when opened. |
| Bin navigation and export | The 3D/Layout switch competed with history controls on phones, and export was buried in settings. | Separated controls and persistent Bin settings / Export bin actions. Layout has explicit pan and fit controls. |
| Small screens and tablets | Tall opening instructions could start above the scrollable area; percentage-sized tablet panels squeezed fields and buttons. | Opening instructions scroll from the top; expanded panels maintain a 280 px minimum where the configured maximum allows it. |
| Dialogs, forms, and feedback | Long dialogs could exceed the viewport; notification dismissal depended on hover. | Dialogs and confirmations have viewport bounds and scrolling, close actions have larger targets, notifications can be dismissed by touch, and phone form text is 16 px. Safe-area padding and browser zoom are enabled. |

## Verification

- `npm run check`, `npm test` (84 files, 1,432 tests), `npm run build`, and
  `git diff --check` pass.
- Production-build browser checks cover 320×568, 390×844, 667×375, 844×390,
  768×1024, and 1440×900. Each exercises photo upload, manual scale confirmation,
  region selection, outline controls, tool naming, bin creation, export dialogs,
  and About; key actions are checked against viewport bounds.
- A touch-driven real-photo run verifies detected-scale acceptance, drawing a
  detection region, adding named pockets, layout navigation, and downloading a
  nonempty STL.
- Another touch run verifies actual perspective correction, two-finger pinch,
  point removal and undo, drawer-to-canvas transitions, and Help.
- Follow-up touch checks exercise the labeled contour toggle in Trace and Bin,
  including outer and hole vertex removal on a rotated/resized pocket, undo/redo,
  and turning removal off to return to adding/moving. Bin checks cover 320×568, 390×844, 667×375, and
  768×1024; Trace uses a real photo and perspective correction at 390×844.
- The 2026-09-19 workflow checks cover real-photo perspective correction, backward
  and forward navigation without losing the photo or edited outline, edit-mode
  gating, removal/undo, direct sensitivity/detail adjustment and replacement
  confirmation, and Start over cancellation/confirmation at 320×568, 390×844, and
  667×375. Reduced-motion checks verify the guidance animation is disabled.
- Updated Bin editing checks pass at 390×844, 667×375, and 768×1024. Tablet and
  desktop tracing/handoff/export checks pass at 768×1024 and 1440×900.
- Mobile project checks verify JSON import, naming and saving in the browser
  library, exporting a JSON backup, starting a new project, reopening the saved
  project, and persistence after reload.
- Regression tests cover mobile acceptance with the controls unmounted, explicit
  manual confirmation, perspective versus scale-only actions, export navigation,
  touch point removal, minimum ring size, and undo. Existing project-history tests
  exercise opening the now-closed mobile controls explicitly.
- The 2026-09-20 follow-up reproduces perspective-only correction at 568×320,
  then places both ruler endpoints by touch and confirms a manual length. The
  photo fits between separate toolbars in a 320×235 canvas. A desktop keyboard
  run verifies that collapsed controls cannot receive focus and reopening the
  panel reveals and focuses the pending calibration choice. Regression tests
  also keep detected-ruler previews read-only while a manual scale is retained.

Browser evidence was generated with isolated headless Chromium and fresh browser
storage. Screenshots, scripts, logs, STL, JSON backup, and viewport results are in
`/private/tmp/pocketry-mobile-qa/` on the review machine. These checks do not establish
physical iOS/Android browser or virtual-keyboard behavior; those remain device QA.
