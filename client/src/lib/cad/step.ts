import type { TDF_Label } from "replicad-opencascadejs";
import { CadContext, CAD_TOLERANCE_MM, type CadShape } from "./adapter";

export interface NamedCadBody { id: string; name: string; shape: CadShape; color?: string }

/** XCAF associates names and colors with actual geometry and assembly instances. */
export function writeCadStep(c: CadContext, bodies: readonly NamedCadBody[], assemblyName: string): Uint8Array {
  if (!bodies.length) throw new Error("Cannot export an empty STEP assembly");
  for (const body of bodies) if (!c.valid(body.shape)) throw new Error(`${body.name} (${body.id}): invalid STEP body`);
  c.guard("STEP assembly");
  const oc = c.oc;
  const doc = c.own(new oc.TDocStd_Document(c.own(new oc.TCollection_ExtendedString("XmlOcaf",true))));
  oc.XCAFDoc_DocumentTool.SetLengthUnit(doc,0.001);
  const main = c.own(doc.Main());
  const shapes = c.own(oc.XCAFDoc_DocumentTool.ShapeTool(main));
  const colors = c.own(oc.XCAFDoc_DocumentTool.ColorTool(main));
  const name = (label: TDF_Label, value: string) => c.own(oc.TDataStd_Name.Set(label,c.own(new oc.TCollection_ExtendedString(value,true))));
  const assembly = c.own(shapes.NewShape()); name(assembly,assemblyName);
  for (const body of bodies) {
    // Fusion imports product-definition names, discarding assembly-instance names.
    // Put the same stable identity on both labels so duplicate source names remain
    // distinguishable without a CAD application's generated duplicate-name suffix.
    const stableName = `${body.name} [${body.id}]`;
    const definition = c.own(shapes.NewShape()); shapes.SetShape(definition,body.shape); name(definition,stableName);
    const instance = c.own(shapes.AddComponent(assembly,definition,c.own(new oc.TopLoc_Location())));
    name(instance,stableName);
    if (body.color && /^#[0-9a-f]{6}$/i.test(body.color)) {
      const rgb = [1,3,5].map(i=>parseInt(body.color!.slice(i,i+2),16)/255);
      const color = c.own(new oc.Quantity_ColorRGBA(rgb[0],rgb[1],rgb[2],1));
      colors.SetColor(definition,color,oc.XCAFDoc_ColorType.XCAFDoc_ColorGen);
    }
  }
  shapes.UpdateAssemblies();
  const writer = c.own(new oc.STEPCAFControl_Writer());
  if (!oc.Interface_Static.SetIVal("write.step.schema",4) || !oc.Interface_Static.SetCVal("write.step.unit","MM")) {
    throw new Error("CAD engine refused AP214 millimetre STEP settings");
  }
  oc.Interface_Static.SetIVal("write.step.tessellated",0);
  writer.SetNameMode(true); writer.SetColorMode(true); writer.SetPropsMode(true);
  // OCCT 8 defaults to SplitCommonVertex/DirectFaces for STEP encoding.
  // These preserve surfaces; no FixShape or geometry-changing repair is enabled.
  // OperationsFlags is not bound in 1.1.0; do not call its unusable setter.
  c.own(writer.ChangeWriter()).SetTolerance(CAD_TOLERANCE_MM);
  const path = "/pocketry-export.step";
  try {
    const progress = c.own(new oc.Message_ProgressRange());
    if (!writer.Perform(doc,path,progress)) throw new Error("CAD engine failed to write STEP assembly");
    const bytes = new Uint8Array(oc.FS.readFile(path));
    const text = new TextDecoder().decode(bytes);
    if (/TESSELLATED_|TRIANGULATED_|FACETED_BREP\s*\(/.test(text)) throw new Error("CAD engine produced a forbidden mesh representation");
    if (!text.includes("AUTOMOTIVE_DESIGN") || !text.includes("MANIFOLD_SOLID_BREP")) throw new Error("STEP is missing its AP214 solid representation");
    c.guard("STEP serialization");
    return bytes;
  } finally {
    try { oc.FS.unlink(path); } catch { /* Transfer can fail before creating a file. */ }
    doc.BeforeClose();
  }
}
