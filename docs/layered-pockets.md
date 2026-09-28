# Layered pockets (project schema 27)

A finite pocket can store `layers`: ordered `{ outlineMm, bottom, top }` sections.
Each outline uses the source shape's local millimetre frame, with positive outer
and negative hole winding. `bottom` and `top` are fractions of the pocket's fixed
depth, measured from its lowest authored plane. Layers must meet exactly and
span 0 to 1. The source shape is the overall XY envelope used by size controls.

The geometry builder unions the extrusions before applying one rigid pose. The
same layers drive immediate transform wires, selection bounds, inspection,
validation and export. A PCB example uses a lower outline with four holes to
leave support ribs, followed by a rectangular upper clearance volume.

Imported layered pockets support position, elevation, rotation, mirroring,
XY scaling, total depth, clearance, duplication and linked copies. Scaling total
depth also scales the rib height; resizing a fitted PCB pocket needs a new fit
check. Individual layer contours, splitting, through cuts and edge rounding are
not offered. Layer outlines must contain their own corner treatment. There is
no interactive layer-authoring UI yet.

Version 26 projects migrate without changing their geometry or history. Version
27 projects require this application change; older released clients cannot load
them. This feature does not import arbitrary STEP or mesh geometry.
