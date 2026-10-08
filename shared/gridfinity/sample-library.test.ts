import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { libraryBackupSchema } from "./library";
import { parseProjectDoc } from "./project";
import { validateBinSpec, validateLayout } from "./validate";

const readSample = (path: string) => readFileSync(new URL(`../../samples/${path}`, import.meta.url), "utf8");
const library = libraryBackupSchema.parse(JSON.parse(readSample("pocketry-sample-library.json")));
const slugs = ["bessey-utility-knife", "gerber-multitool", "bessey-gerber"];
const docs = slugs.map(slug => parseProjectDoc(JSON.parse(readSample(`bessey-gerber/${slug}.pocketry.json`)))!);

describe("bundled Bessey and Gerber samples", () => {
  it("has unique library entries and the same editable documents as the downloads", () => {
    expect(new Set(library.projects.map(project => project.id)).size).toBe(library.projects.length);
    expect(new Set(library.projects.map(project => project.name)).size).toBe(library.projects.length);
    slugs.forEach((slug, index) => {
      const entries = library.projects.filter(project => project.id === `pocketry-sample-${slug}`);
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe(docs[index].name);
      expect(parseProjectDoc(entries[0].doc)).toEqual(docs[index]);
    });
    expect(docs[0].name).toBe("Bessey Utility Knife");
  });

  it.each(slugs)("opens %s without missing shapes, history, or layout warnings", slug => {
    const doc = docs[slugs.indexOf(slug)];
    expect(doc).not.toBeNull();
    expect(parseProjectDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    expect(validateBinSpec(doc.spec).issues).toEqual([]);
    expect(validateLayout(doc.spec, doc.cutouts, new Map(doc.shapes.map(shape => [shape.id, shape])), doc.fingerHoles)).toEqual([]);
    expect(doc.fingerHoles).toHaveLength(1);
    expect(doc.history).toBeUndefined();
  });

  it("preserves the tool outlines, scaling, depths, and rounding in both individual layouts", () => {
    const combined = docs[2];
    for (const doc of docs.slice(0, 2)) {
      expect(doc.cutouts).toHaveLength(1);
      expect(doc.shapes).toHaveLength(1);
      const pocket = doc.cutouts[0];
      const original = combined.cutouts.find(candidate => candidate.shapeId === pocket.shapeId)!;
      expect(doc.shapes[0]).toEqual(combined.shapes.find(shape => shape.id === pocket.shapeId));
      for (const field of ["scaleX", "scaleY", "depth", "clearanceMm", "cornerRoundMm", "topFilletMm", "bottomFilletMm"] as const) {
        expect(pocket[field]).toEqual(original[field]);
      }
      expect(doc.spec.heightUnits).toBe(combined.spec.heightUnits);
      expect(doc.spec.fillHeightPercent).toBe(combined.spec.fillHeightPercent);
    }
  });

  it("records hashes for every supplied model, project, preview, and photo", () => {
    type Asset = { file: string; sha256: string };
    type Design = { model: Asset; project: Asset; previews?: Asset[] };
    const manifest: { samples: (Design & { directory: string; variants?: Design[]; photos: Asset[] })[] } = JSON.parse(readSample("source-files.json"));
    const sample = manifest.samples.find(candidate => candidate.directory === "bessey-gerber")!;
    expect(sample).toBeDefined();
    const designs = [sample, ...sample.variants ?? []];
    expect(designs.map(design => design.project.file).sort()).toEqual(slugs.map(slug => `${slug}.pocketry.json`).sort());
    const assets = [...designs.flatMap(design => [design.model, design.project, ...design.previews ?? []]), ...sample.photos];
    for (const file of assets) {
      const bytes = readFileSync(new URL(`../../samples/bessey-gerber/${file.file}`, import.meta.url));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
    }
  });
});
