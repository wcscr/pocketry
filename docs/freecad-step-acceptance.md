# Native FreeCAD STEP editing evidence

On **2026-10-07**, all **12 native API cases** passed in the installed **FreeCAD 1.1.4** desktop application, with Python **3.11.14** and OCCT **7.8.1**. The macro ran from the built-in Python console with a GUI and used the exact STEP inputs previously tested in Fusion. **Normal import-dialog acceptance remains unpassed:** opening either irregular bin through File → Open and confirming unchanged STEP Import Settings crashed FreeCAD on this Mac.

| Fixture | A: dedicated STEP native API | B: unified CAD native API |
| --- | --- | --- |
| Standard solid | Pass | Pass |
| Standard hollow | Pass | Pass |
| Mixed pockets | Pass | Pass |
| Concave profile and ellipse | Pass | Pass |
| Tilted split pocket | Pass | Pass |
| Irregular footprint and text | Pass | Pass |

Both STEP files were imported in every case. Checks cover valid closed solids, expected components and dimensions within 0.0001 mm, true 3.75 mm bin corners, the 6 mm circle and 9.8/4.9 mm ellipse, duplicate Unicode names and stable IDs, source/tool placement, and the fully raised source without a dummy cutter.

The macro creates an editable native Part::Cylinder and Part::Cut for a new 4 mm hole. It reconstructs the bin from the actual named blank/cutters/finger tools using native Part::Cut dependencies, then moves one actual pocket cutter 3 mm along X where applicable while retaining its finite source unchanged. Standard bins have no pocket cutter to move. Text remains separate, and construction tools intentionally overlap.

Edited bins and tool reconstructions were saved as FCStd documents. Each original document was closed before reopening its file: FreeCAD's openDocument otherwise reuses an open document. Fresh disk loads preserve geometry, source labels and healthy native feature dependencies. New features and tools are placed inside the imported App::Part containers; the final run checks this scope before and after reopening and its report-view output contains no new scope warnings.

FreeCAD expands disconnected compounds such as raised text into an App::Part with separate letter bodies. The checker resolves the topmost shared identity and checks combined bounds and solid counts without fusing or repairing geometry. Native viewport images for all edited/reconstructed models were saved; representative irregular and concave images were inspected with the construction tools hidden.

A separate OCCT 7.8 reader validates **32 native STEP comparisons**: twelve added-hole results, twelve baseline reconstructions and eight moved-cutter reconstructions. Every file contains valid closed CAD solids without mesh representations, and symmetric Boolean comparisons leave zero extra/missing solids. The largest absolute numerical volume-estimate difference is about **0.002078 mm³**. Mass estimates and empty differences do not prove a maximum local surface-error bound.

## Unresolved desktop import issue

The normal STEP Import Settings dialog was accepted with its existing options unchanged on macOS **26.6.2 (25G83)**. Three dedicated irregular-bin attempts crashed, including fresh sessions and keyboard confirmation; the unified irregular-bin attempt also crashed. A fifth fresh-session attempt used a simple 10 × 10 × 10 mm box STEP authored by this installed FreeCAD, containing one valid closed solid with a 1000 mm³ volume and no Pocketry geometry, and crashed at the same dialog. The macOS crash reports show SIGSEGV/EXC_BAD_ACCESS in Objective-C autorelease / Qt Cocoa accessibility/event handling. The control suggests a broader desktop/dialog runtime issue; the stack and control do not prove the root cause. Native API import/edit/save success is retained as separate evidence and does not excuse these failures.

No import preferences were changed to make a check pass. The normal desktop workflow needs diagnosis and a passing rerun before release. Broader feature support, mobile and printing qualification, and backend selection remain separate gates. Neither approach became the production default.

## Local repository checks

Both branches passed all required local checks using Node 22.23.3: `npm run check`, `npm test` (165 files / 2778 tests), `npm run build`, and `git diff --check`. GitHub CI remained disabled. The initial dedicated-branch test run encountered the existing 5000 ms tilted split-pocket geometry timeout; its full log is preserved. The unchanged suites passed on a sequential rerun after native CAD work ended. This evidence update changes documentation and verification harnesses, not application geometry.

## Reproduction and artifacts

The reusable macro and configuration example are in [scripts/freecad-step-acceptance](../scripts/freecad-step-acceptance/README.md). The separate reader is [verify-freecad-step-edits.py](../scripts/verify-freecad-step-edits.py). FreeCAD is a separately installed test application, not a Pocketry dependency.

Raw local artifacts are under /Users/willcobb/Code.local/pocketry/outputs/freecad-step-acceptance/ and are not tracked:

- freecad-summary.json: compact native results, hashes, independent comparisons, crashes and local gates.
- results/freecad-edit-report.json: all twelve final GUI API cases, including fresh disk loads and native part scopes.
- results/dedicated/<fixture>/ and results/unified/<fixture>/: edited FCStd files, native STEP exports and viewport images.
- inputs/: unchanged copies of the Fusion acceptance inputs.
- freecad-independent-edits.json: all 32 independently checked edit/reconstruction comparisons.
- freecad-ui-crash.json: bounded import-dialog attempts and sanitized crash evidence.
- control-freecad-box.step: the native FreeCAD-authored simple-box control used in the fifth crash attempt.
- local-gates-initial-run/: preserved initial five-second geometry-test timeout; the unchanged required suites were rerun sequentially.
- Retained earlier run folders: superseded harness assumptions, visibility and part-scope corrections; they are not the final acceptance evidence.

Compact tracked evidence is in [freecad-step-evidence.json](freecad-step-evidence.json). The macro closes only its own test documents, performs local file I/O, and leaves pre-existing documents and settings alone. New native FreeCAD feature history is distinct from Pocketry's retained source project/history.
