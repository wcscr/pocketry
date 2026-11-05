# Bambu Studio multi-color import

Bambu Studio 2.9.1.70 loses Pocketry's color assignments on separate 3MF parts.
The warning and investigation are tracked in [issue #211](https://github.com/wcscr/pocketry/issues/211).

## Temporary export option

Choose **Export → Save 3MF → Bambu-compatible 3MF**. Import the downloaded
`-bambu-multicolor-` file in Bambu Studio and map both/all displayed colors to
filaments. Inspect the sliced layer preview before printing.

This option concatenates the printable meshes into one object and assigns the
standard 3MF color resource to each triangle. It preserves coordinates, triangle
winding, and distinct vertex identities, including components that touch. It
neither welds nor remeshes the parts. Body, inserts, and text consequently stop
appearing as separate named parts in the slicer. Keep the optional editable
Pocketry project backup to change them in Pocketry later.

The file identifies Pocketry as its application and includes no printer,
process, or filament profiles. Regular **Multi-color 3MF**, single-color 3MF,
and STL remain available. The regular multi-color option preserves named parts;
the full Bambu part-assignment issue remains open.

## Verification (2026-11-05)

- Serialized tests cover exact coordinates, index offsets, per-face colors,
  repeated palette colors, uncolored faces, closed touching components,
  deterministic output, and absence of vendor profile metadata.
- Export workflow tests cover the new download, optional editable backup, scoped
  warning, and independent label backgrounds with body and text sharing a color.
- Local type checks, production build, and all test groups passed: 3,396 quick
  tests, 329 geometry/export tests, and 614 workflow tests. Geometry checks include
  per-face assignments for six-label bins at 4U and 5.5U heights.
- Bambu Studio 2.9.1.70's import preview retained both colors for a two-cube
  control and a six-compartment metric screw bin. The bin's sliced preview
  showed ivory label backgrounds and charcoal text/body using the H2D's 0.4 mm
  nozzles at 0.2 mm layer height. This is slicer evidence, not a physical-print
  qualification or a claim about other slicer versions.

The metric bin check includes the label-background correction merged in
[PR #208](https://github.com/wcscr/pocketry/pull/208): its color mask extends
through the shelf surface to avoid a microscopic body skin over the color layer.
That geometry correction is independent of this 3MF packaging workaround.

## Portability and print settings

The compatibility file uses standard 3MF geometry and per-face colors, but
slicer support for those colors varies. The following checks used the same
two-color, six-compartment TAODAN bin on macOS:

| Slicer | Regular separate-part 3MF | Bambu-compatible single-model 3MF |
| --- | --- | --- |
| Bambu Studio 2.9.1.70 | Color assignments lost | Both colors retained through sliced preview |
| PrusaSlicer 2.9.7 | Geometry and named parts loaded; colors lost | Geometry loaded; colors lost |
| PrusaSlicer 3.0.0-alpha13 | Geometry and named volumes loaded; colors lost | Geometry loaded; colors lost |

Prusa's GUI imports used its CORE One presets. Alpha13 explicitly reported that
only geometry was loaded. Separate command-line import/export checks in both
versions retained all 42,988 triangles of the combined bin and reported manifold
geometry, but removed the color resource and all per-face assignments. The input
has 42,624 charcoal faces and 364 ivory faces; the saved Prusa files contain no
face-color or painted-material assignments. Regular exports also lost their
color assignments. These results confirm import behavior for these files; they
are not a Prusa multicolor slicing or physical-print qualification.

Use regular separate-part exports when you need to assign filaments manually to
named parts in Prusa. The combined export is qualified for the Bambu version
above and does not provide automatic multicolor import in the tested Prusa
versions.

Sparse infill density is a slicing setting. Bambu Studio and PrusaSlicer store
such settings in their own project metadata; there is no shared infill setting
these import paths reliably apply. Pocketry's current exports leave process,
printer, and filament settings to the slicer. Any future automatic print-setting
export needs explicit, separately tested compatibility handling for each slicer.
