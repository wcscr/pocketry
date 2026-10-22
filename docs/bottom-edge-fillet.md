# Hollow-bin bottom edge fillets

## Implementation plan and control inventory

- Add a saved `bottomFilletRadiusMm` setting, defaulting to zero for existing
  projects and every history snapshot. Retain it when solid fill is enabled.
- Show Bottom edge fillet in Construction whenever Solid fill is off, independent
  of the compartments and scoop switches, in both panel layouts. Use the existing
  millimetre input and edit transaction behavior. Zero disables rounding.
- Round each cavity where the floor meets the outer walls and both sides of
  dividers. Build from the actual wall and divider footprint, including custom
  footprints, before applying the same deformation as walls and scoops.
- The radius describes the upright profile. Slanted profiles remain tangent but
  are deformed arcs, rather than constant-radius circles in world coordinates.
- Union with existing scoop material: the larger curve governs a shared edge;
  side fillets meet the scoop without adding a second raised floor or a lip.
- Limit the effective radius to the available wall height and half the clear
  compartment span. Preserve the requested radius and show when it is limited.
- Include fillets in body material; color only exposed horizontal floor. Keep
  outside dimensions, base sockets, rim and divider-top accents unchanged.

## Adversarial checks

- Defaults and zero radius must preserve old geometry, including solid fill.
- A retained value must survive fill changes, disabled dividers, save/reload and
  undo/redo. Hidden controls must not reset the value.
- Check both axes, signs, one/both slanted walls and closing wedges; additions
  must stay inside the existing body envelope and attach to the fixed base.
- Check scoop-only and divided bins, small compartments, custom footprints,
  shallow bodies, and radius changes on either side of the scoop radius.
- Verify real mesh sections, material partitions and serialized STL/3MF, as well
  as schema and UI behavior. CAD checks do not qualify physical printing.

## Geometry details

The fillet uses the existing sampled cavity-offset profile: preview bands use
the preview quality setting, and export bands have a maximum vertical step of
0.1 mm. It adds material above the base, preserving the outside footprint.
For ordinary slants, fuse the wall and fillet before deforming their shared
mesh; independently warped rounded-corner faces can leave edge-only contacts
in STL. Closing wedges instead assemble the internal fillet with the dividers
and scoops before clipping, and add a separate fillet at the newly clipped
upright wall. Regression checks inspect serialized coordinates as well as
indexed manifold topology. Fillets remain body material; floor color uses the
remaining exposed horizontal area.
