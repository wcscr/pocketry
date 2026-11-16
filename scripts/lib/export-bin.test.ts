import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, parseProjectDoc, projectDocSchema, serializeProjectDoc } from "../../shared/gridfinity/project";
import { parseBinSpec } from "../../shared/gridfinity/types";
import { DEFAULT_BIN_MATERIALS } from "../../shared/gridfinity/materials";
import { exportProject, readProjectFile, readSvgBin, readSvgFile } from "./export-bin";

const directories: string[] = [];
async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "pocketry-export-"));
  directories.push(directory);
  return directory;
}
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="72mm" height="32mm" viewBox="0 0 72 32"><rect x="4" y="4" width="64" height="24" rx="2"/></svg>';

describe("shared headless export", () => {
  it("gives different artwork and calibration distinct immutable shape ids", async () => {
    const directory = await temporaryDirectory();
    const first = join(directory, "first.svg"), second = join(directory, "second.svg");
    await writeFile(first, svg);
    await writeFile(second, svg.replace('width="64"', 'width="54"'));
    const options = { objectDepthMm: 9, fingerAccess: { placement: "none" } };
    const a = await readSvgBin(first, options);
    const b = await readSvgBin(second, options);
    const calibrated = await readSvgBin(first, options, { widthMm: 50 });
    expect(a.project.shapes[0].id).not.toBe(b.project.shapes[0].id);
    expect(a.project.shapes[0].id).not.toBe(calibrated.project.shapes[0].id);
    expect((await readSvgBin(first, options)).project.shapes[0].id).toBe(a.project.shapes[0].id);
  });

  it("exports real SVG pockets to valid binary STL, millimeter 3MF and an editable project", async () => {
    const directory = await temporaryDirectory();
    const input = join(directory, "tool.svg");
    await writeFile(input, svg);
    const plan = await readSvgBin(input, { objectDepthMm: 9, objectHeightMm: 16, fingerAccess: { placement: "sides", diameterMm: 12 } });
    const output = join(directory, "models");
    const singleColor = { ...plan.project, materials: { ...DEFAULT_BIN_MATERIALS, colorPocketFloors: false, colorStackingRim: false } };
    const result = await exportProject(singleColor, output, "tool-pocket", { saveProject: true });
    expect(result.volumeCm3).toBeGreaterThan(0);
    expect(result.triangles).toBeGreaterThan(100);
    const stl = await readFile(result.paths.stl);
    const count = stl.readUInt32LE(80);
    expect(count).toBe(result.triangles);
    expect(stl.byteLength).toBe(84 + 50 * count);
    const bounds = [[Infinity, -Infinity], [Infinity, -Infinity], [Infinity, -Infinity]];
    for (let facet = 0; facet < count; facet++) for (let vertex = 0; vertex < 3; vertex++) for (let axis = 0; axis < 3; axis++) {
      const coordinate = stl.readFloatLE(84 + facet * 50 + 12 + vertex * 12 + axis * 4);
      expect(Number.isFinite(coordinate)).toBe(true);
      bounds[axis][0] = Math.min(bounds[axis][0], coordinate);
      bounds[axis][1] = Math.max(bounds[axis][1], coordinate);
    }
    expect(bounds[0][1] - bounds[0][0]).toBeCloseTo(result.dimensions.widthMm, 4);
    expect(bounds[1][1] - bounds[1][0]).toBeCloseTo(result.dimensions.lengthMm, 4);
    expect(bounds[2][0]).toBe(0);
    expect(bounds[2][1]).toBeCloseTo(result.dimensions.totalHeightMm, 4);
    const archive = unzipSync(await readFile(result.paths.threeMf));
    const model = strFromU8(archive["3D/3dmodel.model"]);
    expect(model).toContain('unit="millimeter"');
    expect(model.match(/<triangle /g)).toHaveLength(count);
    expect(await readProjectFile(result.paths.project!)).toEqual(JSON.parse(JSON.stringify(singleColor)));
    expect(parseProjectDoc(JSON.parse(await readFile(result.paths.project!, "utf8")))).not.toBeNull();
  }, 20_000);

  it("blocks invalid geometry and path-like output names before creating files", async () => {
    const directory = await temporaryDirectory();
    const input = join(directory, "tool.svg");
    await writeFile(input, svg);
    const plan = await readSvgBin(input, { objectDepthMm: 9, fingerAccess: { placement: "none" } });
    const output = join(directory, "models");
    await expect(exportProject(plan.project, output, "../escape")).rejects.toThrow("filename stem");
    const invalid = { ...plan.project, cutouts: plan.project.cutouts.map(pocket => ({ ...pocket, position: { x: 1000, y: 0 } })) };
    await expect(exportProject(invalid, output)).rejects.toThrow();
    expect(await readdir(directory)).toEqual(["tool.svg"]);
  });

  it("exports a legacy empty bin with its standard profile and no pockets", async () => {
    const directory = await temporaryDirectory();
    const project = projectDocSchema.parse({ schemaVersion: PROJECT_SCHEMA_VERSION,
      spec: parseBinSpec({ gridX: 2, gridY: 3, heightUnits: 6, fill: "none" }), shapes: [], cutouts: [], fingerHoles: [],
      // The materials scripts/export-bin.ts uses for empty bins.
      materials: { ...DEFAULT_BIN_MATERIALS, colorPocketFloors: false, colorStackingRim: false } });
    const result = await exportProject(project, directory, "bin-2x3x6");
    expect(result.dimensions).toMatchObject({ widthMm: 83.5, lengthMm: 125.5, heightToRimMm: 42 });
    expect(result.paths.project).toBeUndefined();
    expect((await readdir(directory)).sort()).toEqual(["bin-2x3x6.3mf", "bin-2x3x6.stl"]);
    // Same names as the editor's single-color export.
    const model = strFromU8(unzipSync(await readFile(result.paths.threeMf))["3D/3dmodel.model"]);
    expect(model).toContain('<metadata name="Title">Pocketry Gridfinity bin 2x3x6</metadata>');
    expect(model).toContain('name="Gridfinity bin 2x3x6"');
    expect((await readFile(result.paths.stl)).subarray(0, 80).toString().replace(/\0+$/, "")).toBe("Pocketry Gridfinity bin 2x3x6");
  }, 20_000);

  it("bounds local inputs and rejects directories and unknown project schemas", async () => {
    const directory = await temporaryDirectory();
    const large = join(directory, "large.svg");
    await writeFile(large, Buffer.alloc(2 * 1024 * 1024 + 1));
    await expect(readSvgFile(large)).rejects.toThrow("2 MB");
    await expect(readSvgFile(directory)).rejects.toThrow("Expected a file");
    const future = join(directory, "future.json");
    await writeFile(future, '{"schemaVersion":999}');
    await expect(readProjectFile(future)).rejects.toThrow("unsupported");
  });

  it("preserves saved material colors and explicit text in a multipart project export", async () => {
    const directory = await temporaryDirectory();
    const project = projectDocSchema.parse({ schemaVersion: PROJECT_SCHEMA_VERSION,
      spec: parseBinSpec({ gridX: 1, gridY: 1, heightUnits: 4, fill: "solid", textColor: "#ff0000",
        surfaceTexts: [{ id: "label", text: "A", position: { x: 0, y: 0 }, sizeMm: 4 }] }),
      shapes: [], cutouts: [], fingerHoles: [], materials: { ...DEFAULT_BIN_MATERIALS,
        binColor: "#ffffff", stackingRimColor: "#00ff00", colorPocketFloors: false } });
    const result = await exportProject(project, directory, "colored-design", { saveProject: true });
    const model = strFromU8(unzipSync(await readFile(result.paths.threeMf))["3D/3dmodel.model"]);
    expect(model).toContain("#ffffff".toUpperCase());
    expect(model).toContain("#00ff00".toUpperCase());
    expect(model).toContain("#ff0000".toUpperCase());
    expect(model.match(/<object /g)?.length).toBeGreaterThanOrEqual(4); // body/rim/text and assembly
    expect(await readProjectFile(result.paths.project!)).toEqual(project);
    expect((await readFile(result.paths.stl)).readUInt32LE(80)).toBe(result.triangles);
  }, 20_000);

  it("inherits the body color for text when the saved rim color region is disabled", async () => {
    const directory = await temporaryDirectory();
    const project = projectDocSchema.parse({ schemaVersion: PROJECT_SCHEMA_VERSION,
      spec: parseBinSpec({ gridX: 1, gridY: 1, heightUnits: 4, fill: "solid", textColor: null,
        surfaceTexts: [{ id: "inherited-label", text: "A", position: { x: 0, y: 0 }, sizeMm: 4 }] }),
      shapes: [], cutouts: [], fingerHoles: [], materials: { ...DEFAULT_BIN_MATERIALS,
        binColor: "#ffffff", stackingRimColor: "#000000", colorPocketFloors: false, colorStackingRim: false } });
    const result = await exportProject(project, directory, "body-colored-text", { saveProject: true });
    const model = strFromU8(unzipSync(await readFile(result.paths.threeMf))["3D/3dmodel.model"]);
    expect(model.includes('name="A"')).toBe(true);
    const colors = Array.from(model.matchAll(/<m:color color="(#[^"]+)"\/>/g), match => match[1]);
    expect(colors).toEqual(["#FFFFFFFF"]);
    expect(await readProjectFile(result.paths.project!)).toEqual(project);
  }, 20_000);
});



it("round-trips portable local-font sources and saved divider colors through disk export", async () => {
  const directory = await temporaryDirectory();
  const project = projectDocSchema.parse({ schemaVersion: PROJECT_SCHEMA_VERSION,
    spec: parseBinSpec({ gridX: 1, gridY: 1, heightUnits: 3, fill: "solid",
      surfaceTexts: [{ id: "portable", text: "A", position: { x: 0, y: 0 },
        font: { kind: "local", name: "Saved Sans", resolution: 1000,
          source: { data: "YWJjZA==", byteLength: 4 },
          glyphs: { A: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 500 z" } } } }] }),
    shapes: [], cutouts: [], fingerHoles: [],
    materials: { ...DEFAULT_BIN_MATERIALS, colorDividerTops: true } });
  const input = join(directory, "portable.pocketry.json");
  await writeFile(input, JSON.stringify(serializeProjectDoc(project)));
  const result = await exportProject(await readProjectFile(input), directory, "portable-export", { saveProject: true });
  expect(await readProjectFile(result.paths.project!)).toEqual(project);
  expect(JSON.parse(await readFile(result.paths.project!, "utf8")).fontSources)
    .toEqual({ "font-1": { data: "YWJjZA==", byteLength: 4 } });
  expect(strFromU8(unzipSync(await readFile(result.paths.threeMf))["3D/3dmodel.model"]))
    .toContain('name="A"');
}, 20_000);
