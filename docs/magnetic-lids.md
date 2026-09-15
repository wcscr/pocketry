# Lids

Implements [feature request #29](https://github.com/wcscr/pocketry/issues/29).
Enable **Construction → Lid**, choose **Overlapping edge** or **Inset**, and
choose a **Flat** or **Stacking top**. Magnets are optional. With **Lid magnet
holes** off, choose **Easy lift-off** or **Compliant fit** and use the single
**Looser / Tighter** adjustment.
Compliant fit offers **Contact ribs**, **Side springs**, **Angled fins**, and
**Spring latch** in one Interface selector.
Export the bin normally and the lid separately under **Export → Export lid**,
as STL or 3MF. Geometry settings survive autosave, project files, and undo.

The preview retains the compact **Lid: Raised / Closed / Hidden** controls.
With a lid enabled, Materials offers a **Lid** color instead of a colored band
at the bin rim. The lid follows the bin's base color until a separate color is
chosen; that selection is also used in its 3MF export. As with the existing
material colors, these are view settings rather than saved project geometry.

## Styles and fit

| | Overlapping edge | Inset |
| --- | --- | --- |
| Bin rim | Top 5 mm steps inward by lid wall thickness + 0.3 mm per side | Standard Gridfinity stacking lip |
| Lid | Continuous outside skirt wraps around the stepped rim | Chamfered locating plug seats inside the lip |
| Flat top | 3.6 mm cap above the mating face | 6.75 mm total; about 3.2 mm exposed above the lip to grip |
| Stacking top | 4 mm cap plus a Gridfinity lip | 8 mm cap plus a Gridfinity lip |
| Alignment | 0.3 mm clearance per side and a chamfered entry | 0.3 mm extra clearance per side |
| Edge | Continuous skirt, 1.2 mm by default; adjustable 0.8–4.0 mm per wall | Continuous chamfered profile |

The overlapping skirt stays within the bin's original footprint and stops
0.2 mm above its shoulder. Entry chamfers ease seating.
The inset cap starts 0.2 mm above the rounded stacking lip. It extends down
around the locating profile while retaining the original mating face, overall
height, and magnet-pocket depth. This replaces the roughly 1.2 mm separation
below the cap in the initial test lids. Existing inset bases, including test
base **20**, can be reused; only the lids need reprinting.
**Construction → Wall thickness** is shared by the bin wall, overlapping inner
rim, and overlapping lid skirt. Each wall receives the selected thickness;
new designs default to 1.2 mm per wall, adjustable from 0.8 to 4 mm. The overlap
region therefore occupies `2 × thickness + 0.3 mm` per side: 2.7 mm at the default,
4.3 mm for 2 mm walls, or 8.3 mm for 4 mm walls. The outer footprint stays fixed,
so thicker walls reduce interior space. Layout, automatic sizing, and cutter
validation account for this space. Large offsets use square inner corners.
Changing thickness requires a matching bin and lid; unlike fit adjustment,
it is not a lid-only change. The standard stacking profile and underside stay
unchanged. The inset lid's compliant locating skirt stays 0.8 mm thick.
Contact-rib, lift-off, and magnetic lids have continuous edges. Spring interfaces
have intentional relief slots. The bin's rim
has a sloping support below its shoulder and a chamfer at the top. Pockets
must clear this rim. The saved stacking-lip preference returns when the lid is
disabled. Both styles keep the same solid-fill headroom and pocket-depth
references.

**Stacking top** provides a locator for another Gridfinity bin on the closed
lid. A flat lid has no stacking locator. An inset bin also retains ordinary
stacking with its lid removed; the overlapping style replaces the bin's
stacking lip with its stepped rim.

[Slant3D's lid-design video](https://www.youtube.com/watch?v=IZKh6lo9SP4&t=123s)
demonstrates side springs that flex in the plane of printed layers (about
2:05), adjusting their thickness to change tightness, and repeated angled
grip fins (about 3:00). Its description also emphasizes rounded entries,
reduced contact surfaces, and compliance. These are design principles, not
dimensions or physical qualification for Pocketry.

- **Easy lift-off** defaults to the original clearance: 0.3 mm per side for
  overlap, or 0.3 mm extra clearance beyond Gridfinity's built-in fit for
  inset. It is a locating cover without intended retention.
- **Compliant fit → Contact ribs** adds spaced, rounded contact ribs on the locating rim.
  Contact stays away from corners and the rim retains clearance between ribs.
  Inset friction lids have a hollow underside with a 0.8 mm locating skirt;
  overlapping lids retain their continuous outside skirt at the selected wall
  thickness. Thicker overlapping skirts flex less and need a new physical fit test. The ribs are on the
  mating face, with tapered entry and no cutouts through the exterior edge.
  This original thin-rim adaptation remains the default interface and preserves
  existing saved friction lids.
- **Side springs** uses 0.8 mm rounded strips fixed at one end, with a small
  rounded contact bump near the free end. Relief slots pass through the cap,
  allowing the spring to bend in the plane of the printed layers.
- **Angled fins** uses repeated 0.6 mm fingers attached at their roots, with a
  tapered entry. A 0.3 mm release gap separates each finger from the cap, following
  Slant3D's guidance at about 3:35. Inspect the gap in the slicer; drooping strands,
  fused first layers, or support material can prevent movement. The top stays solid.
- **Spring latch** uses a 0.8 mm folded spring and a rounded detent that mates
  with a 0.4 mm recess in the bin. **Pull up to release**: both insertion and
  removal have rounded ramps. Its relief slots pass through the cap so there is
  no bridge over the moving spring. These dimensions are Pocketry prototype
  choices, not dimensions specified or validated by Slant3D.
- The three new interfaces repeat along all four sides, clear of the corners,
  on bins at least 36 mm wide and long. Overlapping versions reserve at least
  3.4 mm for the mechanism plus 0.3 mm clearance and the selected inner rim wall.
  The outer footprint stays fixed. **Export a matching bin and lid when changing
  interface**: side springs and angled fins share a bin; the latch needs its
  recesses. Overlapping latch walls must be at least 1.2 mm thick, leaving
  0.8 mm behind each recess. Pocket and finger cutters cannot remove that backing.
- Spring slots also interrupt the optional stacking rim. Remaining sections
  locate the bin above, but the slots reduce support area and loaded stacking
  needs physical testing. Start with a flat top when qualifying the springs.
- The five adjustment positions change the lid by 0.05 mm per side per step,
  from 0.1 mm looser to 0.1 mm tighter. Friction starts with 0.05 mm of intended
  interference at the ribs, spring bumps, or fin tips; the loosest setting leaves 0.05 mm clearance and
  the tightest uses 0.15 mm interference. These are prototype starting values,
  not guaranteed holding forces. The bin geometry stays unchanged, so only
  the lid needs reprinting for fit adjustments.
- The spring latch starts with 0.2 mm detent engagement, adjustable from 0.1
  to 0.3 mm. Its matching recess stays fixed at 0.4 mm depth so the seated spring
  can relax. Fit adjustment changes the detent projection, not beam thickness.
- Fit adjustment changes sideways clearance or rib protrusion. It does not
  change lid height, cap thickness, or the clearance above the bin's lip.
- Fit controls appear only without closure magnets. Their preferences are
  retained while magnets are on, but magnetic closures always use the original
  clearance and omit compliant mechanisms and body recesses. Base magnets do not hide lid fit.

## Independent magnets

- **Base magnet holes** controls the bin's underside magnets. **Base crush
  ribs** appears when those holes are enabled. Existing full-pitch and flat
  bottom restrictions still apply to underside holes.
- **Lid magnet holes** controls four matching pairs: four in the lid and four
  in the bin rim. **Lid crush ribs** appears when closure holes are enabled.
  These choices are independent of the underside settings.
- Turning off lid magnet holes removes the holes and the bin's corner magnet
  supports, freeing those areas for pockets. The alignment rim remains.
- **Magnet size** appears when underside or closure magnets are active. Enter
  the magnet's actual **diameter** and **thickness** once; the dimensions apply
  to every magnet. The default remains **6 × 2 mm**, producing the original
  **6.5 × 2.4 mm** recess. Diameter is adjustable from 3 to 12 mm and thickness
  from 1 to 5 mm. Each recess adds 0.5 mm diameter and 0.4 mm depth clearance.
  Crush ribs retain eight lobes with 0.1 mm diametral interference at their tips;
  the base and closure crush switches remain independent. Without ribs, glue
  the magnets. Dormant size preferences do not alter a nonmagnetic lid.
- Underside magnets wider than 7.5 mm move inward automatically within each
  occupied cell, retaining at least 0.8 mm of plastic around the opening.
  For example, 12 mm magnets move 2.25 mm inward per axis, giving 21.5 mm center
  spacing instead of 26 mm. The size control notes that these magnet centers
  differ from the standard baseplate pattern. Screw holes stay at their standard
  positions; shifted magnets and screws use separate printable bridge ceilings.
  Smaller magnets retain the original centers, and the base's outer profile
  stays fixed. The fixed 7 mm base keeps at least 1 mm above the magnet pocket
  and its bridge layers. With screw holes enabled, magnets must also be wider
  than the 3 mm screws. Hole spacing and roof-depth validation still apply.
- Closure magnet centers start 7.75 mm inward from each original outer edge,
  independent of socket pitch. Larger magnets and thick overlapping rims move both paired recesses
  inward together to retain at least 1.2 mm beside the bore. Corner supports grow
  accordingly from their original 12.2 mm extent and slope inward at 45 degrees. Recess floors retain 1.2 mm
  of material. Layout marks these supports in amber while closure holes are
  enabled; conflicting pockets or finger access block export. The geometry
  worker also checks actual cutter intersections.
- Thicker magnets grow the corner supports downward and the lid cap upward
  as needed to retain closed 1.2 mm recess floors. The magnet mating face and
  lid seating clearance stay fixed. For example, 5 mm thick magnets require a
  6.6 mm overlapping cap; the default inset cap already provides enough depth.
  The top heights in the style table describe the default 6 × 2 mm magnets.
- Rectangular footprints only. Gridfinity or flat bottoms; full, half, or
  quarter pitch, with the minimum width and length calculated from wall thickness
  and support size (27 mm at the default; 35 mm at 4 mm walls). Minimum bin height is 2u.

Project schema v23 stores the interface as well as shared magnet size, wall
thickness, lid style, top, closure settings, and fit. Existing designs and undo
history default to Contact ribs. Projects from before v22 default to 6 × 2 mm
magnets without changing their recesses. Projects from before v21
retain their 0.95 mm bin walls.
Older overlapping projects and every undo step retain the original 0.8 mm
skirt and 1.2 mm inner rim (or their saved v20 skirt thickness). Editing the
shared control links all three dimensions. This preserves previously printed
pairs until the user deliberately changes thickness.
Older lids remain Inset with a Flat top and plain closure holes, including
undo/redo history. Existing lids without magnets default to Easy lift-off
with zero adjustment. Earlier projects default lids off. No external CAD file,
code, or dependency was copied; existing Gridfinity primitives retain their
original attribution.

## First print

Generate a small hollow bin and lid for each style and top:

```sh
npm run export:bin -- 1x1x2 --lid-style overlap --lid-top flat --out outputs/lid-styles/overlap-flat
npm run export:bin -- 1x1x2 --lid-style inset --lid-top flat --out outputs/lid-styles/inset-flat
npm run export:bin -- 1x1x2 --lid-style overlap --lid-top stacking --out outputs/lid-styles/overlap-stacking
npm run export:bin -- 1x1x2 --lid-style inset --lid-top stacking --out outputs/lid-styles/inset-stacking
```

Print the bin upright. **Flat-top lids** export with the outer face on the bed
and the recesses and skirt facing upward. **Stacking-top lids** export upright,
with the stacking lip facing upward. The overlapping stacking lid needs slicer
support beneath its cap; inspect support and bridging at
magnet recesses for either stacking style. Stacking lids are not the
support-free flat-top print orientation.

Check that the slicer resolves the 0.8 mm springs, 0.6 mm fins, release gaps,
and contact ribs. Keep supports out of the moving gaps. Flat lids put the
spring paths in the plane of the layers; angled fins still need their cap gap
to print and release cleanly. Dry-fit
before installing magnets: check entry, full seating, sideways play, and removal.
For friction lids, begin at the middle adjustment and tune after this test.
Use the printer, material, and settings intended
for the larger bin, and test repeated opening. Test a bin on the stacking top.

Install opposing magnet pairs with attracting faces together. A fully seated
2 mm magnet sits 0.4 mm below each mating face, giving a nominal 0.8 mm gap
between paired magnets. Check retention before use. Print fit, rim
durability, creep, magnetic holding strength, and loaded stacking remain
**unvalidated physically**.

## Digital verification

The initial PLA test plate uses two shared 1×1×2u bins and fourteen lids.
For each style, it compares flat easy lift-off; flat friction fit at loose,
default, and tight settings; stacking easy lift-off; and flat magnetic lids
with plain holes or crush ribs. One shared base has plain underside and
closure holes; the other has crush ribs in both locations. All seven lids of
each style reuse that style's base. This checks both base magnet treatments
without printing a base for every lid. **Physical fit testing underway.**
The plate is prepared in Bambu Studio; initial inset prints showed a cap-to-rim gap. The cap geometry now reduces
that gap to 0.2 mm without requiring a new inset base. Revised seating, retention,
and the thicker shared walls still require physical verification.

Tests cover both styles and tops at preview/export quality: connected solids,
clearance when closed for magnetic and lift-off lids, controlled interference
only at the friction ribs, increasing contact with tighter adjustment, unchanged
bin geometry when tuning, stacking clearance, matching recesses and solid floors,
print orientation, rim and corner conflicts, the thicker inset grip, optional
magnets and independent crush ribs, conditional fit controls, default/custom lid colors, legacy migration,
undo, worker transfer and section isolation, and separate STL/3MF exports.
Browser checks exercise the actual controls, closure previews, and exports.
Additional interface tests check 1U and larger cases, full/half/quarter pitches,
single connected solids, free travel gaps, detent/recess alignment, pull-release
contact, cutter protection, and unchanged bin geometry across fit adjustments.
The new side springs, fins, and folded latch have **not been physically tested**;
the earlier test plate does not qualify these new mechanisms.
