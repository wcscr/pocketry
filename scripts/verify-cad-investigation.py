"""Independent OCCT 7.8 acceptance of OCCT 8 generated investigation files.
Run in an isolated cadquery-ocp==7.8.1.1.post1 environment. No application link.
"""
import json, math, re, sys, zipfile, struct
from pathlib import Path
from collections import Counter
from xml.etree import ElementTree as ET
from OCP.BRepAdaptor import BRepAdaptor_Surface, BRepAdaptor_Curve
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.BRep import BRep_Tool
from OCP.Bnd import Bnd_Box
from OCP.GProp import GProp_GProps
from OCP.GeomAbs import GeomAbs_Circle, GeomAbs_Ellipse
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader, STEPControl_Writer, STEPControl_AsIs
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDataStd import TDataStd_Name
from OCP.TDF import TDF_Label, TDF_LabelSequence
from OCP.TDocStd import TDocStd_Document
from OCP.TopAbs import TopAbs_FACE, TopAbs_SOLID, TopAbs_SHELL, TopAbs_EDGE
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS
from OCP.XCAFDoc import XCAFDoc_DocumentTool
from OCP.gp import gp_Pnt, gp_Trsf, gp_Vec

def subshapes(shape, kind):
    iterator = TopExp_Explorer(shape, kind)
    while iterator.More():
        yield iterator.Current()
        iterator.Next()

def volume(shape):
    props = GProp_GProps(); BRepGProp.VolumeProperties_s(shape, props); return props.Mass()

def valid(shape):
    assert BRepCheck_Analyzer(shape, True).IsValid(), "Invalid independent B-rep"
    for solid in subshapes(shape, TopAbs_SOLID):
        assert volume(solid)>0
        for shell in subshapes(solid, TopAbs_SHELL): assert BRep_Tool.IsClosed_s(shell)

def read(path):
    text=path.read_text(); assert "AUTOMOTIVE_DESIGN" in text
    assert not re.search(r"TESSELLATED_|TRIANGULATED_|FACETED_BREP\s*\(", text)
    reader=STEPControl_Reader(); assert reader.ReadFile(str(path))==IFSelect_RetDone
    assert reader.TransferRoots()>0; shape=reader.OneShape(); valid(shape); return shape

def label_name(label):
    attribute=TDataStd_Name(); assert label.FindAttribute(TDataStd_Name.GetID_s(),attribute)
    return attribute.Get().ToExtString()

def components(path):
    document=TDocStd_Document(TCollection_ExtendedString("CAD acceptance"))
    reader=STEPCAFControl_Reader();reader.SetNameMode(True);assert reader.ReadFile(str(path))==IFSelect_RetDone;assert reader.Transfer(document)
    tool=XCAFDoc_DocumentTool.ShapeTool_s(document.Main());roots=TDF_LabelSequence();tool.GetFreeShapes(roots);assert roots.Length()==1
    labels=TDF_LabelSequence();assert tool.GetComponents_s(roots.Value(1),labels)
    result={}
    for i in range(1,labels.Length()+1):
        instance=labels.Value(i);target=TDF_Label();assert tool.GetReferredShape_s(instance,target)
        result[label_name(instance)]={"name":label_name(target),"shape":tool.GetShape_s(instance)}
    return result

def boolean(kind,left,right):
    operation=kind(left,right);assert operation.IsDone();shape=operation.Shape();valid(shape);return shape

def mesh_acceptance(positions,triangles):
    edges=Counter();direction=Counter();volume_sum=0
    for a,b,c in triangles:
        assert a!=b and b!=c and c!=a
        pa,pb,pc=positions[a],positions[b],positions[c]
        u=[pb[i]-pa[i] for i in range(3)];v=[pc[i]-pa[i] for i in range(3)]
        assert math.sqrt(sum(x*x for x in [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]))>0
        volume_sum+=(pa[0]*(pb[1]*pc[2]-pb[2]*pc[1])+pa[1]*(pb[2]*pc[0]-pb[0]*pc[2])+pa[2]*(pb[0]*pc[1]-pb[1]*pc[0]))/6
        for u,v in [(a,b),(b,c),(c,a)]:
            key=tuple(sorted((u,v)));edges[key]+=1;direction[key]+=1 if u<v else -1
    assert all(count==2 for count in edges.values()),"Nonmanifold printable mesh"
    assert all(count==0 for count in direction.values()),"Inconsistent winding"
    assert volume_sum>0;return volume_sum

root=Path(sys.argv[1]);results=[]
for directory in sorted(path for path in root.iterdir() if path.is_dir()):
    report=json.loads((directory/"export-report.json").read_text());objects=json.loads((directory/"objects.json").read_text())
    finished=read(directory/"bin.step");tools=read(directory/"design-objects.step")
    # Fixture dimensions are specified independently of the exporter report.
    expected_dimensions={"standard-solid":(41.5,41.5,24.551471862576),"standard-hollow":(83.5,41.5,24.551471862576),
        "mixed":(125.5,83.5,31.551471862576),"concave":(125.5,83.5,28),"tilted":(125.5,125.5,35),"irregular":(83.5,83.5,31.551471862576)}
    measured=Bnd_Box();BRepBndLib.AddOptimal_s(finished,measured,False,False);lo_x,lo_y,lo_z,hi_x,hi_y,hi_z=measured.Get()
    dimensions=(hi_x-lo_x,hi_y-lo_y,hi_z-lo_z)
    assert all(math.isclose(a,b,abs_tol=2e-5) for a,b in zip(dimensions,expected_dimensions[directory.name])),(directory.name,dimensions)
    counts={"bin":len(list(subshapes(finished,TopAbs_SOLID))),"designObjects":len(list(subshapes(tools,TopAbs_SOLID)))}
    assert counts==report["solidCounts"],(directory,counts,report["solidCounts"])
    assembly=components(directory/"design-objects.step")
    for item in objects["objects"]:
        key=item["stepInstanceName"]
        if item["status"]=="inactive":assert key not in assembly;continue
        actual=assembly[key];assert actual["name"]==item["name"]
        assert math.isclose(volume(actual["shape"]),item["volumeMm3"],rel_tol=1e-9,abs_tol=1e-5),(key,volume(actual["shape"]),item["volumeMm3"])
        box=Bnd_Box();BRepBndLib.AddOptimal_s(actual["shape"],box,False,False);coords=box.Get()
        expected=[*item["boundsMm"]["min"].values(),*item["boundsMm"]["max"].values()]
        assert all(math.isclose(a,b,abs_tol=2e-5) for a,b in zip(coords,expected)),(key,coords,expected)
    by_id={item["id"]:item for item in objects["objects"]}
    if directory.name in ["mixed","concave"]:
        source=next(item for item in objects["objects"] if item["role"]=="pocket-source" and item["shapeId"] in ["circle","ellipse"])
        actual=assembly[source["stepInstanceName"]]["shape"];radii=[]
        for edge in subshapes(actual,TopAbs_EDGE):
            curve=BRepAdaptor_Curve(TopoDS.Edge_s(edge))
            if curve.GetType()==GeomAbs_Circle:radii.append((curve.Circle().Radius(),curve.Circle().Radius()))
            if curve.GetType()==GeomAbs_Ellipse:radii.append((curve.Ellipse().MajorRadius(),curve.Ellipse().MinorRadius()))
        expected=(6,6) if directory.name=="mixed" else (9.8,4.9)
        assert any(all(math.isclose(a,b,abs_tol=1e-7) for a,b in zip(radius,expected)) for radius in radii),(directory.name,radii)
    reconstructed=assembly[by_id["bin-blank"]["stepInstanceName"]]["shape"]
    for ident in objects["reconstructionOrder"][1:]:
        item=by_id[ident]
        if item["status"]=="inactive":continue
        shape=assembly[item["stepInstanceName"]]["shape"]
        reconstructed=boolean(BRepAlgoAPI_Fuse if item["role"]=="text-body" else BRepAlgoAPI_Cut,reconstructed,shape)
    for left,right in [(finished,reconstructed),(reconstructed,finished)]:
        assert abs(volume(boolean(BRepAlgoAPI_Cut,left,right)))<1e-5,"Reconstruction differs from exported bin"
    # Move a named actual cutter and reconstruct from the named blank.
    active=[item for item in objects["objects"] if item["role"]=="pocket-cutter" and item["status"]=="active"]
    moved_result=None
    if active:
        item=active[0];transform=gp_Trsf();transform.SetTranslation(gp_Vec(1,0,0))
        moved=BRepBuilderAPI_Transform(assembly[item["stepInstanceName"]]["shape"],transform,True).Shape()
        moved_result=boolean(BRepAlgoAPI_Cut,assembly[by_id["bin-blank"]["stepInstanceName"]]["shape"],moved)
    # Add a new feature, then save/reopen the independent CAD result.
    bounds=Bnd_Box();BRepBndLib.AddOptimal_s(finished,bounds,False,False);x0,y0,z0,x1,y1,z1=bounds.Get()
    edit=boolean(BRepAlgoAPI_Cut,finished,BRepPrimAPI_MakeBox(gp_Pnt(x0,-2,z0-1),3,4,z1-z0+2).Shape())
    assert volume(edit)<volume(finished)-0.1
    writer=STEPControl_Writer();assert writer.Transfer(edit,STEPControl_AsIs)==IFSelect_RetDone
    assert writer.Write(str(directory/"independent-edited.step"))==IFSelect_RetDone
    rereader=STEPControl_Reader();assert rereader.ReadFile(str(directory/"independent-edited.step"))==IFSelect_RetDone;assert rereader.TransferRoots()>0;valid(rereader.OneShape())
    surfaces=Counter(str(BRepAdaptor_Surface(TopoDS.Face_s(face)).GetType()) for face in subshapes(finished,TopAbs_FACE))
    curves=Counter(str(BRepAdaptor_Curve(TopoDS.Edge_s(edge)).GetType()) for edge in subshapes(tools,TopAbs_EDGE))
    if directory.name in ["mixed","irregular"]:assert any("Circle" in name for name in curves)
    if directory.name=="concave":assert any("Ellipse" in name for name in curves)
    # STL stores unindexed facets; recover exact Float32 identities for checks.
    data=(directory/"bin.stl").read_bytes();count=struct.unpack_from('<I',data,80)[0];assert len(data)==84+count*50
    vertices=[];mapping={};triangles=[]
    for i in range(count):
        indices=[]
        for j in range(3):
            p=struct.unpack_from('<fff',data,84+i*50+12+j*12)
            if p not in mapping:mapping[p]=len(vertices);vertices.append(p)
            indices.append(mapping[p])
        triangles.append(indices)
    stl_volume=mesh_acceptance(vertices,triangles)
    with zipfile.ZipFile(directory/"bin.3mf") as archive:
        model=ET.fromstring(archive.read('3D/3dmodel.model'));assert model.attrib['unit']=='millimeter'
        ns={'c':'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'};parts=[]
        for obj in model.findall('c:resources/c:object',ns):
            mesh=obj.find('c:mesh',ns)
            if mesh is None:continue
            vs=[[float(v.attrib[k]) for k in ['x','y','z']] for v in mesh.findall('c:vertices/c:vertex',ns)]
            ts=[[int(t.attrib[k]) for k in ['v1','v2','v3']] for t in mesh.findall('c:triangles/c:triangle',ns)]
            parts.append({'name':obj.attrib['name'],'volumeMm3':mesh_acceptance(vs,ts)})
        if directory.name=='irregular':assert len(parts)==4,parts
    results.append({'fixture':directory.name,'valid':True,'counts':counts,'nativeSurfaces':dict(surfaces),'nativeCurves':dict(curves),
        'dimensionsMm':dimensions,'reconstructed':True,'newFeatureSavedReopened':True,'movedNamedCutter':bool(moved_result),'cadVolumeMm3':volume(finished),
        'stlVolumeMm3':stl_volume,'meshMinusCadVolumeMm3':stl_volume-volume(finished),'threeMfParts':parts})
(root/'independent-verification.json').write_text(json.dumps({'reader':'cadquery-ocp 7.8.1.1.post1 / OCCT 7.8','results':results},indent=2))
print(json.dumps({'fixtures':len(results),'valid':True,'results':results},indent=2))
