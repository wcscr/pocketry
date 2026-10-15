# FreeCAD macOS import-dialog crash: root cause

Investigated 2026-10-15. **The reproduced crash is Qt's macOS accessibility cache ownership defect, QTBUG-134784.** It affects the installed FreeCAD 1.1.4 bundle using Qt 6.8.3 on macOS 26.6.2 arm64. A normal import on a corrected runtime still needs a passing local test; identifying this defect does not close that release gate.

## Local proof

The geometry-free control creates an ordinary Qt dialog containing a four-row tree and OK/Cancel buttons inside the installed FreeCAD. No STEP importer, CAD document or geometry is used. Computer-use observation reads its accessibility tree; closing it through the native OK button crashes FreeCAD after the accepted callback finishes. The native record has an empty document list before and after the callback.

The new crash starts with `objc_release`, CoreFoundation array destruction, and `-[QMacAccessibilityElement dealloc]`. Its first six frames exactly match four of the five earlier import-dialog crashes, including the FreeCAD-authored cube control. The other earlier crash has a less specific autorelease-pool stack.

Binary inspection confirms the installed Qt 6.8.3 `QAccessibleCache::insertElement` stores the element pointer without a retain. The official 26.3rc1 bundle's Qt 6.11.2 implementation calls `_objc_retain` and releases an older element when replacing it. These functions were inspected in the shipped libraries with Apple's LLVM disassembler; neither library was modified.

## Failure mechanism and upstream fix

Qt's Cocoa bridge synthesizes native accessibility elements for table/tree rows, columns and cells. The affected cache records cell pointers without acquiring its own reference. Invalidating a cell can then release the reference owned by its parent array; later array destruction releases a stale pointer. Dialog closure is a visible trigger for that cleanup. A STEP file's geometry is not required to reach this defect.

The upstream [Qt fix b1ed5f6](https://github.com/qt/qtbase/commit/b1ed5f656f064e553b33752f8e87d2f5b9553e38) balances cache references and clears stale table entries, with a native accessibility regression test. It identifies [QTBUG-134784](https://bugreports.qt.io/browse/QTBUG-134784). [FreeCAD issue 30720](https://github.com/FreeCAD/FreeCAD/issues/30720) reports the same stack, relates the trigger to accessibility clients, and was closed after the dependency update in [PR 32431](https://github.com/FreeCAD/FreeCAD/pull/32431).

The observed trigger includes our automated accessibility controls. This is not evidence that every unobserved human import fails, nor evidence that accessibility users can be excluded from support. No accessibility services, import dialogs, security protections or preferences were disabled as a workaround. Detailed ownership attribution comes from the upstream fix and binary comparison; this investigation did not record allocation/free traces or NSZombie output.

## Corrected-build status and cleanup

An official [FreeCAD 26.3rc1](https://github.com/FreeCAD/FreeCAD/releases/tag/26.3rc1) macOS15 arm64 image was downloaded into the local investigation folder. Its 604144480 bytes match GitHub's SHA-256 `593a25880b5e8aef815db8e04e6d728cb5f13e3faee7170f490d4d72058b028f`. The copied app passed deep code-signature verification and macOS Gatekeeper as a notarized Developer ID application. Its shipped Qt is 6.11.2 and the corrected cache retains are present.

**No patched-runtime STEP import/edit/reopen pass is claimed.** Startup reached the initial configuration-migration dialog. Attaching computer-use controls after the CLI launch inadvertently started a second instance of this same test copy. Both test instances were closed with no CAD documents open, and the test disk image was unmounted. The installed `/Applications/FreeCAD.app` was not replaced or modified. The test copy remains only in the local output folder.

The migration dialog did not respond to our controls, and it was not accepted. That observation is not classified as the previous Qt crash and is not evidence of a successful import. The release candidate is a test build, not a qualified production workaround.

## Consequence for Pocketry

Do not alter the authored CAD geometry, flatten names, convert to triangles, or suppress the import dialog to mask this crash. A normal supported build containing the Qt fix must pass both `bin.step` and `design-objects.step` from A and B, then edit, save and reopen them before the FreeCAD workflow gate can close. Existing twelve-case FreeCAD API and 32-comparison independent STEP evidence remains historical and separate.

Both unchanged branches were re-exported from authored fixtures for this follow-up, with revision, package and snapshot hashes retained locally. Their files differ from the older retained fixture exports, so no byte-identical comparison to the October 7 input corpus is claimed.

## Reproduce and inspect

Run [qt-dialog-control.FCMacro](../scripts/freecad-step-acceptance/qt-dialog-control.FCMacro) from FreeCAD's supported macro editor or built-in Python console. It writes `qt-dialog-control.json` beside itself. Read the diagnostic dialog's accessibility tree and accept OK through native controls. Use a disposable test session with no user CAD documents. On the tested Qt 6.8.3 bundle this crashed the application; do not run it in an unsaved session.

Compact evidence is in [freecad-import-crash-evidence.json](freecad-import-crash-evidence.json). Raw local files are under `/Users/willcobb/Code.local/pocketry/outputs/freecad-import-root-cause-2026-10-15/`: the sanitized native crash, control record, annotated binary disassembly, hashes, official-download provenance, regenerated fixture packages and test-session cleanup. Third-party Qt source was read for diagnosis only and is not copied into Pocketry's runtime.

Local repository validation uses Node 22.23.3 and the required `npm run check`, `npm test`, `npm run build`, and `git diff --check` in each branch. Final results are recorded in the compact evidence. GitHub CI remains disabled. This follow-up changes investigation documentation and the development-only diagnostic macro; application geometry and the production default are unchanged.
