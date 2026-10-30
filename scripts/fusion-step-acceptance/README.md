# Native Fusion acceptance script

Create local fixture exports from both experimental worktrees with `scripts/export-cad-investigation.mjs`, using a shared output parent with `dedicated` and `unified` subfolders. Copy the adjacent `PocketryStepAcceptance/config.example.json` to `config.json` and set the actual fixture/output paths.

In Fusion, create a temporary document, open **Utilities → Add-ins → Scripts and Add-Ins**, choose **Script or add-in from device**, select the `PocketryStepAcceptance` folder, and run it. No startup add-in is enabled. It uses supported native Fusion APIs and local F3D/STEP exports; no cloud save/upload method is called.

The report records input hashes, version, dimensions, solids, analytic curves, source identity/placement, new native features, reconstruction and moves, reopening and errors. Only documents opened by this test are closed. Native STEP volume estimate drift is recorded for independent boundary comparison, not interpreted as geometry equivalence.

See `docs/fusion-step-acceptance.md` for observed results and separate release gates. All 12 cases passed in Fusion 2705.1.15 on 2026-10-07, including baseline STEP exports and volume-estimate warnings.

Independently verify the native outputs using `python scripts/verify-fusion-step-edits.py /path/to/fusion-step-acceptance` in the existing OCCT 7.8 verification environment (`cadquery-ocp==7.8.1.1.post1`). Keep the `inputs/` and `results/` folders together. The checker validates input hashes, closed solids, absence of mesh representations, the requested hole, baseline reconstruction and 3 mm cutter movement. Numerical volume estimates are recorded alongside empty symmetric solid differences; neither alone proves a maximum local surface error.
