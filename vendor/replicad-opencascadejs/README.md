# Pocketry experimental CAD engine

This is the single-threaded ESM build of `replicad-opencascadejs@1.1.0`, rebuilt
as `1.1.0-pocketry.2` with a binding-generator correction: OCCT classes that
declare a public ordinary `operator delete` now run their native destructor.
The upstream generator incorrectly suppressed it when a placement delete was
also declared. There are no OCCT modeling-algorithm or tolerance changes.

The link configuration selects Emscripten's existing `emmalloc` directly,
instead of the original `mimalloc` arena layer. This reduces memory overhead
for the single-threaded CAD workload. It does not change tessellation quality.

Steve Genoud and upstream contributors retain copyright in the library.
The modified library retains LGPL-2.1-only; OCCT portions retain their separate
exception. Pocketry's binding-generator modification is provided under the
upstream generator's terms. Modification date: 2026-10-30.

The upstream single-threaded binding API is retained. ESM,
the unchanged upstream CommonJS import wrapper, TypeScript declarations, and
single-threaded WASM are included; the unused multi-thread distribution is omitted.

See `../../docs/cad-engine-review.md` for the compatibility review and exact
compiled inputs. Full licenses, corresponding source archives, the patch,
rebuild recipe, and artifact hashes are in
`../../client/public/licenses/cad/`, served beside the application at
`/licenses/cad/`. The JS/WASM remain replaceable assets. Rebuild/replacement does
not require permission from Pocketry, and no reverse-engineering restriction
is imposed.

This rebuild uses the pinned compiler image's original OCCT library caches.
It does not establish an independent full source rebuild of those caches.
