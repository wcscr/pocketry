# Pocketry H2D photo board

A 315 × 310 × 6 mm photo background with four flush, black-and-white marker
tiles. Print the base in matte green PLA and the tiles separately in opaque
white and black PLA. The H2D photo-board layout is recognized by the Pocketry
code in this checkout; an older deployed Pocketry build must be updated first.

## Size and printer placement

The finished board uses 93.9% of the H2D's 325 × 320 mm single-nozzle area.
Eight removable adhesion pads extend its printing footprint to **323 × 318 mm**.
The H2D's 350 × 320 mm total area is the union of two nozzle reaches; neither
nozzle can print a 350 mm wide solid board. The dual-nozzle overlap is only
300 × 320 mm. This is why the green base and marker tiles are separate prints.

In Bambu Studio choose H2D / 0.4 mm, assign the entire base to ONE nozzle, and
keep 100% scale. Position the base bounding-box center at **X=162.5, Y=160 mm**
for nozzle 1's 0–325 mm reach, or **X=187.5, Y=160 mm** for nozzle 2's
25–350 mm reach. A default bed-center position at X=175 does not fit either
single-nozzle envelope. Confirm the selected nozzle's actual highlighted area
in your slicer. Disable the prime tower and extra brim/skirt for this green-only
print; the modeled pads already occupy the available margin. Do not rotate 90°.

The marker print is only 88 × 88 mm. Its two colors must remain parts of ONE
assembled object so the black geometry stays at its designed Z height. A prime
tower easily fits beside this small assembly.

Both exports were successfully sliced locally in Bambu Studio 02.08.02.61 with
the H2D 0.4 mm and Bambu PLA Matte profiles. The estimates were **10 h 10 min /
386 g for the green base** and **42 min / 21 g for the four marker tiles**.
These are slicer estimates, not observed print times; re-slice for your actual
filament and printer settings. The delivered 3MF files contain geometry and
color parts, not a ready-to-send printer program.

Printer dimensions: [Bambu H2D specifications](https://eu.store.bambulab.com/products/h2d?from=home_page_3dprinter).
Nozzle-specific positioning was also checked against the installed Bambu Studio
H2D 0.4 mm profile's `extruder_printable_area`.

## Features for large flat printing

- Eight 0.4 mm thick removable adhesion pads support corners and edge midpoints.
  Trim them flush only after the board cools. Set `adhesion_tabs=false` if needed.
- 8 mm corner radii avoid sharp outer corners that concentrate lifting forces.
- A uniform 6 mm backing provides stiffness without tall ribs or abrupt
  thickness transitions. Use sparse infill inside it; do not print a solid slab.
- Equal top and bottom skin thicknesses avoid an unnecessarily unbalanced shell.
- A continuous flat underside and supported top avoid the long bridges and
  surface depressions that underside hollow pockets can introduce.
- Separate marker tiles keep color changes and a purge tower off the full-size
  board. The marker cells themselves are 5 mm wide, comfortably above a 0.4 mm
  nozzle's detail limit.
- Each tile has a 0.3 mm lower-edge chamfer to reduce elephant-foot interference,
  0.15 mm clearance per side, a clipped corner to fix orientation, and a hidden ID.
- A 48 × 48 mm pocket coupon lets you check the fit before the large print.

These features reduce avoidable problems; they do not guarantee a flat physical
print. [Prusa's warping guidance](https://help.prusa3d.com/article/warping_2011)
explains why adhesion, temperature consistency, and slower printing also matter.

## Starting slicer settings

Use the manufacturer's profile for your actual PLA and build plate. Suggested
overrides for the green base, to be checked in the layer preview:

| Setting | Starting value |
| --- | --- |
| Layer height / first layer | 0.20 / 0.20 mm |
| Walls | 3 |
| Top / bottom shell layers | 6 / 6 (1.2 mm each) |
| Sparse infill | 15–20% gyroid |
| Top surface | Monotonic lines, 35–40 mm/s |
| First layer speed | 20–25 mm/s |
| Supports | Off |
| Extra brim / skirt | Off with the included pads |
| Prime tower | Off for base; on as needed for marker assembly |
| Ironing / fuzzy skin | Off initially; keep the photo face uniform and matte |
| Active chamber heating | Off for PLA |

Clean the plate, run bed leveling, avoid drafts and strong one-sided auxiliary
cooling, and allow the plate and board to cool together before removal. Keep
the filament manufacturer's nozzle, bed, and normal part-cooling guidance;
do not disable all cooling or heat a PLA chamber aggressively to fight warping.
Inspect the first layers, pad adhesion, and the final top layers in the slicer.

Print the marker tiles at 0.20 mm layers with opaque white and black PLA.
All features use multiples of that layer height. The marker face has 1.2 mm of
white above its black underlay to limit color show-through. Color assignments
must be checked explicitly in Bambu Studio; OpenSCAD preview colors alone do not
assign printer filaments. Use the combined marker 3MF from the export bundle.

## Assembly and calibration

1. Print the fit coupon and marker tiles first. Tile 16 belongs in the coupon.
   It should seat with light pressure, without bowing the coupon or tile. If
   necessary adjust only `tile_clearance` (0.05–0.30 mm per side), not scale.
2. Print the green base at 100%. Remove adhesion pads after cooling. Check that
   it sits without rocking on a known flat surface and check the top with a
   straightedge in both directions and along both diagonals.
3. Match the hidden tile ID to the ID in its pocket. Seen from above with the
   315 mm side horizontal, IDs are 16 top-left, 17 top-right, 18 bottom-right,
   19 bottom-left. All clipped tile corners point top-left. Seat fully on the
   pocket floor so the marker faces and green surface are at the same height.
   If a tile is loose, center it and secure from its side with a tiny amount of
   adhesive; thick tape or glue underneath would raise it above the reference plane.
4. Measure the 30 mm black marker squares and corresponding left edges of the
   upper two markers (**263 mm apart**), and corresponding top edges of the
   left two markers (**258 mm apart**). These edge distances equal the center
   distances and are easier to locate with a ruler. Investigate deviations of
   more than about 0.3 mm before relying on the nominal dimensions.
5. Photograph from directly above in diffuse light, keeping all four markers
   uncovered. Accept the H2D photo-board calibration/perspective proposal.
   Select a tool region surrounded by green, excluding the marker tiles.

The new signature identifies this exact nominal geometry; the marker codes do
not contain arbitrary measurements. Changing board dimensions, marker size,
or spacing requires a newly registered signature, not merely scaling the STL.
Uniform printer shrinkage cannot be discovered from these markers alone, since
it scales the markers and their spacing together. The geometry fit also cannot
prove that the center of the physical board is flat. Thick tools still exhibit
parallax above the reference plane; green color does not solve that.

## Source and exports

- `pocketry-h2d-photo-board.scad`: editable model, with `part` selector.
- `calibration.scad`: generated dimensions and OpenCV marker bits; keep it beside
  the model. Regenerate from the repository with `npm run generate:photo-board`.
- `calibration.json`: portable nominal dimensions, marker IDs, bits, centers,
  and all sixteen physical marker corners in a top-left image coordinate system.
- The finished export bundle contains the green base, combined two-color marker
  3MF, individual marker files, fit coupon, source, and preview.

Render each part with OpenSCAD (on macOS use the executable inside the app):

```sh
openscad --backend Manifold -D 'part="base"' -o base-green.stl pocketry-h2d-photo-board.scad
openscad --backend Manifold -D 'part="markers-white"' -o markers-white.3mf pocketry-h2d-photo-board.scad
openscad --backend Manifold -D 'part="markers-black"' -o markers-black.3mf pocketry-h2d-photo-board.scad
openscad --backend Manifold -D 'part="fit-coupon"' -o fit-coupon.stl pocketry-h2d-photo-board.scad
```

For a manual multicolor import, load both marker parts as one object, preserve
their relative XYZ coordinates, and assign white/black by part. Do not drop the
black part independently onto the plate or auto-arrange the two colors.

Model code: AGPL-3.0-only. Marker data: generated with OpenCV 4.11.0,
`extendDictionary(20, 4)`, Apache-2.0; see the repository's LICENSE and NOTICE.
