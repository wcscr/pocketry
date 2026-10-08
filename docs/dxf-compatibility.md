# DXF compatibility

Trace and Bin layout share `client/src/lib/export/dxf.ts`. Exports use AutoCAD
2013 (`AC1027`), millimetres, and one closed `LWPOLYLINE` per ring. Trace applies
its existing pixel-to-millimetre/Y-flip boundary; layout coordinates are already
in millimetres and must not be converted again.

## Fusion import failure

The previous writer emitted only HEADER and ENTITIES. It referred to layer `0`
without defining that layer, and omitted the symbol tables, space definitions,
entity ownership and root object dictionary needed by a modern DXF drawing.
Fusion could open the file and accept a plane selection without creating any
sketch geometry. The unit tests checked coordinates and polyline tags, so they
did not catch this interoperability failure.

The writer now emits CLASSES, standard TABLES, model/paper-space BLOCKS and the
root/ACAD_GROUP dictionaries in OBJECTS. All geometry belongs to the model-space
block record and the explicitly defined layer `0`. The layer includes group
390 (a null plot-style handle): removing this field from the otherwise complete
drawing causes Fusion's native DXF translator to reject it. Handles are unique,
all non-null references resolve, and `$HANDSEED` exceeds every allocated handle.

## Validation and reproduction

Checked on macOS with Autodesk Fusion **2705.1.15**, September 21, 2026:

- Original calibrated Trace square/hole: native translator returned an empty
  12-byte FST, and the UI created no sketch after plane selection.
- Corrected calibrated and uncalibrated Trace: translation succeeded with
  geometry (514-byte FST).
- Corrected 2 x 3 Bin layout with a rotated rectangular pocket: translation
  succeeded with geometry (4354-byte FST).
- Corrected empty export: translation succeeded with an empty 12-byte FST.
- Removing layer group 390 from the complete Trace file: translation failed
  with exit code 2. Restoring it: exit code 0 and geometry present.

For a manual check, export a calibrated outline with a hole, then open the local
DXF in Fusion and select a sketch plane. Alternatively use **Insert > Insert
DXF**, choose a plane, select the file, and specify **mm**. Check the outer ring,
interior hole, dimensions and orientation. Repeat for a Bin layout with a placed
pocket. A visible origin/plane selector alone is not a completed import.

Automated tests cover document structure, symbol definitions, table counts,
handle uniqueness/ownership, layer metadata, empty files, closed rings, holes,
concavity, calibrated dimensions and orientation shared with STL. Tests do not
replace import checks in a native CAD reader. Older Fusion releases and the
reporter's exact file/version have not been tested.

## Format references

- [Autodesk DXF file structure](https://help.autodesk.com/cloudhelp/2023/ENU/AutoCAD-DXF/files/GUID-D939EA11-0CEC-4636-91A8-756640A031D3.htm)
- [Autodesk LAYER group codes](https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-DXF/files/GUID-D94802B0-8BE8-4AC9-8054-17197688AFDB.htm)
- [ezdxf minimum content for R13 and later](https://ezdxf.readthedocs.io/en/stable/dxfinternals/filestructure.html#dxf-r13-r14-and-later)

The ezdxf example `Minimal_DXF_AC1021.dxf` was used as an external diagnostic
control with the same generated geometry; it is not bundled into Pocketry.
