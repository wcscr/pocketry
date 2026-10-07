# Native FreeCAD acceptance macro

Use the same authored fixtures and STEP inputs as the Fusion acceptance corpus. Generate them from both experimental worktrees with `scripts/export-cad-investigation.mjs` and keep a local `inputs/dedicated/<fixture>/` and `inputs/unified/<fixture>/` tree. Copy `config.example.json` to `config.json` alongside `PocketryStepAcceptance.FCMacro` and set absolute input/output paths. Use a fresh output directory for each run.

In the installed FreeCAD desktop application, run the macro from the native macro editor, or use its built-in Python console:

```python
import runpy
_pocketry_acceptance = runpy.run_path('/absolute/path/to/PocketryStepAcceptance.FCMacro')
```

The 2026-10-07 desktop run used the built-in console in FreeCAD 1.1.4, Python 3.11.14 and OCCT 7.8.1. A separate bundled-Python run exercised the geometry without a GUI; it is retained separately and is not substituted for desktop evidence.

The macro imports both STEP files, checks closed valid solids, independent dimensions, circles/ellipses, object IDs/names/placement, creates an editable native `Part::Cylinder` and `Part::Cut` for a 4 mm hole, and saves/reopens the FCStd and re-exported STEP. It reconstructs from the actual named blank/tools using native `Part::Cut` dependencies, moves one cutter 3 mm along X where applicable, verifies its finite source is unchanged, and reopens the resulting FCStd/STEP. A fully raised inactive cutter must have no imported dummy solid. Native features and tools are placed in the same imported `App::Part` container; feature scope and healthy dependencies are checked before and after reopening. Each saved document is closed before a fresh disk load because FreeCAD otherwise reuses its open document.

FreeCAD expands disconnected compounds such as raised letters into an `App::Part` and separate `Part::Feature` children. The checker resolves their topmost shared ID, validates all component solids and combined bounds, and preserves the native hierarchy. It never fuses or repairs these solids to make a check pass. Exported construction tools intentionally overlap.

Only test-created documents are closed. All input/output is local. The macro does not change import preferences, install add-ons, upload projects, or modify pre-existing documents. In GUI mode it also saves native viewport images with construction tools hidden. Test-generated native feature history is new FreeCAD history; the STEP inputs do not contain Pocketry's parametric history.

All twelve final GUI API cases passed. Separately, accepting unchanged STEP Import Settings through the normal File → Open workflow crashed FreeCAD 1.1.4 on macOS 26.6.2 with both irregular bin exports, including fresh sessions and keyboard confirmation. The same workflow also crashed on a simple 10 mm box STEP created by the installed FreeCAD. This control suggests a broader desktop/dialog runtime issue but does not establish the cause. The normal dialog workflow remains an unresolved release gate; native API success is not substituted for it. See `docs/freecad-step-acceptance.md` and the bounded crash evidence.

Use `python scripts/verify-freecad-step-edits.py /path/to/freecad-step-acceptance` in the existing separate OCCT 7.8 reader environment (`cadquery-ocp==7.8.1.1.post1`) after a successful twelve-case run. Keep `inputs/` and `results/` together. It checks input hashes, native STEP solids/no mesh representations, requested holes, baseline reconstruction and moved-cutter reconstruction. Numerical volume estimates remain separate from empty symmetric solid differences; no maximum local surface error is claimed.

FreeCAD's [macro documentation](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Macros.md) and [native Part shape API](https://freecad.github.io/API/d8/ded/classPart_1_1TopoShape.html) describe the execution and geometry APIs. Actual signatures were checked against this installed build. FreeCAD is a separately installed test application, not a Pocketry runtime dependency.
