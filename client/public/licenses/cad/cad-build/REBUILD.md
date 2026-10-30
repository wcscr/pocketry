# Pinned CAD memory repair

The local `replicad-opencascadejs@1.1.0-pocketry.2` repair has two changes: correct owning native destruction and link the single-thread build with `emmalloc`. Neither change alters OCCT geometry algorithms, tessellation quality, tolerances, construction parameters, or application resource limits.

The npm `1.1.0` artifact routes 171 registered raw class destructors to an empty WASM function. Its pinned binding generator incorrectly treats a placement-delete overload as prohibiting ordinary deletion, including OCCT classes whose `DEFINE_STANDARD_ALLOC` also supplies valid public owning delete. `native-destructors.patch` corrects that predicate. `single-thread-emmalloc.patch` adds only the explicit `-sMALLOC=emmalloc` link flag to the original replicad single-thread YAML. An explicit YAML flag is required because the named compiler configuration overrides the allocator environment variable.

The October30 repair retains the compiler image’s August2 cache buildId/timestamp in its generated provenance sidecar. Those fields describe cached inputs, not the repair execution date. `build-provenance.json` records the actual .2 relink, hash and flags; `pocketry.1-baseline/` preserves the earlier mimalloc candidate's evidence without relabeling it as .2.

The candidate repairs 169 owning destructors. Two protected bases (`BRepAlgoAPI_Algo`, `CDM_Document`) intentionally retain raw no-op callbacks because their constructors/destructors are protected. Concrete derived classes and reference-counted handles own destruction. Their C++ source references are in `destructor-exceptions.json`; the native lifetime test confirms neither base exposes a public constructor.

## Rebuild

Requirements: Docker, Python 3.12+, `patch`, and approximately 10 GiB free build storage. Download the complete served `ocjs.tar.gz.part*` and `replicad.tar.gz.part*` archives alongside both patches and the recipe/support files. The build directory must be new or empty; nonempty directories are rejected without changing their contents. The helper always extracts the verified archives and verifies the generator, link configuration and patch hashes.

```sh
bash rebuild.sh /path/to/served/licenses/cad /path/to/new-build-directory
```

The wrapper pulls the immutable arm64 compiler image at `sha256:b900017985fc32e296e01531a3483d4041fd39c51e9a0be365e97e5295f15da7`, then runs the build without network access, with 4 CPUs, 8 GiB memory, and only the build directory mounted. This is the original pinned compiler revision `ebd263f15337b440b391492af073662707e86482`, containing Emscripten 5.0.1 and the pinned OCCT 8.0.1 compiled libraries. On non-arm64 hosts Docker requires arm64 execution support.

The recipe regenerates repaired bindings, recompiles all 171 originally empty-destructor class producers (missing classes fail the build), applies the allocator-only YAML patch, then links against unchanged cached kernel libraries. It verifies the final linking provenance contains `-sMALLOC=emmalloc`. The image caches unrelated binding objects and kernel libraries; this is not a full compiler/kernel rebuild or a claim of upstream npm bit-for-bit reproducibility.

The recorded .2 candidate was linked from a local snapshot of the already repaired .1 build container, using the same 317 bindings and 35 kernel libraries. This portable recipe starts from the original pinned image and has no dependency on that local snapshot. Its preparation and patch checks were exercised locally; a separate complete .2 rebuild from a fresh original image has not been run. Exact execution details and both image identities are recorded in `build-provenance.json`.

## Verify the result with Node 22

Run these from the prepared build directory:

```sh
node verify-destructors.mjs candidate/replicad_single.js candidate/replicad_single.wasm candidate-destructors.json
node compare-destructors.mjs original-destructors.json candidate-destructors.json destructor-comparison.json
node verify-analyzer-lifetime.mjs candidate/replicad_single.js candidate/replicad_single.wasm candidate-analyzer-lifetime.json
node verify-owned-shapes.mjs candidate/replicad_single.js candidate/replicad_single.wasm candidate-owned-shapes.json
```

The destructor audit observes actual Embind class registrations, resolves their callback entries through the live WASM table, and decodes the corresponding function bodies. It fails on unresolved callback code and verifies all 454 original class registrations. The two protected-base exceptions are explicit; any other remaining empty destructor fails.

The lifetime regression creates and deletes 5,000 fresh exact analyzers on alternating boxes, without analyzer reuse. It must preserve the initial 100 MiB WASM capacity and reject heap growth or invalid geometry. The ownership probe checks shape survival after builder destruction, copied explorer/container results, reference-counted curve survival, Boolean result/input lifetime, and protected constructor access.

These native binding checks are not full Pocketry geometry/export/browser acceptance. Run the application qualification suites and independent STEP comparisons before adopting or distributing the candidate. Native CAD app and physical printing acceptance remain separate gates.

## Qualified local candidate (2026-10-30)

- WASM: 22,927,086 bytes; SHA-256 `c4dec33bb5c623782ccdba290c5c4b280cf9a458b2d62d59dc4f900d6f87a255`.
- Use the paired generated JS: 58,648 bytes; SHA-256 `452800b7bd503098ad5ff47afeb19d264aa2432de1d931eeb922614bcb1e2a8c`.
- TypeScript declarations and the original CJS dynamic-import wrapper remain unchanged.
- All 454 registered classes retained; 169 owning destructors repaired; two protected bases preserved.
- 5,000 fresh exact analyzer cycles pass at 100 MiB initial/final WASM capacity.
- All eight ownership/access checks pass.
