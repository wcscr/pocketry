# Wham Bam Systems ULTIM8-compatible fixture peg bottoms

Visit [pocketry.xyz/ultim8](https://pocketry.xyz/ultim8) to start a ready-to-edit
fixture (Beta). An open fixture is kept exactly as saved. For other projects,
the existing New Project flow saves named work and asks whether to save, discard,
or keep an unnamed draft. The URL then becomes `/bin`; this is the same designer.
The fixture profile follows `spec.pegBottom` wherever the project is opened.

Add an object from a photo using the empty-state Trace action, or use Add pocket
for a basic shape. Set the body thickness in millimetres, then export STL/3MF and
**Save alignment SVG**. Trace’s **Add to Bin** returns into the same fixture.
New fixtures start at 100 × 60 mm with a 5 mm body thickness, adjustable
in Fixture size; the default pegs add 4 mm below the body (9 mm total). No saved project is
converted automatically. [Fixture Help](https://pocketry.xyz/bin#ultim8-fixtures)
is directly linkable.

Fixture controls show dimensions in millimetres and hide Gridfinity pitch, cell
spans, stacking lip, base fasteners, label-tab shelves, and the size-lock toggle. Legacy custom footprint
editing is collapsed under Legacy shape settings. Saved geometry and material
choices remain intact; changing Bottom leaves the fixture profile.

To convert a regular project, enable **Experimental features** in App settings, then in Bin → Construction →
Bottom, choose **Wham Bam Systems ULTIM8-compatible pegs**. The confirmation offers to remove the stacking
lip, set Solid fill to 100%, and match floors, rim, and text to the bin body color.
Rectangular bins also switch Grid pitch to Arbitrary, keeping their body dimensions.
Custom footprints retain their grid because Arbitrary sizing requires a rectangle.
**Jig body thickness** starts at the current body height, excluding pegs. Editing it
stays local to the dialog until **Use jig settings**. The preset, including its
color changes, is one undoable step retained when saving and reopening. Depth errors disable that
action; thin-floor warnings remain visible.
Choose **Keep current settings** to change only the bottom at its current height, or **Cancel** to leave
the design as it is. Opening an existing jig does not show this prompt.
This replaces
Gridfinity feet and hides their magnet/screw controls while retaining those
preferences for switching back. Peg settings travel with projects and undo history.
Peg projects show their peg controls with Experimental off. Other experimental
tools remain gated. Pegs alone do not produce the experimental-design notice or
count as experimental in current or historical project snapshots. Opening a peg
project never turns Experimental on automatically.
Upright sloped and bridged modes use every fitting mat hole. Saved
preview projects return to the full lattice without losing their other settings.

The reference is Wham Bam Systems’ ULTIM8 mat for eufyMake E1:
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

New peg bottoms default to **Flat backing · pegs up** with **Corners only** density.
Pegs attach directly to the backing, without tall roots. STL and 3MF export pocket-side down, with pegs up.
Check pocket bridges and overhangs in the slicer; see the flat-backing guidance below.
Existing projects retain their saved underside, including older sloped-root designs.

The other **Underside** options print **upright, pegs on the build plate, with supports disabled**:

- **Sloped roots**: eight-millimetre roots expand upward at 45° into
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
or **Every 2, 3, 4, or 5 holes**. Numeric spacing is approximate in both mat
directions: selection starts at the nearest fitting corner anchors and fills the
largest gaps. Increasing density retains every peg from the sparser setting.
Through pockets remove whole intersecting shafts before selection, so corner
anchors can move to the next available hole. All pegs still occupy exact mat holes.
Saved numeric-density fixtures may redistribute their pegs after this correction;
regenerate the alignment SVG alongside the fixture. Sparse pegs do not grow taller roots. Upright modes restore the
full lattice. Peg fit and sparse-jig stiffness need a physical test print.

Blind pockets and finger access become roofs when printed this way. Warnings
prompt inspection of pocket overhangs and short-span bridge direction in the
slicer. Hollow bins, lips, tabs and raised text also need first-layer/bridge
inspection. A successful support-free slice does not qualify print quality.

Rectangular fixtures expose exact outer width, length and body thickness in
millimetres directly. Regular flat-bottom projects offer the same sizing through
**Grid pitch → Arbitrary**. Switching preserves the existing size.
Arbitrary dimensions stay fixed when adding or arranging tools; fixtures do not
show a size-lock toggle. Edit the millimetre fields or choose
**Fit fixture to contents** to resize. Display rounding does not change the saved
dimensions.
Body heights may go down to 2 mm; below 7 mm the stacking lip is off. Returning
to a grid requires exactly matching grid dimensions and height increments.

## Jig layout SVG

With a Wham Bam Systems ULTIM8-compatible bottom selected, Export labels the existing layout SVG action
**Save alignment SVG**. Ordinary bins retain their shadow-board SVG/DXF controls.
Existing fixture projects can edit and export with Experimental off.
The optional editable-project download uses the same design snapshot.

The SVG is an installed top view at 1:1 millimetres, independent of the pegs-up
STL/3MF print orientation. It has separate groups/colors for the actual rounded
bin boundary (gray), pocket openings including clearance/rounding (black),
finger access (orange), and retained peg shafts (blue). Peg circles use the
configured shaft diameter and the same through-cut exclusion and density
selection as the printed base. Corner anchors relocated around openings are
included; removed pegs are absent. No text or registration marks are added to
the printable artwork.

The SVG origin is the top-left of the bin bounds. Match the blue peg circles to
the corresponding holes in your zero-point-calibrated mat template, then keep
the artwork grouped and at 100% scale. The SVG does not assign an absolute bed
position or calibrate Studio. Mat/template registration and physical placement
still need verification in the user's setup. DXF retains the ordinary nominal
pocket layout without peg references.
