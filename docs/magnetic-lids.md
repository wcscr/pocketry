# Lids

Implements [feature request #29](https://github.com/wcscr/pocketry/issues/29).
Enable **Construction → Lid**, choose **Overlapping edge** or **Inset**, and
choose a **Flat** or **Stacking top**. Magnets are optional. With **Lid magnet
holes** off, choose **Easy lift-off** or **Friction fit** and use the single
**Looser / Tighter** adjustment.
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
| Bin rim | Top 5 mm steps inward 1.1 mm per side | Standard Gridfinity stacking lip |
| Lid | Continuous outside skirt wraps around the stepped rim | Chamfered locating plug seats inside the lip |
| Flat top | 3.6 mm cap above the mating face | 6.75 mm total; about 3.2 mm exposed above the lip to grip |
| Stacking top | 4 mm cap plus a Gridfinity lip | 8 mm cap plus a Gridfinity lip |
| Alignment | 0.3 mm clearance per side and a chamfered entry | 0.3 mm extra clearance per side |
| Edge | Continuous 0.8 mm skirt | Continuous chamfered profile |

The overlapping skirt stays within the bin's original footprint and stops
0.2 mm above its shoulder. Entry chamfers ease seating.
Both styles have continuous edges without isolated center-edge blocks or pockets. The bin's rim
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
- **Friction fit** adds spaced, rounded contact ribs on a thin locating rim.
  Contact stays away from corners and the rim retains clearance between ribs.
  Inset friction lids have a hollow underside with a 0.8 mm locating skirt;
  overlapping lids retain their continuous outside skirt. The ribs are on the
  mating face, with tapered entry and no cutouts through the exterior edge.
  This is an original thin-rim adaptation, not a reproduction of Slant3D's
  independent side springs or fin array. Rib and rim compliance is unverified
  until a physical print is tested.
- The five adjustment positions change the lid by 0.05 mm per side per step,
  from 0.1 mm looser to 0.1 mm tighter. Friction starts with 0.05 mm of intended
  interference at the ribs; the loosest setting leaves 0.05 mm clearance and
  the tightest uses 0.15 mm interference. These are prototype starting values,
  not guaranteed holding forces. The bin geometry stays unchanged, so only
  the lid needs reprinting for fit adjustments.
- Fit controls appear only without closure magnets. Their preferences are
  retained while magnets are on, but magnetic closures always use the original
  clearance and omit the friction ribs. Base magnets do not hide lid fit.

## Independent magnets

- **Base magnet holes** controls the bin's underside magnets. **Base crush
  ribs** appears when those holes are enabled. Existing full-pitch and flat
  bottom restrictions still apply to underside holes.
- **Lid magnet holes** controls four matching pairs: four in the lid and four
  in the bin rim. **Lid crush ribs** appears when closure holes are enabled.
  These choices are independent of the underside settings.
- Turning off lid magnet holes removes the holes and the bin's corner magnet
  supports, freeing those areas for pockets. The alignment rim remains.
- Both use the base recess constants: **6.5 mm diameter × 2.4 mm depth**, for
  the same magnets used underneath (nominally 2 mm thick). Crush ribs reuse
  the base's eight-lobe press-fit bore; without ribs, glue the magnets.
- Closure magnet centers are 7.75 mm inward from each original outer edge,
  independent of socket pitch. Supports reserve 12.2 mm along each corner
  edge and grow inward at 45 degrees underneath. Recess floors retain 1.2 mm
  of material. Layout marks these supports in amber while closure holes are
  enabled; conflicting pockets or finger access block export. The geometry
  worker also checks actual cutter intersections.
- Rectangular footprints only. Gridfinity or flat bottoms; full, half, or
  quarter pitch, with both outer dimensions at least 26.3 mm (the UI
  recommends 27 mm). Minimum bin height is 2u.

Project schema v19 stores lid style, top, independent closure settings, and fit.
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

Check that the slicer resolves the 0.8 mm skirt and the friction ribs. Dry-fit
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
The plate is prepared in Bambu Studio; measured fit and retention results
have not yet been recorded.

Tests cover both styles and tops at preview/export quality: connected solids,
clearance when closed for magnetic and lift-off lids, controlled interference
only at the friction ribs, increasing contact with tighter adjustment, unchanged
bin geometry when tuning, stacking clearance, matching recesses and solid floors,
print orientation, rim and corner conflicts, the thicker inset grip, optional
magnets and independent crush ribs, conditional fit controls, default/custom lid colors, legacy migration,
undo, worker transfer and section isolation, and separate STL/3MF exports.
Browser checks exercise the actual controls, closure previews, and exports.
