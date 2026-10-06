"""Independent OCCT acceptance reader, never part of the web application.

Requires Python 3.12 and cadquery-ocp==7.8.1.1.post1 in an isolated environment.
Generate fixtures with export-step-fixtures.ts, then pass their directory here.
Checks solid validity, volume, bounds, analytic carriers, preserved assembly
names, and an additional CAD Boolean edit. Fails on the first mismatch.
"""
import json
import math
import sys
from pathlib import Path
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCP.Bnd import Bnd_Box
from OCP.GProp import GProp_GProps
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDataStd import TDataStd_Name
from OCP.TDF import TDF_Label, TDF_LabelSequence
from OCP.TDocStd import TDocStd_Document
from OCP.TopAbs import TopAbs_FACE, TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS
from OCP.XCAFDoc import XCAFDoc_DocumentTool
from OCP.gp import gp_Pnt

def volume(shape):
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return props.Mass()

def label_name(label):
    attribute = TDataStd_Name()
    assert label.FindAttribute(TDataStd_Name.GetID_s(), attribute)
    return attribute.Get().ToExtString()

directory = Path(sys.argv[1])
results = []
for fixture in json.loads((directory / "manifest.json").read_text()):
    bin_shape = None
    for variant in ["bin", "design-objects"]:
        path = directory / f"{fixture['name']}-{variant}.step"
        reader = STEPControl_Reader()
        assert reader.ReadFile(str(path)) == IFSelect_RetDone, path
        assert reader.TransferRoots() > 0, path
        shape = reader.OneShape()
        assert BRepCheck_Analyzer(shape).IsValid(), f"Invalid B-rep: {path}"
        solids = []
        iterator = TopExp_Explorer(shape, TopAbs_SOLID)
        while iterator.More():
            solid = TopoDS.Solid_s(iterator.Current())
            assert BRepCheck_Analyzer(solid).IsValid()
            solids.append(solid)
            iterator.Next()
        expected = [fixture["binVolume"]] if variant == "bin" else fixture["objectVolumes"]
        actual = sorted(volume(solid) for solid in solids)
        assert len(actual) == len(expected), (path, actual, expected)
        for left, right in zip(actual, sorted(expected)):
            assert math.isclose(left, right, rel_tol=1e-9, abs_tol=1e-6), (path, left, right)
        box = Bnd_Box()
        BRepBndLib.AddOptimal_s(shape, box)
        x0, y0, z0, x1, y1, z1 = box.Get()
        for left, right in zip([x0, y0, z0, x1, y1, z1],
            [-fixture["width"]/2, -fixture["length"]/2, 0, fixture["width"]/2, fixture["length"]/2, fixture["height"]]):
            assert math.isclose(left, right, abs_tol=2e-6), (path, box.Get())
        carriers = {}
        faces = TopExp_Explorer(shape, TopAbs_FACE)
        while faces.More():
            carrier = str(BRepAdaptor_Surface(TopoDS.Face_s(faces.Current())).GetType())
            carriers[carrier] = carriers.get(carrier, 0) + 1
            faces.Next()
        assert all(key.endswith(("GeomAbs_Plane", "GeomAbs_Cylinder")) for key in carriers), carriers
        if variant == "bin":
            bin_shape = shape
            # Cut into the left side; this must produce a smaller, still valid CAD solid.
            cutter = BRepPrimAPI_MakeBox(gp_Pnt(-fixture["width"]/2, -2, -1), 3, 4, fixture["height"] + 2).Shape()
            edit = BRepAlgoAPI_Cut(shape, cutter)
            assert edit.IsDone() and BRepCheck_Analyzer(edit.Shape()).IsValid(), path
            assert volume(edit.Shape()) < volume(shape) - 1, path
        else:
            document = TDocStd_Document(TCollection_ExtendedString("BinXCAF"))
            assembly_reader = STEPCAFControl_Reader()
            assembly_reader.SetNameMode(True)
            assert assembly_reader.ReadFile(str(path)) == IFSelect_RetDone
            assert assembly_reader.Transfer(document)
            tool = XCAFDoc_DocumentTool.ShapeTool_s(document.Main())
            roots = TDF_LabelSequence()
            tool.GetFreeShapes(roots)
            assert roots.Length() == 1
            components = TDF_LabelSequence()
            assert tool.GetComponents_s(roots.Value(1), components)
            names = []
            for index in range(1, components.Length() + 1):
                referred = TDF_Label()
                assert tool.GetReferredShape_s(components.Value(index), referred)
                names.append(label_name(referred))
            assert names == fixture["objectNames"], (names, fixture["objectNames"])
            # Rebuild the finished tray from the exported editable construction tools.
            blank_index = max(range(len(solids)), key=lambda i: volume(solids[i]))
            reconstructed = solids[blank_index]
            for index, cutter in enumerate(solids):
                if index == blank_index:
                    continue
                cut = BRepAlgoAPI_Cut(reconstructed, cutter)
                assert cut.IsDone() and BRepCheck_Analyzer(cut.Shape()).IsValid(), path
                reconstructed = cut.Shape()
            assert math.isclose(volume(reconstructed), fixture["binVolume"], rel_tol=1e-9, abs_tol=1e-6)
            for left, right in [(bin_shape, reconstructed), (reconstructed, bin_shape)]:
                difference = BRepAlgoAPI_Cut(left, right)
                assert difference.IsDone() and abs(volume(difference.Shape())) < 1e-6, path
        results.append({"file": path.name, "valid": True, "volumes": actual, "surfaces": carriers})
(directory / "cad-verification.json").write_text(json.dumps(results, indent=2))
print(json.dumps(results, indent=2))
