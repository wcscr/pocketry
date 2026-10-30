"""Check native FreeCAD edits using the separately installed OCCT 7.8 reader.

Usage: python verify-freecad-step-edits.py /path/to/freecad-step-acceptance
Requires cadquery-ocp==7.8.1.1.post1 in the independent verification environment.
"""
import json, math, re, sys, hashlib
from pathlib import Path
from OCP.STEPControl import STEPControl_Reader
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.BRepPrimAPI import BRepPrimAPI_MakeCylinder
from OCP.gp import gp_Ax2, gp_Pnt, gp_Dir
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCP.IFSelect import IFSelect_RetDone
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.BRep import BRep_Builder
from OCP.TopoDS import TopoDS_Compound
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_SOLID
from OCP.TopAbs import TopAbs_SHELL
from OCP.BRep import BRep_Tool
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDataStd import TDataStd_Name
from OCP.TDF import TDF_Label, TDF_LabelSequence
from OCP.TDocStd import TDocStd_Document
from OCP.XCAFDoc import XCAFDoc_DocumentTool
from OCP.gp import gp_Trsf, gp_Vec
root=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).parent

def read(p):
 assert not re.search(r'TESSELLATED_|TRIANGULATED_|FACETED_BREP\s*\(',p.read_text())
 r=STEPControl_Reader(); assert r.ReadFile(str(p))==IFSelect_RetDone;assert r.TransferRoots()>0;s=r.OneShape();assert BRepCheck_Analyzer(s).IsValid()
 explorer=TopExp_Explorer(s,TopAbs_SOLID);assert explorer.More(),p
 while explorer.More():
  solid=explorer.Current();assert volume(solid)>0
  shells=TopExp_Explorer(solid,TopAbs_SHELL)
  while shells.More():assert BRep_Tool.IsClosed_s(shells.Current());shells.Next()
  explorer.Next()
 return s

def volume(s):
 p=GProp_GProps(); BRepGProp.VolumeProperties_s(s,p);return p.Mass()

def cut(a,b):
 o=BRepAlgoAPI_Cut(a,b);assert o.IsDone();result=o.Shape();assert BRepCheck_Analyzer(result).IsValid();return result

def components(path):
 document=TDocStd_Document(TCollection_ExtendedString('FreeCAD independent reconstruction'))
 reader=STEPCAFControl_Reader();reader.SetNameMode(True);assert reader.ReadFile(str(path))==IFSelect_RetDone;assert reader.Transfer(document)
 tool=XCAFDoc_DocumentTool.ShapeTool_s(document.Main());roots=TDF_LabelSequence();tool.GetFreeShapes(roots);assert roots.Length()==1
 labels=TDF_LabelSequence();assert tool.GetComponents_s(roots.Value(1),labels)
 result={}
 for i in range(1,labels.Length()+1):
  instance=labels.Value(i);attribute=TDataStd_Name();assert instance.FindAttribute(TDataStd_Name.GetID_s(),attribute)
  result[attribute.Get().ToExtString()]=tool.GetShape_s(instance)
 return result

def reconstruct(manifest,assembly,move=None):
 objects={obj['id']:obj for obj in manifest['objects']}
 blank=assembly[objects['bin-blank']['stepInstanceName']];texts=[]
 for ident in manifest['reconstructionOrder'][1:]:
  obj=objects[ident]
  if obj['status']!='active':continue
  shape=assembly[obj['stepInstanceName']]
  if obj['role']=='text-body':texts.append(shape);continue
  if ident==move:
   transform=gp_Trsf();transform.SetTranslation(gp_Vec(3,0,0));shape=BRepBuilderAPI_Transform(shape,transform,True).Shape()
  blank=cut(blank,shape)
 compound=TopoDS_Compound();builder=BRep_Builder();builder.MakeCompound(compound);builder.Add(compound,blank)
 for text in texts:builder.Add(compound,text)
 assert BRepCheck_Analyzer(compound).IsValid();return compound

def difference(expected,actual):
 extra=cut(actual,expected);missing=cut(expected,actual)
 def count(shape):
  explorer=TopExp_Explorer(shape,TopAbs_SOLID);number=0
  while explorer.More():number+=1;explorer.Next()
  return number
 result={'expectedVolumeMm3':volume(expected),'freecadStepVolumeMm3':volume(actual),'volumeDifferenceMm3':volume(actual)-volume(expected),'unexpectedMaterialMm3':volume(extra),'missingMaterialMm3':volume(missing),'unexpectedSolids':count(extra),'missingSolids':count(missing)}
 assert result['unexpectedSolids']==result['missingSolids']==0,result
 return result

results=[]
native_report=json.loads((root/'results'/'freecad-edit-report.json').read_text())
assert native_report['status']=='passed' and len(native_report['cases'])==12
for approach in ['dedicated','unified']:
 for fixture in ['standard-solid','standard-hollow','mixed','concave','tilted','irregular']:
  directory=root/'results'/approach/fixture
  native_case=next(case for case in native_report['cases'] if case['approach']==approach and case['fixture']==fixture)
  assert native_case['status']=='passed'
  for filename,digest in native_case['inputSha256'].items():
   assert hashlib.sha256((root/'inputs'/approach/fixture/filename).read_bytes()).hexdigest()==digest
  original=read(root/'inputs'/approach/fixture/'bin.step'); edited=read(directory/'bin-edited.step')
  x,y=(-15,-15) if fixture=='irregular' else (0,0)
  tool=BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x,y,-2),gp_Dir(0,0,1)),2,100).Shape()
  expected=cut(original,tool)
  result={'approach':approach,'fixture':fixture,**difference(expected,edited)}
  manifest=json.loads((root/'inputs'/approach/fixture/'objects.json').read_text())
  assembly=components(root/'inputs'/approach/fixture/'design-objects.step')
  result['baselineReconstruction']=difference(original,read(directory/'reconstructed-original.step'))
  move=native_case.get('cutterMove')
  if move:
   assert move['sourceUnchanged'] and move['deltaMm']==[3,0,0]
   result['movedReconstruction']=difference(reconstruct(manifest,assembly,move['id']),read(directory/'reconstructed-moved.step'))
  results.append(result);print(result,flush=True)
assert len(results)==12
(root/'freecad-independent-edits.json').write_text(json.dumps(results,indent=2)+'\n')
