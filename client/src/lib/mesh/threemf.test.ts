import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel } from "@/lib/manifold/runtime";

import { extractMeshData } from "./mesh-data";
import { writeThreeMf, type ThreeMfObject } from "./threemf";

let arena: Arena;
let kernel: Kernel;

beforeAll(async () => {
  const wasm = await loadManifold();
  arena = new Arena();
  kernel = createKernel(wasm, arena);
});

afterAll(() => {
  arena.dispose();
});

function unzipModel(file: Uint8Array): { entries: string[]; model: string } {
  const entries = unzipSync(file);
  return {
    entries: Object.keys(entries).sort(),
    model: strFromU8(entries["3D/3dmodel.model"]),
  };
}

const TRIANGLE: ThreeMfObject = {
  name: "tri",
  mesh: {
    positions: [0, 0, 41.75, 0.5, 1.23456, 2, 0, 0, 1],
    indices: [0, 1, 2],
  },
};

describe("writeThreeMf", () => {
  it("emits a valid OPC package with the three required entries", () => {
    const { entries, model } = unzipModel(writeThreeMf([TRIANGLE]));
    expect(entries).toEqual(["3D/3dmodel.model", "[Content_Types].xml", "_rels/.rels"]);
    expect(model).toContain('unit="millimeter"');
    expect(model).toContain('xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"');
    expect(model).toContain('<metadata name="Application">Pocketry</metadata>');
  });

  it("round-trips a manifold mesh with matching counts", () => {
    const cube = arena.track(kernel.Manifold.cube([2, 3, 4], false));
    const mesh = extractMeshData(kernel, cube);
    const { model } = unzipModel(
      writeThreeMf([{ name: "cube", mesh }], { title: "Test cube" }),
    );

    expect(model.match(/<vertex /g)).toHaveLength(8);
    expect(model.match(/<triangle /g)).toHaveLength(12);
    expect(model).toContain('<metadata name="Title">Test cube</metadata>');
    expect(model.match(/<item objectid="1"\/>/g)).toHaveLength(1);
  });

  it("writes compact 1e-4 mm coordinates", () => {
    const { model } = unzipModel(writeThreeMf([TRIANGLE]));
    expect(model).toContain('<vertex x="0" y="0" z="41.75"/>');
    expect(model).toContain('<vertex x="0.5" y="1.2346" z="2"/>');
  });

  it("emits one object and one build item per part (the multicolor hook)", () => {
    const { model } = unzipModel(
      writeThreeMf([
        TRIANGLE,
        { name: "second", mesh: TRIANGLE.mesh },
      ]),
    );
    expect(model.match(/<object /g)).toHaveLength(2);
    expect(model).toContain('<object id="1" type="model" name="tri">');
    expect(model).toContain('<object id="2" type="model" name="second">');
    expect(model.match(/<item objectid=/g)).toHaveLength(2);
  });

  it("assigns materials and assembles printable parts into one model", () => {
    const { model } = unzipModel(
      writeThreeMf(
        [
          {
            ...TRIANGLE,
            name: "Bin body",
            material: { name: "Orange PLA", displayColor: "#e07a3f" },
          },
          {
            ...TRIANGLE,
            name: "Pocket floors",
            material: { name: "Blue PLA", displayColor: "#2563eb" },
          },
        ],
        { title: "Two-color bin", assemble: true },
      ),
    );

    expect(model).toContain('<basematerials id="1">');
    expect(model).toContain('<base name="Orange PLA" displaycolor="#E07A3F"/>');
    expect(model).toContain('<base name="Blue PLA" displaycolor="#2563EB"/>');
    expect(model).toContain(
      '<object id="2" type="model" name="Bin body" pid="1" pindex="0">',
    );
    expect(model).toContain(
      '<object id="3" type="model" name="Pocket floors" pid="1" pindex="1">',
    );
    expect(model).toContain('<object id="4" type="model" name="Two-color bin">');
    expect(model).toContain('<component objectid="2"/>');
    expect(model).toContain('<component objectid="3"/>');
    expect(model.match(/<item objectid=/g)).toHaveLength(1);
    expect(model).toContain('<item objectid="4"/>');
  });

  it("escapes XML in names and titles", () => {
    const { model } = unzipModel(
      writeThreeMf([{ name: 'a<b>&"c"', mesh: TRIANGLE.mesh }], {
        title: "2×3 <bin> & lid",
      }),
    );
    expect(model).toContain('name="a&lt;b&gt;&amp;&quot;c&quot;"');
    expect(model).toContain("2×3 &lt;bin&gt; &amp; lid");
  });

  it("is deterministic byte for byte", () => {
    const first = writeThreeMf([TRIANGLE]);
    const second = writeThreeMf([TRIANGLE]);
    expect(first.length).toBe(second.length);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it("rejects malformed meshes", () => {
    expect(() => writeThreeMf([])).toThrow(/at least one/);
    expect(() =>
      writeThreeMf([{ name: "bad", mesh: { positions: [0, 0], indices: [0, 1, 2] } }]),
    ).toThrow(/xyz triples/);
    expect(() =>
      writeThreeMf([{ name: "bad", mesh: { positions: [0, 0, 0], indices: [0, 1] } }]),
    ).toThrow(/triangles/);
    expect(() =>
      writeThreeMf([{ name: "bad", mesh: { positions: [0, 0, 0], indices: [0, 0, 7] } }]),
    ).toThrow(/out of range/);
    expect(() =>
      writeThreeMf([
        { name: "bad", mesh: { positions: [0, 0, Number.NaN], indices: [0, 0, 0] } },
      ]),
    ).toThrow(/non-finite/);
    expect(() =>
      writeThreeMf([
        {
          ...TRIANGLE,
          material: {
            name: "bad",
            displayColor: "blue" as `#${string}`,
          },
        },
      ]),
    ).toThrow(/#RRGGBB/);
  });
});
