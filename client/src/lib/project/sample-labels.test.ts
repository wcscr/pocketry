import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { parseProjectDoc } from "@shared/gridfinity/project";
import { withKernel } from "@/lib/manifold/runtime";
import { buildBinWithCutouts, EXPORT_QUALITY } from "@/lib/gridfinity/bin";
import { surfaceTextZ } from "@/lib/gridfinity/surface-text";
import { extractPrintableMeshData } from "@/lib/mesh/mesh-data";
import { writeThreeMf } from "@/lib/mesh/threemf";
import catalog from "../../../../samples/pocketry-sample-library.json";
import provenance from "../../../../samples/source-files.json";

const labeledSamples = [
  { slug: "wiha-drivers", wording: ["Wiha Drivers"] },
  { slug: "dewalt-right-angle-tools", wording: ["Dewalt Right Angle Adapters"] },
  { slug: "wire-strippers", wording: ["Wire Stripper"] },
  { slug: "mouldline-remover", wording: ["Mouldline", "Remover"] },
  { slug: "ryobi-cutter", wording: ["Ryobi Cutter"] },
  { slug: "bessey-gerber", wording: ["Bessey", "Gerber"] },
];

it.each(labeledSamples)("keeps $slug labels supported and exportable in the downloadable project and bundled library", async ({ slug, wording }) => {
  const file = readFileSync(new URL(`../../../../samples/${slug}/${slug}.pocketry.json`, import.meta.url), "utf8");
  const raw: unknown = JSON.parse(file);
  const project = parseProjectDoc(raw)!;
  expect(project).not.toBeNull();
  expect(project.spec.surfaceTexts.map(label => label.text)).toEqual(wording);
  expect(catalog.projects.find(item => item.id === `pocketry-sample-${slug}`)!.doc).toEqual(raw);
  expect(provenance.samples.find(item => item.directory === slug)!.project.sha256)
    .toBe(createHash("sha256").update(file).digest("hex"));
  expect(parseProjectDoc(JSON.parse(JSON.stringify(project)))).toEqual(project);

  await withKernel(kernel => {
    const result = buildBinWithCutouts(kernel, project.spec, {
      shapesById: new Map(project.shapes.map(shape => [shape.id, shape])),
      cutouts: project.cutouts, fingerHoles: project.fingerHoles,
    }, EXPORT_QUALITY);
    expect(result.validationIssues.filter(issue => issue.severity === "error")).toEqual([]);
    expect(result.textParts).toHaveLength(wording.length);
    expect(result.solid.status()).toBe("NoError");
    expect(result.solid.decompose().map(part => kernel.arena.track(part))).toHaveLength(1);
    for (const part of result.textParts) {
      expect(part.solid.status()).toBe("NoError");
      expect(part.solid.boundingBox().min[2]).toBeCloseTo(surfaceTextZ(project.spec), 6);
      expect(kernel.arena.track(part.solid.intersect(result.bodySolid)).volume()).toBeCloseTo(0, 6);
    }
    const bytes = writeThreeMf([
      { name: "Bin", mesh: extractPrintableMeshData(kernel, result.bodySolid) },
      ...result.textParts.map(part => ({
        name: `Text: ${part.label.text}`,
        mesh: extractPrintableMeshData(kernel, part.solid),
        material: { name: "Text", displayColor: project.spec.textColor as `#${string}` },
      })),
    ], { assemble: true });
    const model = strFromU8(unzipSync(bytes)["3D/3dmodel.model"]);
    for (const text of wording) expect(model).toContain(`name="Text: ${text}"`);
    expect(model.match(/<component /g)).toHaveLength(wording.length + 1);
    expect(model.match(/<item /g)).toHaveLength(1);
    expect(model).toContain(project.spec.textColor!.toUpperCase());
  });
}, 30000);
