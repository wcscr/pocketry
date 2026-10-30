# Native Fusion STEP editing evidence

On **2026-10-07**, all **12 native cases** passed. Fusion **2705.1.15** was tested through its supported Python API, launched from the native Scripts and Add-Ins dialog. All operations used local STEP files and local F3D/STEP exports.

| Fixture | A: dedicated STEP | B: unified CAD |
| --- | --- | --- |
| Standard solid | Full native edit checks pass | Full native edit checks pass |
| Standard hollow | Full native edit checks pass | Full native edit checks pass |
| Mixed pockets | Full native edit checks pass | Full native edit checks pass |
| Concave profile and ellipse | Full native edit checks pass | Full native edit checks pass |
| Tilted split pocket | Full native edit checks pass | Full native edit checks pass |
| Irregular footprint and text | Full native edit checks pass | Full native edit checks pass |

Completed checks include valid solids, independently specified dimensions, analytic 3.75 mm corners, the 6 mm circle and 9.8/4.9 mm ellipse, stable IDs and duplicate Unicode names, original source/tool placement, a new native 4 mm hole, reconstruction from the named blank/tools, a 3 mm named-cutter move without changing its source object, and reopening local F3D/STEP exports. Standard bins have no pocket cutter to move. A fully raised pocket retains its source and has no imported dummy cutter. New native hole/move features survive F3D reopening; imported Pocketry feature history is not supplied.

The first Fusion import exposed a real issue: Fusion uses STEP product-definition names and discards assembly-instance names. Both experimental writers now put the stable Pocketry ID on both labels, allowing reconstruction to identify duplicate names reliably. The project retains the original human names. A regression checks product names, and the independent reader checks both definition and occurrence identity.

The irregular F3D archive preserves its edited volume exactly. Fusion's reported volume changes by approximately **0.219243 mm³** after STEP reimport. An independent OCCT 7.8 comparison constructs the requested hole from the original model and recognizes **zero extra/missing material** in all 32 compared STEP files: 12 edited bins, 12 baseline reconstructions, and eight moved-cutter reconstructions, with valid Boolean results and no residual solids. Numerical mass integration varies across equivalent trimmed surfaces; this is not a maximum local surface-error measurement. Independent volume estimates alone differ by up to about 6.066107 mm³ on the concave case even though symmetric CAD differences are empty. The precise measurements are retained rather than treating volume estimates as a proof of exact geometry.

The irregular/text fixtures now pass both source/tool reconstructions and cutter movement. Their baseline reconstruction preserves four solids; moving the actual circle cutter 3 mm along X retains its finite source unchanged and adds about 283.724609 mm³ to the rebuilt bin because it changes the overlap with finger access. New cut/move features reopen with healthy Fusion status. The local edited irregular F3D archives from both approaches were also opened through Fusion’s UI and visually inspected.

The FreeCAD native API corpus now passes; its normal import-dialog crashes remain a separate failed workflow check. See [freecad-step-acceptance.md](freecad-step-acceptance.md). Physical prints, broader feature coverage, and backend selection remain separate gates. Neither approach became the production default.

Both branches pass local Node 22 checks, 165 test files / 2778 tests, build, and whitespace validation. No GitHub CI, PR, push, merge, or deployment was performed.

Raw local artifacts are under `/Users/willcobb/Code.local/pocketry/outputs/fusion-step-acceptance/`; they are not tracked. Compact tracked evidence is in `docs/fusion-step-evidence.json`. The artifact folder contains:

- `fusion-summary.json`: compact native outcomes, exact input hashes, independent comparisons and local gates.
- `results/fusion-edit-report.json`: all 12 completed native cases, including baseline and moved reconstructions and feature health.
- `results/dedicated/<fixture>/` and `results/unified/<fixture>/`: edited F3D and STEP files.
- `inputs/`: freshly regenerated fixture packages with the naming correction.
- `fusion-independent-edits.json`: independent edit and reconstruction geometry comparisons.
- `compare-fusion-edits.py`: reproducible independent reader checks, including input hashes, closed solids and absence of mesh representations.
- `PocketryStepAcceptance/`: the executed native acceptance script.
- `native-volume-check-run/`: retained earlier run with the halted volume-estimate checks; superseded by the completed run above.

The script creates and closes its own test documents, exports locally, and leaves pre-existing documents alone. The executed follow-up exports baseline reconstruction STEP files and records Fusion numerical volume drift as a warning requiring independent comparison.
