# Hollow-bin bottom edge fillets

## Current behavior and controls

- `bottomFilletRadiusMm` is saved with projects and history, defaulting to zero
  for older projects. It is retained when solid fill is enabled.
- **Construction → Floor & scoops → Bottom edge fillet** is available for Hollow
  interior, independently of the compartments and scoop switches, in both panel
  layouts. The millimetre field uses normal edit transactions; zero disables rounding.
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
