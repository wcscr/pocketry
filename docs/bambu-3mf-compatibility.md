# Bambu and Prusa multi-color import

Bambu Studio 2.9.1.70 loses Pocketry's color assignments on separate 3MF parts.
The separate-part fix remains tracked in [issue #211](https://github.com/wcscr/pocketry/issues/211).

## Export and filament setup

Choose **Export → Save 3MF → Bambu / Prusa 3MF**. The downloaded file includes
`-compatible-multicolor-` in its name.

- **Bambu Studio:** map the displayed colors to your filaments during import.
- **PrusaSlicer:** select a multicolor printer configuration, then set the
  filament colors for the imported painted regions. Painting assigns filament
  slots; it does not import Pocketry's RGB palette into Prusa's filament presets.
  Alpha13 may report “Only geometry was loaded” because the file contains no
  printer configuration; the paint assignments are still retained.

Inspect the sliced layer preview before printing. The export supports up to 255
unique painted colors, subject to the slicer's and printer's own material limits.
Repeated RGB colors share a filament slot, in their first-appearance order in the
export. If a design exceeds 255 colors, use regular **Multi-color 3MF** or reduce
its colors; the compatible export reports the limit instead of dropping paint.

This option concatenates the printable meshes into one object. It preserves
coordinates, triangle winding, and distinct vertex identities, including
components that touch. It neither welds nor remeshes the parts. Body, inserts,
and text consequently stop appearing as separate named parts in the slicer.
Keep the optional editable Pocketry project backup to change them later.

The file identifies Pocketry as its application and includes no printer,
process, or filament profiles. Regular **Multi-color 3MF**, single-color 3MF,
and STL remain available. Regular multi-color export preserves named parts for
manual filament assignment; it does not include this painting compatibility data.

## Painting format

The compatible export keeps the standard 3MF Materials color group and per-face
`pid`/`p1` assignments used by Bambu. It adds two optional Prusa representations:

- **2.9.7:** `slic3rpe:mmu_segmentation` on painted triangles, with
  `slic3rpe:MmPaintingVersion` metadata. The namespace is
  `http://schemas.slic3r.org/3mf/2017/06` and is not a required extension.
- **3.0.0-alpha13:** `Metadata/Slic3r_facets_annotation.json` maps the combined
  mesh's object ID to triangle indexes and paint codes. Its
  `mmSegmentationFacetsVersion` matches the inline representation. JSON has an
  explicit OPC content-type entry.

Only whole triangles are assigned; this exporter does not subdivide faces.
Filament slots 1 and 2 use codes `4` and `8`; slots 3–16 use the version-1 extended
codes (`0C` through `DC`). Slots 17–255 use version 2 (`00EC` through `EEEC`).
Uncolored input faces are omitted from both paint maps and retain the slicer's
current default filament. Their triangle indexes still count toward later faces.
The standard color palette and both paint maps use the same deduplicated color
ordering.

Format references: [Prusa 2.9.7 triangle import](https://github.com/prusa3d/PrusaSlicer/blob/version_2.9.7/src/libslic3r/Format/3mf.cpp#L2135),
[paint serialization](https://github.com/prusa3d/PrusaSlicer/blob/version_2.9.7/src/libslic3r/Model.cpp#L1620),
[alpha13 facet JSON](https://github.com/prusa3d/PrusaSlicer/blob/version_3.0.0-alpha13/src/slic3r-shared/src/Slic3r/Biz/Format/3mf/PrusaFile.cpp#L640),
and [alpha13 legacy compatibility](https://github.com/prusa3d/PrusaSlicer/blob/version_3.0.0-alpha13/src/slic3r-shared/include/Slic3r/Biz/Format/3mf/LegacyPaintingCompat.hpp).

## Verification (2026-11-05)

Serialized tests cover exact coordinates, triangle indexes, per-face colors,
shared palette colors, mixed uncolored faces, closed touching components,
deterministic output, painting version boundaries, and absence of printer/process
profiles. UI workflows cover the export, optional editable backup, warning, and
independent label backgrounds. Real-bin geometry checks cover the paint maps of
six-label bins at 4U and 5.5U heights.

The integrated writer's two-color TAODAN bin was imported and saved by both
PrusaSlicer 2.9.7 and 3.0.0-alpha13. Both retained the exact paint map for all
42,988 triangles: 42,624 assigned to the body/text filament and 364 to label
backgrounds. Closed-cube files with 3, 16, 17, and 255 colors also retained their
exact maps, including version-2 encodings. Earlier GUI painting/import/save
checks independently confirmed the native format and the six separate label
background regions.

PrusaSlicer 2.9.7 also sliced the integrated bin at 0.2 mm layers with two
0.4 mm filament slots and 15% infill in a diagnostic configuration. The G-code
contained extrusion for both tools (48.64 cm³ and 2.48 cm³). Prusa reported long
bridging extrusions; this test checks color toolpaths, not a ready-to-print
machine profile. No configuration is embedded in Pocketry's export.

Bambu Studio 2.9.1.70's import preview still recognized both charcoal and ivory
regions after adding Prusa metadata. The same geometry's earlier Bambu sliced
preview showed ivory label backgrounds and charcoal text/body with H2D 0.4 mm
nozzles at 0.2 mm layers. The bin includes the label-background surface correction
merged in [PR #208](https://github.com/wcscr/pocketry/pull/208).

These checks do not establish physical-print qualification or compatibility with
every slicer version. Palette import and filament assignment are distinct: Prusa
retains the assignments but uses its own configured filament colors.

Dependencies and provenance: **None added or changed**. Official upstream source
was consulted to understand the file format; no third-party implementation or
assets were copied or adapted. The encoding is implemented independently from
the format behavior and checked against native slicer import/save results.

## Print settings

Sparse infill density is a slicing setting. Bambu Studio and PrusaSlicer store
such settings in their own project metadata; there is no shared infill setting
these import paths reliably apply. Pocketry's exports leave process, printer,
and filament settings to the slicer. Any future automatic print-setting export
needs separately tested handling for each slicer.
