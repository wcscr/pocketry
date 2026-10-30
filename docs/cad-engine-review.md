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
RapidJSON and Emscripten runtime portions retain their upstream notices. The
current build uses emmalloc directly; mimalloc source/notices are retained for
the upstream and `1.1.0-pocketry.1` comparison builds.

Pinned inputs, independently inspected on 2026-10-06:

| Input | Revision | License |
| --- | --- | --- |
| replicad package, wrappers, binding definitions | e4b05f67dc4e2393a876ce8c5064a9c93db05bf1 | LGPL-2.1-only; repository portions retain MIT where marked |
| taucad/opencascade.js compiler, generated bindings and OCCT patches | ebd263f15337b440b391492af073662707e86482 | LGPL-2.1 with OCCT exception for OCCT portions |
| OCCT 8.0.1 | b8f597c677811d1f9f4d8a97f5ae2825c0353a42 | LGPL-2.1 with OCCT exception |
| FreeType 2.13.0 | de8b92dd7ec634e9e2b25ef534c54a3537555c11 | FTL selected, preserved attribution |
| RapidJSON | 24b5e7a8b27f42fa16b96fc70aade9106cf7102f | MIT and upstream third-party notices |
| Emscripten runtime | 5.0.1 | MIT / University of Illinois-NCSA, upstream exceptions |
| emmalloc and sbrk, current compiled allocator | Emscripten 5.0.1 | MIT or University of Illinois/NCSA |
| mimalloc with Emscripten port, upstream/pocketry.1 baseline only | 2.1.7, upstream 8c532c32c3c96e5ba1f2283e032f69ead8add00f | MIT |

The allocator entries were verified on 2026-10-30. The compiler's pinned
`single-threaded` preset selects `OCJS_MALLOC=mimalloc`; the link driver supplies
`-sMALLOC=mimalloc` when the consumer recipe does not specify another allocator.
The preset, rather than older benchmark prose describing dlmalloc, is the build
input. Pocketry's `single-thread-emmalloc.patch` explicitly adds
`-sMALLOC=emmalloc` to the original single-threaded YAML link recipe, overriding
that preset. The `1.1.0-pocketry.2` link provenance records this flag; it links
Emscripten's `system/lib/emmalloc.c` and `system/lib/libc/sbrk.c` directly,
without mimalloc. The compiler/kernel source and geometry settings are unchanged.

Emscripten's `system/lib/mimalloc/README.emscripten` identifies version 2.1.7
and its Emscripten-specific changes. Its complete 43-file source directory
(741,049 bytes) is already inside the served Emscripten 5.0.1 archive. The
directory was compared file by file with the running pinned compiler image;
all file hashes matched. `sources.json` records those hashes and the tree hash
`952fc17353892d0cfbb6f7e59c9bd16848c5e1290035350905f1805b9febe1a7`.
The standalone `mimalloc-LICENSE` has SHA-256
`19c99805e7a44a34b297a75d1edea9985e300066dfc024d5c99d4236d4573b5d`.

The mimalloc license credits Microsoft Corporation and Daan Leijen
(2018–2021); the Emscripten port also credits Microsoft Research, Daan Leijen
and Alon Zakai (2018–2023). Its port uses Emscripten's `system/lib/emmalloc.c`
and `system/lib/libc/sbrk.c`, not a separate operating-system allocator. Both
files and `tools/system_libs.py`, which selects the compiled inputs, are
included and hashed in the source manifest. These mimalloc-specific records
describe baseline/rebuild evidence, not code compiled into `1.1.0-pocketry.2`.

Emscripten's root dual license does not replace its bundled components' terms.
The archive retains `system/lib/libc/musl/COPYRIGHT` (MIT with its listed
file-specific notices) and `system/lib/{libcxx,libcxxabi,compiler-rt}/LICENSE.TXT`
(Apache-2.0 with LLVM exceptions and the retained legacy terms). Exact paths,
sizes and hashes are in `sources.json`. The full Emscripten notice, including
its Node.js and bundled-source exceptions, is served as `emscripten-LICENSE`.

The compiler's `DEPS.json`, Dockerfile, patches and build scripts are retained in
the source archive. The replicad archive includes the original wrappers and ytt
build configurations. LLVM 17.0.6 is build tooling; its license and download
information remain in the compiler source. No compiler/toolchain binary is
served by Pocketry.

The original package's build recipe uses
`ghcr.io/taucad/opencascade.js:canary-ebd263f1-single-threaded`
and Emscripten SDK 5.0.1 image digest
`sha256:c89732ef63a56de5a96395c5a8c1c7904f7420131a045406e6fedc4cbe1cc198`.
The local repair uses the compiler's immutable Linux arm64 image digest
`sha256:b900017985fc32e296e01531a3483d4041fd39c51e9a0be365e97e5295f15da7`.
This pins the rebuild environment; it does not establish that the original npm
artifact was built from that exact image. A bit-for-bit reproduction of the
original package or an independent full source rebuild has not been established.

## Local binding and allocator repairs

The vendored package is `replicad-opencascadejs@1.1.0-pocketry.2`.
Native ownership, sharp-fixture mesh acceptance and the independent STEP
comparison passed on 2026-10-30. The original upstream and prior `pocketry.1`
identities remain separately recorded; this is a modified library.
The package retains the single-threaded ESM loader, CommonJS import wrapper,
TypeScript declarations and WASM. CommonJS and TypeScript files are byte-identical
to upstream; the ESM loader and WASM changed. No multithreaded build is included.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `replicad_single.wasm` | 22,927,086 | `c4dec33bb5c623782ccdba290c5c4b280cf9a458b2d62d59dc4f900d6f87a255` |
| `replicad_single.js` | 58,648 | `452800b7bd503098ad5ff47afeb19d264aa2432de1d931eeb922614bcb1e2a8c` |
| `replicad_single.cjs` | 107 | `e13327f9a883a467eabf1eee8635c7b3687be96dd100acb6bff8a68759b7dfff` |
| `replicad_single.d.ts` | 1,617,183 | `b44516bd24e6abf0dbe680086e286b117d77299ea77e80f230220dc77d250b08` |

The first repair changes the binding generator's destructor eligibility check.
OCCT's allocation macro supplies an ordinary owning delete operator alongside
a placement-delete operator. The upstream generator incorrectly replaced
ordinary destruction with an empty function whenever placement delete existed.
The patch permits normal destruction when an ordinary public delete exists,
while preserving the existing handling of inaccessible destructors. It does
not change OCCT modeling algorithms, shape definitions or requested tolerances.

The second repair changes the link-time allocator selection to emmalloc. It
does not change OCCT algorithms, mesh quality, tolerances or resource limits.
In the sharp Wiha B export, complete/body/text positions and indices were
byte-identical at the same 74,260 final triangles. Peak WASM capacity fell from
594.625 MiB with `pocketry.1` to 207.375 MiB with `pocketry.2`.

The served rebuild inputs are `native-destructors.patch`, `single-thread-emmalloc.patch`,
`build-cad-engine.sh`, and supporting scripts and inventories under `cad-build/`.
The source manifest's `localRepair` record contains the artifact identities and
qualification status. Preparation of upstream sources preserves this record
rather than overwriting it. The portable recipe identifies the image digest
and compiler flags, runs with networking disabled, verifies source/patch hashes,
and accounts for selected bindings and custom wrappers regenerated at link time.
Reusing the pinned image's OCCT
libraries is a selective binding rebuild; it is not a full source rebuild of
the kernel or a bit-for-bit reproducibility claim. The actual `.2` relink used
the locally cached repaired-binding image
`sha256:02d2d51ff183ecfdb5020359efc516d0410b14d994688443a0d38a496e70cf96`.
The portable recipe starts from the public pinned compiler image, regenerates
the repaired bindings, verifies/applies both patches and links. That complete
clean-image `.2` rebuild has not been run; the source-preparation and patch
steps are separately checked. Prior `.1` evidence is retained under
`cad-build/pocketry.1-baseline/`.

The destructor inventory retains all 454 registered classes and repairs 169
owning destructors. The two remaining empty destructors are deliberate:
`BRepAlgoAPI_Algo` and `CDM_Document` have protected constructors/destructors;
their public concrete types and handles own destruction. The recorded checks
cover returned shapes after builder deletion, subshapes after explorer deletion,
copied list values, reference-counted curves and Boolean input/result lifetime.
Creating and deleting 5,000 fresh exact `BRepCheck_Analyzer` objects held the
WASM heap at 100 MiB. The upstream binding leaked native objects in that test.

Independent OCCT 7.8 checks of the `.2` sharp Wiha fixture found the same 15 named
bodies, placements, bounds, volumes, topology, curve classes and surface classes.
All 30 directional Boolean differences had zero volume, and neither STEP file
contained tessellation. The source project bytes and snapshot identity were unchanged.
The `.1` sharp STEP export used a 163.0625 MiB WASM heap; `.2` uses 120 MiB.
The unmodified authored Wiha
case now reaches its invalid bottom fillet at 100 MiB, below the normal guard,
but still correctly produces no ZIP. Outlines and requested radii are unchanged.
The allocator repair removes that memory obstacle; it does not make the fillet
valid. Production memory limits and geometry acceptance rules are unchanged.

The upstream-generated link provenance retains its cached build's August 2
timestamp and build ID. The local repair was built and tested on October 30;
the separate repair metadata and artifact hashes identify that build. Neither
the inherited timestamp nor the cached library inventory proves an independent
source rebuild of the original compiler image.

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
hosting. Verified existing archive parts are reused; `--offline` forbids fetching
missing archives. Notices are extracted from the hash-verified source archives.
The script also refreshes this served review, the notices and the download index.
It preserves local repair and artifact metadata. No written future source offer
is used.

Before any public distribution, independently verify these same source/notices
are downloadable beside the exact emitted JS/WASM, retain their availability,
and review any additional compiled inputs revealed by a rebuild. Public release
is a separate gate; installing the package does not itself satisfy it.

The original upstream single-threaded WASM is 22,980,267 bytes (7,193,790 bytes gzip); loader JS is
60,124 bytes (22,482 gzip). The upstream settings start memory at 100 MiB and
allow growth to 4 GiB. Pocketry's 512 MiB between-operation guard cannot interrupt
a native allocation. Worker termination and recovery are therefore mandatory.
Only the single-threaded build is imported; no pthreads or cross-origin
isolation are needed. The repaired artifact identities are recorded above;
the original sizes here describe the upstream comparison artifact.

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
- [mimalloc source and Emscripten port](https://github.com/emscripten-core/emscripten/tree/5.0.1/system/lib/mimalloc)
- [Emscripten allocator build selection](https://github.com/emscripten-core/emscripten/blob/5.0.1/tools/system_libs.py)
