# Lids

Implements [feature request #29](https://github.com/wcscr/pocketry/issues/29).
Enable **Construction → Lid**, choose **Overlapping edge** or **Inset**, and
choose a **Flat** or **Stacking top**. Magnets are optional. With **Lid magnet
holes** off, choose **Easy lift-off** or **Compliant fit** and use the single
**Lighter / Firmer** grip adjustment (or **Looser / Tighter** clearance for easy lift-off).
Compliant fit offers **Contact ribs** and **Angled fins** in one Interface selector.
**Side springs** and the inset-only **Spring latch** remain visible but grayed out
and unavailable for selection pending redesign after physical fit testing.
Export the bin normally and the lid separately under **Export → Export lid**,
as STL or 3MF. Geometry settings survive autosave, project files, and undo.

The preview retains the compact **Lid: Raised / Closed / Hidden** controls.
With a lid enabled, Materials offers a **Lid** color instead of a colored band
at the bin rim. The lid follows the bin's base color until a separate color is
chosen; that selection is also used in its 3MF export. As with the existing
material colors, these are view settings rather than saved project geometry.

## Physical fit testing status

The latest gray PETG test run and initial labeled fit review are complete.
See the [round 3 physical results](fit-tests/magnetic-lids-round3.md) and
[44-part ledger](fit-tests/magnetic-lids-round3.csv). **Side springs and Spring
latch both failed as design families**: thin/broken springs and obstructed or
stuck mechanisms prevented reliable operation. Both need substantial research
before redesign or another physical prototype.

Contact ribs and Angled fins have useful configurations, with unresolved
issues. The preferred overlapping rib fit is 307 or slightly lighter; 319 is
too tight to remove by hand. Overlapping fins 314 retained a good fit with no
play after 25+ openings despite initial loosening. Inset ribs 408 also loosened
early, then seemed to stabilize with a secure pull. These are qualitative fit
checks, not full durability qualification.

The next software revision addresses the cap, grip, clearance, and stacking-underside
feedback. These changes **have not been physically retested**:

- All visible cap outlines match the bin, including flat inset lids at every fit setting.
  Flat inset caps now provide 5 mm of vertical grip above their underside.
- **Grip recess** optionally adds two shallow rounded finger access points in the
  bin below the joint. It preserves the cap footprint, locating faces and magnet
  supports. It defaults off; enabling it requires a new bin, while the lid stays identical.
- Easy-lift and magnetic lids use 0.15 mm clearance at the actual mating surface.
  Nonmagnetic easy-lift tuning spans 0.05–0.25 mm; it does not shrink the cap.
- Inset Contact ribs and Angled fins start at 0.25 mm preload, corresponding to
  round 3's preferred firm setting. Overlap defaults remain 0.15 mm, retaining
  the nominal setting tested in 307 and 314. Inset fin corners have extra relief
  so the blades, rather than stiff corners, are intended to carry the fit.
- Overlapping stacking lids have a filled center at the skirt's bottom plane,
  with a receiving channel for the bin rim. Corner magnet-pad clearances are
  present only when lid closure magnets are enabled. Nonmagnetic lids retain
  a continuous rounded center, even if the bin has underside magnets.
  Inset stacking rib/fin lids also have filled centers. Remaining channels and
  release gaps still bridge; slicing and physical print checks are required.
- The lid controls warn when Overlapping edge and Stacking top are selected
  that a filled lid is currently required for printability, using more material
  and interior space.

Existing round 3 **hollow** bins can be reused with matching lid styles,
interfaces and closure-magnet settings when Grip recess is off. Nonmagnetic
filled overlap lids no longer clear the raised pads on magnetic bins.
Filled overlapping bins need re-exporting
for stacking lids: solid fill now stops 5 mm below the rim. Pocket depths use
that lowered surface. This also changes the interior of existing solid projects
when a stacking lid is selected. The original round 3 results remain a record
of the printed revision, not evidence for this revision's physical fit.

Magnet-hole fit and magnetic holding force remain untested because magnets
were unavailable. Dense overlapping ribs remain an intentionally stronger fit:
start with lighter grip for two or more ribs per side, since 319 was excessively
hard to remove. No claim of a calibrated holding force is made.

The Interface selector disables the two spring options on desktop and mobile.
Previously saved spring mechanisms remain available in designs and undo history
for inspection, with an explanation directing new prints to Contact ribs or
Angled fins. Changing a saved inset latch to Overlapping edge selects Contact
ribs; undo restores the original design. The prototype geometry and its digital
tests remain available for the upcoming redesign. The spring descriptions below
document those retained prototypes rather than currently selectable options.

## Styles and fit

| | Overlapping edge | Inset |
| --- | --- | --- |
| Bin rim | Top 5 mm steps inward by lid wall thickness + 0.3 mm per side | Standard Gridfinity stacking lip |
| Lid | Continuous outside skirt wraps around the stepped rim | Chamfered locating plug seats inside the lip |
| Flat top | 3.6 mm cap above the mating face | About 8.75 mm total; 5 mm cap above its underside for grip |
| Stacking top | 4 mm cap plus a Gridfinity lip | 8 mm cap plus a Gridfinity lip |
| Easy-lift/magnetic alignment | 0.15 mm clearance per side and a chamfered entry | 0.15 mm clearance at the actual lip face |
| Edge | Continuous skirt, 1.2 mm by default; adjustable 0.8–4.0 mm per wall | Continuous chamfered profile |

The overlapping skirt stays within the bin's original footprint and stops
0.2 mm above its shoulder. Entry chamfers ease seating.
The inset cap starts 0.2 mm above the rounded stacking lip. It extends down
around the locating profile while retaining the original mating face and magnet-pocket depth. Fit tuning leaves the cap height fixed. This replaces the roughly 1.2 mm separation
below the cap in the initial test lids. Existing inset bases, including test
base **20**, can be reused; only the lids need reprinting.
**Construction → Wall thickness** is shared by the bin wall, overlapping inner
rim, and overlapping lid skirt. Each wall retains at least the selected thickness; easy-lift and magnetic skirts add 0.15 mm inward to reduce play at the default fit;
new designs default to 1.2 mm per wall, adjustable from 0.8 to 4 mm. The overlap
region therefore occupies `2 × thickness + 0.3 mm` per side: 2.7 mm at the default,
4.3 mm for 2 mm walls, or 8.3 mm for 4 mm walls. The outer footprint stays fixed,
so thicker walls reduce interior space. Layout, automatic sizing, and cutter
validation account for this space. The recessed rim keeps a 3.75 mm corner
radius, including at 4 mm wall thickness, with rounded inner corners and at
least the selected wall thickness around each bend. The lid opening follows
the same rounded rim with its separate fit clearance. The rim's top chamfer
also trims the original bin wall so no raised corner slivers remain.
Existing overlapping pairs made with the earlier shared-wall geometry need
both parts re-exported and reprinted to use this rounded profile. Legacy
projects with a separate lid-wall preference retain their original mating
profile until the shared thickness control is edited.
Changing thickness requires a matching bin and lid; unlike fit adjustment,
it is not a lid-only change. The standard stacking profile and underside stay
unchanged. The inset lid's compliant locating skirt stays 0.8 mm thick.
All lid tops are solid. Compliant interfaces have release gaps below the cap,
at the mating rim. The bin's rim
has a sloping support below its shoulder and a chamfer at the top. Pockets
must clear this rim. The saved stacking-lip preference returns when the lid is
disabled. All overlapping stacking lids and retained side-spring lids reserve 5 mm above solid infill;
the pocket surface and depth calculations use that lower infill height.
Other lids keep the original solid-fill allowance.

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

- **Easy lift-off** defaults to 0.15 mm clearance per side at the actual mating
  surface for both styles, adjustable from 0.05 to 0.25 mm. It is a locating cover without intended retention.
- **Compliant fit → Contact ribs** adds spaced, rounded contact ribs on the locating rim.
  Contact stays away from corners and the rim retains clearance between ribs.
  Flat inset friction lids have a hollow underside with a 0.8 mm locating skirt;
  stacking inset lids have a filled center;
  overlapping lids retain their continuous outside skirt at the selected wall
  thickness. Thicker overlapping skirts flex less and need a new physical fit test. The ribs are on the
  mating face, with tapered entry and no cutouts through the exterior edge.
  This original thin-rim adaptation remains the default interface. **Rib spacing** adjusts the target spacing from
  8 to 60 mm, automatically adding or removing ribs. The panel shows the count
  per edge along the width and length. Ribs distribute evenly within the usable
  span, keeping clear of the corners; the actual spacing can differ from the
  target. The 24 mm default retains the original layout. This setting affects
  only Contact ribs, preserves the bin, and is saved with the project and undo history.
- **Side springs** uses 0.8 mm rounded strips fixed at one end, with a small
  rounded contact bump near the free end. The beams sit at the mating interface,
  below a solid cap, with a 0.3 mm release gap above them and travel space behind
  them. Adjacent spring windows cover over 90% of each usable straight edge,
  separated by 1.6 mm anchors. The count grows with the bin size, with an
  approximately 24 mm pitch and no eight-spring limit. Nothing opens through
  the top. They bend in the plane of printed layers.
  The center is filled down to the springs' bottom plane so stacking lids
  have a flat base on the build plate. The inset locator ends at the springs'
  existing 0.85 mm height; the cap, contact height, and seating datum stay fixed.
  Overlapping lids keep a receiving channel around the filled center for the
  bin rim. Working gaps remain open and each beam attaches only at its root.
  Existing matching hollow bins can be reused. Solid-fill overlapping bins need
  re-exporting: their fill stops 5 mm below the rim, leaving 0.2 mm below the
  new lid core. Pocket depths follow that lowered fill surface.
- **Angled fins** uses repeated 0.6 mm fingers attached at their roots, with a
  tapered entry. Fins run continuously across each straight side, with no solid
  center blocks; only the corners remain solid. Blade spacing leaves 0.6 mm
  material and approximately 0.6 mm air measured perpendicular to the fins,
  for roughly 50% material. A 0.3 mm release gap separates each finger from the cap, following
  Slant3D's guidance at about 3:35. Inspect the gap in the slicer; drooping strands,
  fused first layers, or support material can prevent movement. The top stays solid.
- **Spring latch (inset only)** uses a 0.8 mm spring with three rounded U bends
  arranged perpendicular to the edge. The head retracts toward the fixed root
  at the back of an approximately 11 mm deep chamber. Following the enclosed
  mechanism shown at [4:13–5:22 in Slant3D's video](https://www.youtube.com/watch?v=IZKh6lo9SP4&t=253s),
  a solid roof and 0.6 mm lower cover hide the spring from both top and bottom.
  The surrounding underside is filled to the same level as the enclosure
  floors, forming one continuous bottom instead of separate projecting blocks.
  Only the working spring chambers remain hollow; their release gaps stay open.
  The 1.3 mm high moving parts have 0.3 mm release gaps above and below;
  only the head is exposed through a centered opening in the edge, also with
  0.3 mm clearance around it. Beveled head edges help clear printed bridges.
  The lower cover follows the entry slope to clear the bin's lip. A rounded detent
  mates with a 0.4 mm recess in the bin. **Pull up to release**: both insertion
  and removal have rounded ramps. These dimensions are Pocketry prototype
  choices, not dimensions specified or validated by Slant3D.
- The new interfaces occupy all four sides, clear of the corners, on bins at
  least 36 mm wide and long. Overlapping side springs and fins reserve at least
  3.4 mm for the mechanism plus 0.3 mm clearance and the selected inner rim wall.
  The outer footprint stays fixed. **Export a matching bin and lid when changing
  interface**: side springs and angled fins share a bin; the inset latch needs
  its matching recesses. Revised latch heads are centered on each chamber, so
  bins from before that centering change also need re-exporting. The enclosed
  chamber preserves the current recess position and preload, so current matching
  latch bins can be reused with the enclosed lid. Pocket and finger cutters cannot
  remove the recess backing. Switching from an inset latch to Overlapping edge
  selects Contact ribs; undo restores the previous style and latch together.
- The optional stacking rim stays continuous, above the solid cap. Loaded
  stacking still needs physical testing. Start with a flat top when qualifying
  the springs, and inspect the release gaps so support or drooping bridges do
  not weld the mechanisms to the cap.
- The five **Grip** positions change contact by 0.05 mm per side per step.
  Ribs, spring bumps, and fin tips have 0.15 mm intended preload at the default for overlapping lids,
  0.05 mm at **Lighter**, and 0.25 mm at **Firmer**. Inset ribs and fins use
  0.25 mm at default, 0.15 mm at **Lighter**, and 0.35 mm at **Firmer**.
  The retained spring prototypes keep their original preload. Every compliant setting
  requires a little deflection at all four sides to take up play; rigid corners
  retain clearance. These are prototype starting values,
  not guaranteed holding forces. The bin geometry stays unchanged, so only
  the lid needs reprinting for fit adjustments.
- The spring latch projects 0.55 mm at the default, adjustable from 0.45 to
  0.65 mm. Its matching recess stays fixed at 0.4 mm depth, giving the seated
  spring the same 0.05–0.25 mm preload. Grip changes the detent projection,
  not beam thickness. Earlier latches relaxed inside the recess; only the lid
  needs reprinting to add preload to an existing matching latch bin.
- Fit adjustment changes sideways clearance or rib protrusion. It does not
  change lid height, cap thickness, or the clearance above the bin's lip.
- Fit controls appear only without closure magnets. Their preferences are
  retained while magnets are on, but magnetic closures always use 0.15 mm locating
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

Project schema v25 adds the Grip recess preference (default off in older designs
and every undo history entry). It also stores rib spacing and the interface as well as shared magnet size, wall
thickness, lid style, top, closure settings, and fit. Existing designs and undo
history default to Contact ribs with 24 mm target spacing. Projects from before v22 default to 6 × 2 mm
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
with the stacking lip facing upward. Filled centers now support these caps
from the bed; the rim channels, fin release gaps, and magnet-pad clearances
still require bridges. Round 3 lids 305 and 316 had unsupported underside defects
that prevented full seating. The revised underside has not yet been printed.
Inspect the sliced layers with the actual filament and printer profile before
printing. Stacking lids are not the same orientation as flat-top lids.

Check that the slicer resolves the 0.6 mm fins, release gaps, and contact ribs.
Side springs and Spring latch remain disabled pending research and redesign;
their existing dimensions and digital checks did not produce reliable printed
mechanisms. Angled fins still need their cap gap to print and release cleanly. Dry-fit
before installing magnets: check entry, full seating, sideways play, and removal.
For friction lids, begin at the middle adjustment and tune after this test.
Use the printer, material, and settings intended
for the larger bin, and test repeated opening. Test a bin on the stacking top.

Install opposing magnet pairs with attracting faces together. A fully seated
2 mm magnet sits 0.4 mm below each mating face, giving a nominal 0.8 mm gap
between paired magnets. Check retention before use. The initial labeled fit
results are recorded above; long-term rim durability, creep, magnet-hole fit,
magnetic holding strength, and loaded stacking still require physical testing.

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
contact, continuous covers above and below the latch, centered side openings,
rear-only spring attachment, adjacent side springs on long edges, filled side-spring
bottoms, root-only attachment of every beam, cutter protection, and unchanged bin geometry across fit adjustments.
The subsequent gray PETG fit run exposed complete failures in the side-spring
and folded-latch families, so both remain disabled pending substantial research
and redesign. The round 3 report records useful rib and fin fits alongside cap,
grip, clearance, and stacking-print defects. Passing digital geometry and slicer
checks did not establish reliable physical spring behavior or usable undersides.

The round 3 feedback regression checks also compare complete cap outlines,
5 mm inset grip thickness, actual easy-lift/magnetic face clearance, recess
wall/contact preservation, fin-only interference, bed-supported stacking
centers, and solid-fill clearance. Schema migration and desktop/mobile undo
checks cover the new Grip recess switch. These checks do not replace the next
physical fit and printability test.

An isolated Bambu Studio 2.8.2.61 slice of six revised stacking lids completed
with the round 3 H2D 0.4 mm / gray Generic PETG profile, 0.2 mm layers, three
walls and 15% infill. It covered overlapping easy-lift, contact ribs, angled
fins and empty magnetic closures, inset angled fins, and a larger 3×2 overlap
fin lid. All used filament 2. The slicer returned success with no warnings
and no support extrusion; each part has first-layer extrusion. The center is
supported from the bed, but bridges remain over channels, release gaps and
sparse infill. A clean slice is not proof that those bridges will print cleanly.
No print was started.
