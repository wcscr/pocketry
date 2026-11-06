import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { writeThreeMf, type ThreeMfObject } from "./threemf";

const FACETS_PATH = "Metadata/Slic3r_facets_annotation.json";
const OPTIONS = { combineObjects: true, prusaPaint: true };
const mesh = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };
const colored = (color: `#${string}`): ThreeMfObject => ({ name: color, mesh, material: { name: color, displayColor: color } });
const palette = (count: number) => Array.from({ length: count }, (_, index) => colored(`#${index.toString(16).padStart(6, "0")}`));
const xml = (entries: Record<string, Uint8Array>) => strFromU8(entries["3D/3dmodel.model"]);

describe("Prusa 3MF painting", () => {
  it("keeps standard colors and exact geometry alongside both Prusa paint representations", () => {
    const objects = [colored("#35393c"), { name: "Uncolored", mesh }, colored("#eee8da"), colored("#35393C")];
    const bytes = writeThreeMf(objects, OPTIONS);
    const entries = unzipSync(bytes);
    const model = xml(entries);
    expect(writeThreeMf(objects, OPTIONS)).toEqual(bytes);
    expect(Object.keys(entries).sort()).toEqual(["3D/3dmodel.model", FACETS_PATH, "[Content_Types].xml", "_rels/.rels"]);
    expect(strFromU8(entries["[Content_Types].xml"])).toContain('Extension="json" ContentType="application/json"');
    expect(model).toContain('<metadata name="Application">Pocketry</metadata>');
    expect(model).toContain('xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06"');
    expect(model).toContain('<metadata name="slic3rpe:MmPaintingVersion">1</metadata>');
    expect(model.match(/<m:color /g)).toHaveLength(2);
    expect(model).toContain('pid="1" p1="0" slic3rpe:mmu_segmentation="4"');
    expect(model).toContain('pid="1" p1="1" slic3rpe:mmu_segmentation="8"');
    expect(model).toContain('<triangle v1="3" v2="4" v3="5"/>');
    expect(JSON.parse(strFromU8(entries[FACETS_PATH]))).toEqual([{
      id: 2, mmSegmentationFacetsVersion: 1,
      mmSegmentationFacets: [
        { triangle: 0, dividing: "4" },
        { triangle: 2, dividing: "8" },
        { triangle: 3, dividing: "4" },
      ],
    }]);
    const standard = xml(unzipSync(writeThreeMf(objects, { combineObjects: true })));
    expect(model.match(/<vertex [^>]+/g)).toEqual(standard.match(/<vertex [^>]+/g));
    expect([...model.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].map(m => m.slice(1)))
      .toEqual([...standard.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].map(m => m.slice(1)));
  });

  it.each<[number, string, number]>([
    [1, "4", 1], [2, "8", 1], [3, "0C", 1], [16, "DC", 1], [17, "00EC", 2], [255, "EEEC", 2],
  ])("writes filament %i using the correct whole-face encoding and version", (count, code, version) => {
    const entries = unzipSync(writeThreeMf(palette(count), OPTIONS));
    const facets = JSON.parse(strFromU8(entries[FACETS_PATH]));
    expect(facets[0].mmSegmentationFacetsVersion).toBe(version);
    expect(facets[0].mmSegmentationFacets).toHaveLength(count);
    expect(facets[0].mmSegmentationFacets.at(-1)).toEqual({ triangle: count - 1, dividing: code });
    expect(xml(entries)).toContain(`slic3rpe:mmu_segmentation="${code}"`);
    expect(xml(entries)).toContain(`<metadata name="slic3rpe:MmPaintingVersion">${version}</metadata>`);
  });

  it("omits painting for entirely uncolored input and keeps existing exports unchanged", () => {
    const plain = unzipSync(writeThreeMf([{ name: "Plain", mesh }], OPTIONS));
    expect(plain[FACETS_PATH]).toBeUndefined();
    expect(xml(plain)).not.toContain("slic3rpe");
    expect(strFromU8(plain["[Content_Types].xml"])).not.toContain('Extension="json"');
    const objects = [colored("#35393c"), colored("#eee8da")];
    for (const options of [{}, { assemble: true }, { combineObjects: true }]) {
      expect(writeThreeMf(objects, { ...options, prusaPaint: false })).toEqual(writeThreeMf(objects, options));
      expect(unzipSync(writeThreeMf(objects, options))[FACETS_PATH]).toBeUndefined();
    }
  });

  it("rejects unsupported painting requests without limiting regular exports", () => {
    expect(() => writeThreeMf([colored("#ffffff")], { prusaPaint: true })).toThrow("requires combined objects");
    expect(() => writeThreeMf(palette(256), OPTIONS)).toThrow("at most 255 distinct colors");
    expect(() => writeThreeMf(palette(256), { assemble: true })).not.toThrow();
    expect(() => writeThreeMf(Array.from({ length: 256 }, () => colored("#abcdef")), OPTIONS)).not.toThrow();
  });
});

describe("Prusa color-preview project", () => {
  const preview = { ...OPTIONS, prusaColorPreview: true };
  const legacyPath = "Metadata/Slic3r_PE.config";
  const projectPath = "Metadata/PrusaSlicer3_project.json";

  it("sets matching slots and RGB colors in both versions without changing geometry or painting", () => {
    const objects = [colored("#bfbfbf"), { name: "Default", mesh }, colored("#000000"), colored("#BFBFBF")];
    const entries = unzipSync(writeThreeMf(objects, preview));
    const base = unzipSync(writeThreeMf(objects, OPTIONS));
    expect(entries["3D/3dmodel.model"]).toEqual(base["3D/3dmodel.model"]);
    expect(entries[FACETS_PATH]).toEqual(base[FACETS_PATH]);
    expect(writeThreeMf(objects, preview)).toEqual(writeThreeMf(objects, preview));
    const legacy = Object.fromEntries(strFromU8(entries[legacyPath]).split("\n")
      .filter(line => line.includes(" = ")).map(line => line.slice(2).split(" = ")));
    expect(legacy.filament_colour).toBe("#BFBFBF;#000000");
    expect(legacy.extruder_colour).toBe(legacy.filament_colour);
    expect(legacy.nozzle_diameter.split(",")).toHaveLength(2);
    expect(legacy.extruder_offset.split(",")).toHaveLength(2);
    expect(legacy.printer_settings_id).toContain("choose your printer");
    const container = JSON.parse(strFromU8(entries[projectPath])).config_containers[0];
    expect(container.preset.hw_config.tool_count).toBe(2);
    expect(container.preset.hw_config.config_short_name).toBe(container.preset.hw_config.config_name);
    expect(Object.keys(container.preset.hw_config.tools)).toEqual(["0", "1"]);
    expect(container.preset.materials).toHaveLength(2);
    expect(container.preset.tools).toHaveLength(2);
    expect(container.configuration.filament_settings.filament_colour).toEqual(["#BFBFBF", "#000000"]);
    expect(container.configuration.project_settings.extruder_colour).toEqual(["#BFBFBF", "#000000"]);
    expect(container.configuration.printer_settings.extruder_offset).toEqual([[0, 0], [0, 0]]);
    expect(strFromU8(entries["[Content_Types].xml"])).toContain('Extension="config" ContentType="text/plain"');
  });

  it.each([1, 17, 255])("keeps all %i display slots aligned with paint slots", count => {
    const entries = unzipSync(writeThreeMf(palette(count), preview));
    const container = JSON.parse(strFromU8(entries[projectPath])).config_containers[0];
    expect(container.preset.hw_config.tool_count).toBe(count);
    expect(container.preset.materials).toHaveLength(count);
    expect(container.configuration.filament_settings.filament_colour).toEqual(palette(count).map(object => object.material!.displayColor.toUpperCase()));
  });

  it("fits the preview bed around original coordinates and omits projects with no colors", () => {
    const wide = { ...colored("#ffffff"), mesh: { ...mesh, positions: [-230, 0, 0, 1, 410, 0, 0, 1, 0] } };
    const entries = unzipSync(writeThreeMf([wide], preview));
    const container = JSON.parse(strFromU8(entries[projectPath])).config_containers[0];
    expect(container.configuration.printer_settings.bed_shape).toEqual([[-430, -430], [430, -430], [430, 430], [-430, 430]]);
    const plain = unzipSync(writeThreeMf([{ name: "Plain", mesh }], preview));
    expect(plain[projectPath]).toBeUndefined();
    expect(plain[legacyPath]).toBeUndefined();
    expect(() => writeThreeMf([wide], { combineObjects: true, prusaColorPreview: true })).toThrow("requires combined objects and painting");
  });
});
