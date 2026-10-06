# Experimental CAD engine: compatibility and provenance review

This review covers the user-authorized STEP/CAD investigations only. It permits
local linking and bundling of the pinned kernel subject to the distribution
requirements below. Neither investigation is a production default.

## Engine and compiled inputs

`replicad-opencascadejs@1.1.0` declares LGPL-2.1-only. Pocketry keeps the library
and its notices under that license; Pocketry's own adapter remains AGPL-3.0-only.
The Open CASCADE exception applies to the upstream OCCT portions, not as a
blanket exception for the whole npm package. The code uses facilities provided
by Open CASCADE Technology. FreeType is used under the FreeType License (FTL).
RapidJSON and Emscripten runtime portions retain their upstream notices.

Pinned inputs, independently inspected on 2026-10-06:

| Input | Revision | License |
| --- | --- | --- |
| replicad package, wrappers, binding definitions | e4b05f67dc4e2393a876ce8c5064a9c93db05bf1 | LGPL-2.1-only; repository portions retain MIT where marked |
| taucad/opencascade.js compiler, generated bindings and OCCT patches | ebd263f15337b440b391492af073662707e86482 | LGPL-2.1 with OCCT exception for OCCT portions |
| OCCT 8.0.1 | b8f597c677811d1f9f4d8a97f5ae2825c0353a42 | LGPL-2.1 with OCCT exception |
| FreeType 2.13.0 | de8b92dd7ec634e9e2b25ef534c54a3537555c11 | FTL selected, preserved attribution |
| RapidJSON | 24b5e7a8b27f42fa16b96fc70aade9106cf7102f | MIT and upstream third-party notices |
| Emscripten runtime | 5.0.1 | MIT / University of Illinois-NCSA, upstream exceptions |

The compiler's `DEPS.json`, Dockerfile, patches and build scripts are retained in
the source archive. The replicad archive includes the original wrappers and ytt
build configurations. LLVM 17.0.6 is build tooling; its license and download
information remain in the compiler source. No compiler/toolchain binary is
served by Pocketry.

The selected build uses `ghcr.io/taucad/opencascade.js:canary-ebd263f1-single-threaded`
and Emscripten SDK 5.0.1 image digest
`sha256:c89732ef63a56de5a96395c5a8c1c7904f7420131a045406e6fedc4cbe1cc198`.
The upstream compiler tag is commit-qualified but its registry digest is not
attested here. A bit-for-bit rebuild has not been established. Rebuild using
the archived sources and original `buildSingle` recipe; do not infer binary
reproducibility from source availability.

## Compatibility decision and distribution requirements

LGPL permits use with Pocketry's free AGPL application provided the library's
terms, notices, source access, modification and replacement rights are retained.
The JavaScript module and WASM remain separate replaceable assets. Pocketry
provides all adapter/application source and build instructions; no EULA restricts
reverse engineering or modification of the library. The npm license is not
changed to AGPL and the exception is not extended to non-OCCT code.

Before a local bundle, run `python3 scripts/prepare-cad-sources.py`. This places
the complete pinned library source, compiler patches, wrappers and recipes,
compiled dependency source, full licenses and hashed manifest at
`client/public/licenses/cad/`. Static hosting serves them at `/licenses/cad/`.
To recover an archive, concatenate its numbered parts in manifest order and
check the complete SHA-256 before extraction. Parts stay under 20 MiB for static
hosting. No written future source offer is used.

Before any public distribution, independently verify these same source/notices
are downloadable beside the exact emitted JS/WASM, retain their availability,
and review any additional compiled inputs revealed by a rebuild. Public release
is a separate gate; installing the package does not itself satisfy it.

Single-threaded WASM is 22,980,267 bytes (7,193,790 bytes gzip); loader JS is
60,124 bytes (22,482 gzip). The upstream settings start memory at 100 MiB and
allow growth to 4 GiB. Pocketry's 512 MiB between-operation guard cannot interrupt
a native allocation. Worker termination and recovery are therefore mandatory.
Only this build is imported; no pthreads or cross-origin isolation are needed.

## Single-kernel exception

The user explicitly authorized two isolated experiments. A retains Manifold for
printing and constructs STEP independently from authored parameters. B uses CAD
boundary geometry for all bin outputs. Each complete bin uses one kernel; no
bin silently switches engines. This narrowly scoped exception is recorded in
CLAUDE.md. Selecting a production approach remains a human review gate.

## Primary provenance

- [Package and build definitions](https://github.com/sgenoud/replicad/tree/e4b05f67dc4e2393a876ce8c5064a9c93db05bf1/packages/replicad-opencascadejs)
- [Compiler, pinned dependencies and patches](https://github.com/taucad/opencascade.js/tree/ebd263f15337b440b391492af073662707e86482)
- [OCCT source and licenses](https://github.com/Open-Cascade-SAS/OCCT/tree/b8f597c677811d1f9f4d8a97f5ae2825c0353a42)
