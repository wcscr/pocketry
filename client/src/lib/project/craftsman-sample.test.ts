import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { expect, it } from "vitest";
import { validateBinSpec, validateLayout } from "@shared/gridfinity/validate";
import catalog from "../../../../samples/pocketry-sample-library.json";
import provenance from "../../../../samples/source-files.json";
import { loadLabeledSample } from "./sample-labels.test-support";

const slug = "craftsman-tape-measure";
const readSample = (file: string) => readFileSync(new URL(`../../../../samples/${slug}/${file}`, import.meta.url));

it("retains the Craftsman body and belt-clip pockets without editing history or unused shapes", () => {
  const { project } = loadLabeledSample(slug);
  expect(project).not.toBeNull();
  expect(project.spec).toMatchObject({ gridX: 5, gridY: 5, gridPitch: "half", heightUnits: 4.5, lip: "standard" });
  expect(project.cutouts.map(pocket => pocket.depth)).toEqual([{ mode: "mm", value: 16 }, { mode: "mm", value: 22 }]);
  expect(project.cutouts.map(pocket => pocket.scaleX)).toEqual([1.02, 1.06]);
  expect(project.materials).toMatchObject({ binColor: "#bfbfbf", pocketFloorColor: "#000000", stackingRimColor: "#000000" });
  expect(project.history).toBeUndefined();
  expect(project.transformOrigins).toBeUndefined();
  expect(project.shapes.map(shape => shape.id).sort()).toEqual(project.cutouts.map(pocket => pocket.shapeId).sort());
  expect(validateBinSpec(project.spec).issues).toEqual([]);
  expect(validateLayout(project.spec, project.cutouts, new Map(project.shapes.map(shape => [shape.id, shape])), project.fingerHoles)
    .filter(issue => issue.severity === "error")).toEqual([]);
});

it("records the downloadable files and photo placeholders without claiming photo evidence", () => {
  const sample = provenance.samples.find(sample => sample.directory === slug)!;
  expect(sample).toBeDefined();
  expect(sample.photos).toEqual([]);
  for (const asset of [sample.project, sample.model, ...sample.previews ?? []]) {
    expect(createHash("sha256").update(readSample(asset.file)).digest("hex")).toBe(asset.sha256);
  }
  expect(provenance.library.projectCount).toBe(catalog.projects.length);
  const library = readFileSync(new URL("../../../../samples/pocketry-sample-library.json", import.meta.url));
  expect(createHash("sha256").update(library).digest("hex")).toBe(provenance.library.sha256);
  const files = unzipSync(readSample(`${slug}.3mf`));
  const model = strFromU8(files["3D/3dmodel.model"]);
  expect(model).toContain("Text: Craftsman 25&apos; Tape");
  expect(model.match(/<component /g)).toHaveLength(4);
  expect(model.match(/<item /g)).toHaveLength(1);
});
