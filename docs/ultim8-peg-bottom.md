# ULTIM8 jig peg bottoms

In Bin → Construction → Bottom, choose **ULTIM8 jig pegs**. This replaces
Gridfinity feet and hides their magnet/screw controls while retaining those
preferences for switching back. Peg settings travel with projects and undo history.
Upright sloped and bridged modes use every fitting mat hole. Saved
preview projects return to the full lattice without losing their other settings.

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

- **Sloped roots** (default): eight-millimetre roots expand upward at 45° into
  the flat base, avoiding bridges. This works with rectangular and custom footprints.
- **Short bridges**: 1.6 mm flared collars join a bridged web and a sloped
  perimeter. The perimeter height follows the actual footprint. At default fit
  settings, the extension is 7.8 mm on a 20.5 mm square and 9.8 mm on an 83.5 mm
  square, compared with 12 mm for sloped roots. This option requires a rectangular
  footprint. Generation checks the available anchors and rejects retained regions
  that need long bridges. Cooling and bridge quality need a small print test first.

In both constructions, the wider roots start above the straight shaft, outside
the mat holes. In sloped mode, geometry generation checks that the roots’
upper sections cover the retained footprint before adding the slab; unsupported
footprints fail with an actionable message. The peg/root extension adds 12 mm
at default settings in sloped mode. Pocket and rim coordinates stay unchanged, the overall
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

Selecting **Through** on an ordinary upright surface pocket opens a complete hole through the
slab and peg roots, including when the pocket overlaps finger access. Subsequent
Z movement treats it as a finite object and restores material when raised.
Older preview projects repair an unchanged blind-floor conversion when saved
history or creation references establish its original floor and depth.

Intersecting pockets combine their cuts in the printable bin. Three-dimensional
intersections are warnings, including tilted or submerged pockets, and do not
block export. Combining several editable pockets into one named pocket object
is future work.

## Flat backing prototype

Choose **Flat backing · pegs up** to attach pegs directly to the flat underside,
removing all root height. STL and 3MF exports are oriented pocket-side down with
pegs up; all colour and text parts rotate together. The installed 3D view and
Layout retain the editable coordinates. Choose **Corners only**, **Every hole**,
or **Every 2, 3, 4, or 5 holes**. Spacing applies to both lattice directions,
with nearest fitting corner anchors retained. Through pockets remove whole
intersecting shafts before selection, so corner anchors can move to the next
available hole. Sparse pegs do not grow taller roots. Upright modes restore the
full lattice. Peg fit and sparse-jig stiffness need a physical test print.

Blind pockets and finger access become roofs when printed this way. Warnings
prompt inspection of pocket overhangs and short-span bridge direction in the
slicer. Hollow bins, lips, tabs and raised text also need first-layer/bridge
inspection. A successful support-free slice does not qualify print quality.

**Grid pitch → Arbitrary** sets exact outer width, length and body height in
millimetres with flat or ULTIM8 bottoms. Switching preserves the existing size.
Body heights may go down to 2 mm; below 7 mm the stacking lip is off. Returning
to a grid requires exactly matching grid dimensions and height increments.
