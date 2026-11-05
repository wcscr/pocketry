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
- Export workflow tests cover the new download and optional editable backup.
- The complete geometry/export suite passed: 314 tests in 24 files.
- Bambu Studio 2.9.1.70's import preview retained both colors for a two-cube
  control and a six-compartment metric screw bin. The bin's sliced preview
  showed ivory label backgrounds and charcoal text/body using the H2D's 0.4 mm
  nozzles at 0.2 mm layer height. This is slicer evidence, not a physical-print
  qualification or a claim about other slicer versions.

The metric bin check also included the separate label-background correction
in [PR #208](https://github.com/wcscr/pocketry/pull/208): its color mask extends
through the shelf surface to avoid a microscopic body skin over the color layer.
That geometry correction is independent of this 3MF packaging workaround.

## Portability and print settings

The compatibility file uses standard 3MF geometry and per-face colors, but
slicer support for those colors varies. A local PrusaSlicer 2.9.6 command-line
import/export accepted the combined bin as manifold geometry, but did not
preserve its color assignments. Regular separate-part exports also lost color
assignments in that check. This option is qualified for the Bambu version above;
it does not establish automatic multicolor support in PrusaSlicer.

Sparse infill density is a slicing setting. Bambu Studio and PrusaSlicer store
such settings in their own project metadata; there is no shared infill setting
these import paths reliably apply. Pocketry's current exports leave process,
printer, and filament settings to the slicer. Any future automatic print-setting
export needs explicit, separately tested compatibility handling for each slicer.
