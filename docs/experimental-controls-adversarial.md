# Experimental pocket controls: adversarial test report

Tested September 23, 2026 on `codex/pocket-tilt`, starting at `2e2b32d` and including the fixes described below. This is a desktop browser workflow test plus automated regressions and inspection of actual downloaded files. It is not physical print qualification or an exhaustive cross-browser certification.

## Findings and fixes

| Finding | User impact | Correction and verification |
| --- | --- | --- |
| A finite value such as `1e308` overflowed while rounding a movement coordinate. | Applying it could break detailed preview and leave invalid data in the document/history. | Reject overflowing moves before committing, with a clear inline message. Pocket, finger-access, mixed-selection and page regressions verify unchanged geometry/history. Reproduced through the deployed UI and retested locally. |
| W/E did not return from Links or Arrange if the requested transform mode was already active; Layout lacked these shortcuts. | Keyboard controls appeared unresponsive. | Repeated W/E explicitly selects the requested transform tab in both views. Regression tests and browser retest pass. |
| Layout's Add pocket button and guidance overlapped the floating controls on narrow/short viewports. | The panel header or lower actions were obscured. | Hide these competing overlays while object controls are open. Checked at 390 × 844 and 844 × 390; page regression verifies restoration on dismissal. |
| Unnamed finger-access objects had inconsistent names/numbers across controls. | The same object was difficult to identify in the selection list. | Use consistent “Finger access N” names, counting only finger-access objects. |
| Exported meshes contained faces that collapsed at Float32 precision. | A valid-looking preview could produce zero-area faces and over-shared edges in STL/3MF. | Rebuild export solids at file precision and simplify seams at 0.0001 mm. The browser-authored regression and downloaded files pass geometric topology and volume checks. |
| The CW313 multi-color body had coincident faces between two tilted seats and material cavities. | The body had ten geometric edges shared by four faces despite valid index topology. | Recompute the material-body difference at export precision. The regression fails before the correction and passes afterwards; downloaded CW313 3MF has no such edges. |

The geometry corrections apply at export time. They retain the cavities and material regions; the tested material volumes sum to the whole-body volume within 0.001 mm³. Automated tests also compare the resulting mesh against the kernel's original volume within 0.1 mm³.

## Browser workflows exercised

The user's localhost:5202 project was preserved. Testing used disposable projects on an isolated preview origin and localhost:5203.

| Workflow | Observed result |
| --- | --- |
| Fresh settings, experimental enable/disable, open controls, dismiss controls | Controls remain opt-in and open on demand. Disabling hides tools without editing the model. |
| Restore an experimental project after disabling features | Features automatically enable and the notification explains why. |
| Draw a rectangle, move XYZ, rotate X/Y/Z, reset one axis to zero | Fields retain changes from the as-drawn pose; resetting one axis preserves the other axes. Layout/3D switching retains offsets. |
| Drag the real 3D Z arrow and X rotation ring | Z changes pocket depth beneath the surface; X rotation updates its axis field and can be reset. Undo restores the prior geometry. |
| Invalid tilt and overflowing numeric entry | Invalid changes are rejected. Last valid geometry and history are retained after the fixes. |
| Layout Shift/Ctrl/Command-click; 3D Shift-click; checkbox selection | Objects can be added/removed from selections. A 3D Ctrl-click trial was inconclusive because the hit was not established; Ctrl behavior is covered by automated scene/page tests. |
| Align three objects to a reference and distribute equal gaps | Exported project coordinates confirm the requested alignment and spacing. |
| Select pockets with a finger-access slot | Mixed controls allow XYZ movement and Z rotation; unsupported thumb-slot X/Y tilt is disabled. Links show separate pocket and finger-access sets. |
| Linked duplicate, independent placement, shared depth, unlink, undo | Design changes propagate; placement remains independent; unlink preserves geometry; undo restores links. |
| Reset linked copies with incompatible original depths | The whole operation is rejected atomically. After unlinking, each object can return to its own original depth. |
| Save, reload, export editable project, import on another origin | Geometry, links, originals and undo history survive. The downloaded project parses successfully. |
| Eight-slot CW313 rack with two shared thumb channels | Imported, linked the eight pockets and two channels separately, applied a shared depth change, and completed detailed preview and exports without errors. |
| Portrait and landscape responsive layouts | Object controls remain usable after resolving the overlay collisions. These were desktop viewport simulations, not real touch-device tests. |

The full local suite additionally covers cancellation, undo/redo races, compound rotations, linked conflicts, saved-history validation, deterministic transform cases and preview/worker retry. Those tests supplement browser checks; they do not imply every failure was injected through the browser.

## Downloaded file validation

Models were exported through the application's normal buttons, then the actual STL/3MF downloads were parsed. Checks include finite coordinates, nonzero triangle area, two incident faces per geometric edge after welding identical positions, positive signed volume, bounds, valid 3MF ZIP/XML and millimetre units. Index-only topology would have missed the reported failures.

| Model / mesh | Triangles | Zero-area faces | Bad geometric edges |
| --- | ---: | ---: | ---: |
| Three-pocket test, STL | 19,710 | 0 | 0 |
| Three-pocket test, 3MF body | 16,486 | 0 | 0 |
| Three-pocket test, 3MF floors | 36 | 0 | 0 |
| Three-pocket test, 3MF rim | 3,814 | 0 | 0 |
| Eight-slot CW313 rack, STL | 64,246 | 0 | 0 |
| Eight-slot CW313 rack, 3MF body | 64,310 | 0 | 0 |
| Eight-slot CW313 rack, 3MF floors | 96 | 0 | 0 |

The CW313 export measures 167.5 × 125.5 × 49 mm. Board fit, drawer clearance and print/slicer behavior remain unqualified by this software test.

## Local verification and retained evidence

Node 22: `npm run check`, `npm test` (**2,005 tests in 119 files**), `npm run build`, and `git diff --check` passed. GitHub Actions CI stays disabled; all tests ran locally. The build retains the existing bundle-size advisory.

Local evidence is retained in the feature worktree's untracked `outputs/object-controls/` directory: before/after regression logs, full test/build logs, exported editable projects, final STL/3MF downloads, `adversarial-download-validation.json`, `cw313-download-validation.json`, and `validate-downloads.py`. Output binaries/logs are not part of the source commit.

Remaining qualification: real touch devices, Safari/Firefox, slicer repair warnings and physical printing/board insertion were not tested in this pass.
