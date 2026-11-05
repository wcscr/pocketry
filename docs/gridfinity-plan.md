# Bin designer implementation reference

This describes the current implementation, checked against the source on
November 4, 2026. The filename is retained for existing links; this is not a
roadmap. [GitHub issues](https://github.com/wcscr/pocketry/issues) track enhancement
requests and problem reports. See the [documentation index](README.md) for
feature references and dated investigation records, and [CHANGELOG.md](../CHANGELOG.md)
for user-visible changes.

## Current capabilities

| Area | Implemented behavior | Reference |
| --- | --- | --- |
| Inputs | Calibrated photo traces and drawn rectangle, square, or circle pockets; outlines remain editable | [Trace](../client/src/pages/trace.tsx), [Bin](../client/src/pages/bin-designer.tsx) |
| Footprints and size | Full/half/quarter Gridfinity pitch; connected, hole-free custom cell footprints; arbitrary rectangular dimensions for flat or jig bases | [Grid pitch](grid-pitch.md), [size rules](../shared/gridfinity/bin-size.ts) |
| Construction | Solid or hollow interior, fill height, wall thickness, stacking rim, base/mounting choices | [Controls](../client/src/components/gridfinity/bin-controls-panel.tsx), [bin schema](../shared/gridfinity/types.ts) |
| Hollow bins | Rows/columns, dividers, scoop bottoms, bottom edge fillets, and tabs on the outer wall or each sub-bin | [Compartments and tabs](bin-compartments.md), [bottom fillets](bottom-edge-fillet.md) |
| Pockets and access | Independent placement/size/depth, split depths, retained-material holes, finger access, contour editing, and auto-arrange | [Split pockets](split-pockets.md), [placement schema](../shared/gridfinity/cutout.ts) |
| 3D placement | XYZ rotation/elevation and optional vertical or object-axis insertion clearance | [Rotation](pocket-rotation.md), [insertion paths](pocket-insertion-paths.md) |
| Labels | Raised text and hardware symbols on filled surfaces or label shelves; hollow-bin labels use shelves | [Hardware symbols and label surfaces](hardware-symbols.md) |
| Materials | Body, floor/interior, rim/top-border, optional divider-top, label-background, and text colors; non-overlapping material parts in multicolor 3MF | [Material schema](../shared/gridfinity/materials.ts), [builder](../client/src/lib/gridfinity/bin.ts) |
| Fixtures | Wham Bam Systems ULTIM8-compatible pegs, arbitrary dimensions, and 1:1 alignment SVG | [Jig geometry and export](ultim8-peg-bottom.md) |
| Persistence | Browser-local autosave, named library, undo/redo, project and library import/export | [Project schema/migrations](../shared/gridfinity/project.ts), [project storage](../client/src/lib/project/) |
| Output | Single- or multi-color 3MF, STL, thin fit checks, and SVG/DXF layouts | [DXF](dxf-compatibility.md), [mesh writers](../client/src/lib/mesh/) |

Construction is grouped into **Interior**, **Walls & rim**, **Compartments**,
**Floor & scoops**, **Base & mounting**, and **Label tabs**. Feature switches and
section disclosures are independent; hiding a setting must not discard its saved
value. New tabs default to **Each sub-bin**, with adjustable recess, front rim,
inward depth, and partial width. Existing designs retain their saved choices.

Slanted-wall editing, linked designs, and grouped objects require **App settings
→ Enable experimental features**. Saved designs remain visible and exportable
with that preference off. The dedicated `/ultim8` entry exposes fixture controls
without requiring that opt-in; adding jig pegs from the ordinary bin workflow
uses the experimental controls. See [the settings dialog](../client/src/components/layout/experimental-features-dialog.tsx)
and [bin controls](../client/src/components/gridfinity/bin-controls-panel.tsx).

Baseplate generation is outside Pocketry's scope. SVG/DXF are supported outputs;
that does not imply an SVG/DXF import implementation. There is no hosted account
system, server project storage, shared online project library, or cross-device
sync in the current editor.

## Bin height and rounded stacking lip

Pocketry uses **Gridfinity Rebuilt's rounded stacking lip**, with a **0.6 mm
fillet radius** at the top edge. This rounding is inherited from Rebuilt.
See the [pinned upstream bin-height notes](https://github.com/kennetek/gridfinity-rebuilt-openscad/blob/910e22d8607fd7f5f51ad5e5cbc5287a76810bfd/gridfinity-rebuilt-bins.scad#L8-L18)
and the [port provenance](../client/src/lib/gridfinity/UPSTREAM.md).

For upright bins sized in Gridfinity height units, heights are measured from the
**bottom of the bin's feet**, excluding any baseplate. Each height unit is 7 mm
and already includes the base:

- Without a stacking lip: `7 × heightUnits` mm.
- With Pocketry's standard rounded lip: `7 × heightUnits + 3.5515` mm
  (rounded to four decimal places).
- The theoretical sharp lip reaches `7 × heightUnits + 4.4` mm. The 0.6 mm
  fillet lowers its peak to `4.4 − 0.6 × √2 ≈ 3.5515` mm above the nominal top.

| Height units | Without lip | Pocketry rounded lip | Theoretical sharp lip |
| --- | ---: | ---: | ---: |
| 3u | 21 mm | 24.55 mm | 25.40 mm |
| 6u | 42 mm | 45.55 mm | 46.40 mm |

The rounding preserves the stacking contact surfaces; Rebuilt documents that
it does not change the stacking height. A different lip-tip treatment can
therefore change overall bin height without changing where the next bin seats.
These are model dimensions; printed measurements also depend on slicing and
printing. A measured height difference alone does not establish a stacking-fit
problem or identify another generator's lip geometry.

## Architecture and source map

| Responsibility | Source |
| --- | --- |
| Bin dimensions, base profiles, and lip constants | [standard.ts](../shared/gridfinity/standard.ts), [types.ts](../shared/gridfinity/types.ts) |
| Project format, migrations, and history | [project.ts](../shared/gridfinity/project.ts), [history.ts](../shared/gridfinity/history.ts) |
| Placement, depth, insertion, and validation | [cutout.ts](../shared/gridfinity/cutout.ts), [validate.ts](../shared/gridfinity/validate.ts), [pocket-insertion.ts](../shared/gridfinity/pocket-insertion.ts) |
| Shared editor state and transactions | [bin-store.tsx](../client/src/state/bin-store.tsx), [shape-library.tsx](../client/src/state/shape-library.tsx) |
| Layout and 3D views | [layout-canvas.tsx](../client/src/components/gridfinity/layout-canvas.tsx), [bin-viewport.tsx](../client/src/components/gridfinity/bin-viewport.tsx) |
| Geometry assembly and material partitioning | [bin.ts](../client/src/lib/gridfinity/bin.ts), [cutouts.ts](../client/src/lib/gridfinity/cutouts.ts), [object-cavity.ts](../client/src/lib/gridfinity/object-cavity.ts) |
| Worker scheduling and builds | [use-bin-geometry.ts](../client/src/lib/gridfinity/use-bin-geometry.ts), [bin-worker-handlers.ts](../client/src/lib/gridfinity/bin-worker-handlers.ts) |
| Upstream port provenance and deviations | [UPSTREAM.md](../client/src/lib/gridfinity/UPSTREAM.md), [NOTICE](../NOTICE) |

Geometry code takes an injected `Kernel`; it must not import the Manifold
singleton. Track WASM handles in an `Arena` and dispose them deterministically.
Detach returned mesh data before disposing its owning solids. Reuse the existing
Manifold/Clipper2 geometry path rather than introducing a second geometry kernel.

Trace outlines use oriented rings. Convert pixels to millimetres and flip Y once
at the Trace export/normalization boundary. Bin-local placement and layout
exports already use millimetres with Y up. A coordinate conversion added inside
a downstream bin writer would duplicate that transformation.

Rigid pockets use a finite source solid, its pose, and a separately derived
cavity/insertion envelope. Preserve the source when deriving selection wires,
fill-surface openings, floor limits, and color masks. Split sections, retained
material, and insertion clearances must use the same geometry in preview,
validation, and export. Overlapping pocket cuts are generally warnings, while
invalid geometry and unresolved export blockers prevent printable export.

## Persistence and editing guarantees

The current project format is defined by `PROJECT_SCHEMA_VERSION` in
[project.ts](../shared/gridfinity/project.ts), rather than by a copied version
number in this document. Migrations preserve supported older designs, history,
explicit choices, geometry links, and font data. See [import limits](import-limits.md)
for bounded parsing and unsupported/corrupt record handling.

Projects and the named library live in IndexedDB in the current browser profile.
Project/library exports are explicit backups, not cloud synchronization. Preserve
an outgoing named project's changes before switching projects; confirm before
replacing a nonempty unnamed draft. Failed saves or imports must retain recoverable
data and must not silently switch the autosave target. A portable project does
not include the original Trace photo; users must retain it separately.

The server serves the editor and static assets. The retired image-upload API and
storage scaffold are removed. [Self-hosting](self-hosting.md) does not change
where user projects are stored; container backups do not back up browser data.

## Preview and export

Preview and export share the geometry builders but use different quality and
scheduling policies. Interactive previews may omit expensive rounding and later
refine after input settles. Draft or stale statistics must not be presented as
exact export results. Export uses a committed snapshot and its own quality;
preview simplification must not change the saved design or exported geometry.

The preview hook batches input and keeps the latest pending request behind a
running job. Interactive and detailed/export work use separate workers. Ignoring
an obsolete reply does not interrupt synchronous WASM already running. Worker
failure must release the endpoint and show a recoverable error. See
[preview performance](preview-performance.md) for the dated measurements and
[the current hook](../client/src/lib/gridfinity/use-bin-geometry.ts) for timing values.

3MF carries millimetre units and can contain separate material volumes; STL
carries geometry without those color assignments. Inspect serialized output as
well as in-memory solids. Do not substitute display normals or rounded preview
coordinates for the printable mesh. [Geometry export integrity](geometry-export-integrity.md)
records why tiny native-precision features need care at the writer boundary.

The 3MF export dialog warns that Bambu Studio 2.9.1.70 loses colors on separate
parts. **Bambu-compatible 3MF** is a temporary alternative: it combines the
selected material meshes into one model with per-face colors. The body, color
regions, and text no longer appear as separate named parts. Geometry and vertex
identities are preserved; no printer or filament profiles are bundled. Import it
in Bambu Studio and map each displayed color to a filament. The regular
**Multi-color 3MF** option retains separate parts. See [Bambu compatibility](bambu-3mf-compatibility.md)
and [issue #211](https://github.com/wcscr/pocketry/issues/211).

Fit checks reduce print cost but answer narrower questions. A surface check tests
openings and, for a full-surface plate, relative spacing; it does not validate
pocket depth, insertion through the complete cavity, stacking, or baseplate fit.
Tool-outline bands can print as separate pieces. SVG/DXF layouts are 2D cutting
or alignment outputs, not printable 3D bins.

## Verification and physical evidence

Run the local checks in [CLAUDE.md](../CLAUDE.md). The quick suite is the routine
gate; geometry changes need the affected qualification tests and representative
serialized outputs. Shared mesh/material/export changes require the complete
geometry suite. UI changes need relevant workflow tests. Do not start hosted CI.

Check manifold status, dimensions, volume/topology, actual mesh sections, and
material partitions. Keep tests independent enough to detect a mistaken builder;
byte-for-byte golden meshes alone are brittle when tessellation changes.

The original G1–G5 software milestones are implemented. The
[sample library](../samples/README.md) contains printed-bin photographs,
loaded tools, and stacking examples. Those are evidence for the documented
samples, not qualification of every current feature or regenerated export.

Feature-specific limits still matter: insertion fit, extreme wall slants, tall-bin
stiffness, jig peg retention, label supports, and new material/printer combinations
need relevant physical checks. Keep actual design/version, slice, material,
printer, measurements, and results with a sample or issue. Do not infer a passed
physical check from unit tests, slicer acceptance, or an unrelated photograph.

## Maintenance

Update the relevant current feature reference and, for user-visible changes,
`CHANGELOG.md` in the same contribution. Maintainers review those updates before
integration and own release versions/dates. Keep detailed proposals, priorities,
and problem status in [GitHub issues](https://github.com/wcscr/pocketry/issues).
Dated investigation records can preserve prior decisions and measurements; link
them as evidence without treating their old task lists as the current roadmap.

Every contribution follows [CONTRIBUTING.md](../CONTRIBUTING.md). Existing upstream
notices are recorded in [NOTICE](../NOTICE); changes involving dependencies,
ported code, or assets need a new review of their actual use and delivered notices.
