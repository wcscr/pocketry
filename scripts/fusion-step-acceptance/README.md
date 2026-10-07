# Native Fusion acceptance script

Create local fixture exports from both experimental worktrees with `scripts/export-cad-investigation.mjs`, using a shared output parent with `dedicated` and `unified` subfolders. Copy the adjacent `PocketryStepAcceptance/config.example.json` to `config.json` and set the actual fixture/output paths.

In Fusion, create a temporary document, open **Utilities → Add-ins → Scripts and Add-Ins**, choose **Script or add-in from device**, select the `PocketryStepAcceptance` folder, and run it. No startup add-in is enabled. It uses supported native Fusion APIs and local F3D/STEP exports; no cloud save/upload method is called.

The report records input hashes, version, dimensions, solids, analytic curves, source identity/placement, new native features, reconstruction and moves, reopening and errors. Only documents opened by this test are closed. Native STEP volume estimate drift is recorded for independent boundary comparison, not interpreted as geometry equivalence.

See `docs/fusion-step-acceptance.md` for actual observed results and pending checks. The completed native run used Fusion 2705.1.15. The follow-up that adds baseline STEP exports and separates volume-estimate warnings still awaits native execution.
