# Slanted label support

Issue [#189](https://github.com/wcscr/pocketry/issues/189) reported a PrusaSlicer
overhang warning and rough label undersides on a physical print. The bin used
4 × 4 half-pitch cells, height 5.5 U, a 2 × 3 compartment grid, 1.2 mm dividers,
both Y walls slanted +30°, full-width south-facing compartment labels, an 8 mm
bottom fillet, no scoop and no stacking lip.

Previously the 36° upright tab profile was sheared with the walls, flattening
its underside to 27.1° from horizontal. At 0.2 mm layers, the horizontal step
increased from about 0.28 to 0.39 mm. A closed mesh did not catch this printability
problem.

The support profile now accounts for the final slant. Both-wall shears restore
the nominal angle; single-wall warps also account for the changing compartment
span. Only the underside grows: the top, tip thickness, width and depth retain
their existing dimensions. A support that reaches the floor spreads its foot
along that floor, remaining body-colored. Slants too steep to retain the support
angle retain the existing shelf and produce a warning. Collision bounds include
the deeper support.

## Slicer verification — 2026-10-24

The original and corrected exports were sliced upright with supports disabled,
0.2 mm layers, 0.2 mm first layers and a 0.4 mm nozzle:

| Slicer | Original | Corrected | Label-free control |
| --- | --- | --- | --- |
| PrusaSlicer 2.9.6 | Collapsing overhang; Long bridging extrusions | Long bridging extrusions only | Long bridging extrusions only |
| Bambu Studio 2.8.2.61 | Slices successfully; no reported warning | Slices successfully; no reported warning | Not required |

PrusaSlicer used an explicit comparison profile: 0.45 mm extrusion width, three
perimeters, 15% infill and Marlin 2 output. Bambu used the X1 Carbon 0.4 mm printer,
0.20 mm Standard and Bambu PLA Basic profiles (two walls, 20% infill). These are
reproducible comparison settings, not a claim to reproduce the user's unspecified
printer/material profile.

The corrected model removes the reproduced collapsing-overhang warning. The
remaining bridge warning also occurs without labels; this change does not resolve
or qualify that separate condition. The corrected label faces measure 36° in the
exported mesh. STL coordinate-edge closure and 3MF topology are checked separately.
No corrected physical print has been tested.

Custom footprints and closing wedges are covered separately. An irregular
closing wedge with a bottom fillet also exposed pre-existing STL contact seams
in a label-free control; that separate combination is not qualified by this fix.

Automated qualification covers the reported geometry, both axes and signs,
single-wall and both-wall slants, shallow floor-reaching supports, boundary and
compartment labels, custom footprints, closing wedges, scoops, bottom fillets
and material separation. No saved-project fields or user settings change.
