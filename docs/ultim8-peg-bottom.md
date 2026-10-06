# ULTIM8 jig peg bottoms

In Bin → Construction → Bottom, choose **ULTIM8 jig pegs**. This replaces
Gridfinity feet and hides their magnet/screw controls while retaining those
preferences for switching back. Peg settings travel with projects and undo history.

**Peg density** offers **Corners only**, **Every hole** (default), and **Every
2, 3, 4, or 5 holes**. Regular spacing skips holes in both directions on the
original staggered mat grid, with fitting corner anchors retained. Custom
footprints use their actual corners; tiny footprints can share a single anchor.
Older projects retain every-hole density in the design, history, and transform
references. Sparse settings use sloped roots and grow them automatically to
cover the underside at 45 degrees. They can make the overall bin substantially
taller. Fewer pegs do not guarantee less material because the roots grow taller.

The reference is Wham Bam’s ULTIM8 mat for eufyMake E1:
https://www.whambamsystems.com/pages/ultim8-jig
Its holes are 5 mm diameter, 10 mm apart along each row, with alternate rows
shifted 5 mm. The mat photograph in the manufacturer’s zero-point calibration
guide confirms 5 mm between staggered rows:
https://www.whambamsystems.com/pages/ultim8-jig-support-page
One lattice covers the entire footprint; 42 mm Gridfinity cells do not restart it.
No manufacturer meshes, CAD, or source code are bundled or adapted.

The default straight locating shafts are 4.8 mm diameter and 4 mm long, with a
0.4 mm entry chamfer. Diameter (4–5 mm) and length (2–5 mm) are adjustable.
These are Pocketry print-fit defaults, not manufacturer-specified tolerances.
Print a small bin first to confirm fit in your own mat.

Print **upright, pegs on the build plate, with supports disabled**.
Choose the **Underside** construction:

- **Sloped roots** (default): roots start at eight millimetres and expand upward at 45° into
  the flat base, avoiding bridges. This works with rectangular and custom footprints.
- **Short bridges**: 1.6 mm flared collars join a bridged web and a sloped
  perimeter. The perimeter height follows the actual footprint. At default fit
  settings, the extension is 7.8 mm on a 20.5 mm square and 9.8 mm on an 83.5 mm
  square, compared with 12 mm for sloped roots. This option requires a rectangular
  footprint and every-hole density. Generation checks the available anchors and rejects retained regions
  that need long bridges. Cooling and bridge quality need a small print test first.

In both constructions, the wider roots start above the straight shaft, outside
the mat holes. In sloped mode, geometry generation checks that the roots’
upper sections cover the retained footprint before adding the slab; unsupported
footprints fail with an actionable message. The peg/root extension adds 12 mm
at default every-hole settings in sloped mode; sparse settings add more height as needed. Pocket and rim coordinates stay unchanged, the overall
height includes the extension, and the preview’s ground follows the peg tips.
New pockets leave 2 mm above the slab underside, as in flat-bottom mode.
Through pockets omit every peg whose round shaft footprint overlaps any part of
the opening, including partial overlaps; the whole shaft and its root are omitted.
Clearance, corner rounding, placement, and outline holes are respected. Split
pockets omit pegs only beneath through sections, while blind sections retain them.
Tilted through pockets use their actual sweep beneath the slab. Rigid pockets
retain their finite source from the current editor: only an opening that reaches
the slab underside extends through the peg roots. Raising the source restores
pegs beneath it; a tilted source that only touches the slab along an edge does
not remove pegs. If omitted anchors leave an unsupported underside or long
bridges, generation gives an actionable
message. Through openings cut the full remaining root/web extension.
STL and 3MF exports lift
all parts together so peg tips start at Z = 0 on the build plate.

The underside is designed to avoid support material. Adhesion and overhang
quality still depend on your printer and material. Inspect sliced previews and
print a fit check before a full-size fixture. The whole project may need supports
if user-authored pockets, imported cavities, or other features create overhangs;
these settings address the base construction only. Physical mat fit is unverified.

## Density material comparison

A local Bambu Studio 2.8.2.61 comparison used the same 83.5 × 83.5 mm hollow
bin with a 14 mm body, no stacking lip, and 4.8 × 4 mm pegs. All samples used
H2D 0.4 mm / 0.20 mm Balanced Strength / Generic PLA / 15% infill, upright with
supports disabled. Every sample sliced with zero support paths and no warnings.

| Density | Pegs | Total height | Estimated filament | Estimated print time |
| --- | ---: | ---: | ---: | ---: |
| Every hole | 113 | 26.0 mm | 51.43 g | 3 h 00 m |
| Every 2 holes | 25 | 38.4 mm | 56.91 g | 2 h 26 m |
| Every 3 holes | 19 | 35.2 mm | 51.28 g | 2 h 16 m |
| Every 4 holes | 7 | 51.8 mm | 66.53 g | 2 h 34 m |
| Every 5 holes | 7 | 51.8 mm | 67.01 g | 2 h 35 m |
| Corners only | 4 | 65.8 mm | 77.24 g | 2 h 55 m |

Sparse roots can shorten print time while increasing filament use. The best
choice depends on footprint, grid phase, and slicer settings; corners only is
not a material-saving promise. These are slicer estimates, not physical print
or mat-fit qualification.
