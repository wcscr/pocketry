# Mobile experience review

Reviewed and fixed on 2026-09-16, starting from `origin/main` at
`3b72a380b6d24e0213194b34138f4e359fcf48b1`. Work is isolated on
`codex/mobile-usability`.

## Primary friction points addressed

| Area | Finding | Result |
| --- | --- | --- |
| First visit and upload | The controls drawer opened over the photo chooser, without a visible close action. | Mobile starts on the canvas, offers a persistent Choose a photo button, and labels upload for touch. The drawer has Back to canvas. |
| Automatic calibration | The detected ruler appeared on the photo while both acceptance actions were inside the closed drawer. | A persistent mobile action area exposes scale acceptance and perspective correction. Accepting scale advances to region drawing even when the controls panel is unmounted. |
| Manual calibration | Confirming the real ruler length depended on Enter or blur in the controls panel. | The mobile canvas shows the length field and an explicit Confirm scale button, with invalid lengths rejected. |
| Drawing and handoff | Selecting a drawing tool could leave the modal drawer covering the photo. Moving to the bin could carry that open drawer along. | Drawing actions reveal the canvas; Add and arrange reveals the resulting bin. Bin footprint and contour editing also return to the canvas. |
| Trace navigation and editing | Zoom and drawing toolbars overlapped. Pan depended on keyboard modifiers, and removing points required right-click. | Zoom sits in a separate toolbar at the bottom of the canvas, buttons have larger phone targets, and explicit Pan photo and Remove points tools support touch. Removal retains the minimum three vertices and supports undo. |
| Bin navigation and export | The 3D/Layout switch competed with history controls on phones, and export was buried in settings. | Separated controls and persistent Bin settings / Export bin actions. Layout has explicit pan and fit controls. |
| Small screens and tablets | Tall opening instructions could start above the scrollable area; percentage-sized tablet panels squeezed fields and buttons. | Opening instructions scroll from the top; expanded panels maintain a 280 px minimum where the configured maximum allows it. |
| Dialogs, forms, and feedback | Long dialogs could exceed the viewport; notification dismissal depended on hover. | Dialogs and confirmations have viewport bounds and scrolling, close actions have larger targets, notifications can be dismissed by touch, and phone form text is 16 px. Safe-area padding and browser zoom are enabled. |

## Verification

- `npm run check`, `npm test` (84 files, 1,424 tests), `npm run build`, and
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
- Mobile project checks verify JSON import, naming and saving in the browser
  library, exporting a JSON backup, starting a new project, reopening the saved
  project, and persistence after reload.
- Regression tests cover mobile acceptance with the controls unmounted, explicit
  manual confirmation, perspective versus scale-only actions, export navigation,
  touch point removal, minimum ring size, and undo. Existing project-history tests
  exercise opening the now-closed mobile controls explicitly.

Browser evidence was generated with isolated headless Chromium and fresh browser
storage. Screenshots, scripts, logs, STL, JSON backup, and viewport results are in
`/private/tmp/pocketry-mobile-qa/` on the review machine. These checks do not establish
physical iOS/Android browser or virtual-keyboard behavior; those remain device QA.
