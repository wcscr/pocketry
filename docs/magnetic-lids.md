# Magnetic lids

Implements [feature request #29](https://github.com/wcscr/pocketry/issues/29).
Enable **Construction → Magnetic lid**. Export the bin normally, then use
**Export → Export magnetic lid** for a separate STL or 3MF. Both exports can
include an editable project JSON. Lid settings also survive autosave and undo.

The 3D view offers **Raised**, **Closed**, and **Hidden**. The layout view marks
the four corner supports in amber. Pockets and finger access must clear these
areas; validation blocks conflicting exports, and the geometry worker checks
the actual cutters against the support solids too.

## Geometry

- Four magnet pairs: four in the bin and four in the lid. Base magnets are an
  independent option and are additional to these eight magnets.
- Same recess constants as the base: **6.5 mm diameter × 2.4 mm depth**. The
  nominal magnet thickness in the existing base standard is 2 mm. These are
  glue-in lid recesses; the underside Crush ribs option still applies only
  to base magnets.
- Centers sit 7.75 mm inward from each outer edge, matching the outermost base
  magnet positions at full pitch. Positions are independent of socket pitch.
- Each bin pad reserves 12.2 mm along its two corner edges and ends at the
  nominal rim height. It has 1.2 mm of material around and below its recess.
  The underside grows inward at 45 degrees from the walls, clipped to the
  base on short bins.
- The lid uses the existing base profile as a continuous locating perimeter,
  with 0.2 mm additional clearance on each side. It is 4.75 mm thick, has a
  shallow front nail recess, and has a flat top. The closed lid's bottom is
  at the bin's nominal rim; it does not change pocket depths.
- Remove the lid to stack another bin. The supports clear the ordinary base
  geometry. The flat lid does not provide a stacking recess on top.
- Rectangular footprints only in this version. Both Gridfinity and flat
  bottoms work; full, half, and quarter pitches work when the physical width
  and length are at least 26.3 mm (the UI recommends 27 mm). Minimum height is
  2u. Unsupported settings remain editable and block export.

The lid and supports are original Pocketry geometry assembled from the already
attributed Gridfinity primitives; no external lid design or new dependency was
ported. Project schema v18 defaults magnetic lids off for previous designs,
including all saved undo/redo entries.

## First print

Generate a small hollow 1×1×2u bin and lid, plus an editable project:

```sh
npm run export:bin -- 1x1x2 --magnetic-lid --out outputs/magnetic-lid-fit
```

Print the bin upright. Lid exports already put the flat face on the bed and
the magnet recesses upward. Dry-fit the unglued pieces, confirm the lid locates
freely and can be lifted at the notch, then test magnets and glue with each
opposing pair attracting. A fully seated 2 mm magnet is recessed 0.4 mm in
each piece, so verify the resulting 0.8 mm face gap gives enough retention.
Check magnet fit, lid removal, and stacking with the lid removed before
printing larger bins. Holding strength and physical print fit are **not yet
validated**; the checks below qualify the digital geometry only.

## Verification

Automated checks cover connected watertight body/lid solids, matching bore
dimensions and closed floors, non-intersection when closed or stacked, print
orientation, pocket/finger-access conflicts, unsupported dimensions, worker
transfer and section isolation, project migration, undo, and separate STL/3MF
exports. Browser checks exercise the actual controls and previews.
