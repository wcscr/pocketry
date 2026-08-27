import { pointInRing, ringBounds, signedArea } from "@shared/geometry/rings";
import type { Outline, Point, Ring } from "@shared/geometry/types";
import { describe, expect, it } from "vitest";

import { cShapeRing, rectRing } from "@/lib/geometry/fixtures";
import { buildOutline } from "@/lib/geometry/outline";

import { generateDXF } from "./dxf";
import type { ExportScale } from "./scale";

/**
 * A DXF is a flat stream of (group code, value) pairs, one per line each. The
 * tests parse the writer's own output back rather than matching strings, so
 * they assert the file's structure the way a reader sees it.
 */
interface DxfPair {
  code: number;
  value: string;
}

function parsePairs(dxf: string): DxfPair[] {
  const lines = dxf.split("\n");
  // A trailing newline leaves one empty element, so an odd length means every
  // code found its value.
  expect(lines.length % 2).toBe(1);
  expect(lines[lines.length - 1]).toBe("");

  const pairs: DxfPair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    expect(Number.isInteger(code)).toBe(true);
    pairs.push({ code, value: lines[i + 1].trim() });
  }
  return pairs;
}

/** The value following a `9`-coded header variable name. */
function headerVariable(pairs: DxfPair[], name: string): DxfPair | undefined {
  const index = pairs.findIndex((pair) => pair.code === 9 && pair.value === name);
  return index === -1 ? undefined : pairs[index + 1];
}

interface DxfPolyline {
  layer: string;
  handle: string;
  /** `90`: the declared vertex count. */
  declaredVertices: number;
  /** `70`: bit 1 is "closed". */
  flags: number;
  subclasses: string[];
  ring: Ring;
}

/** Every LWPOLYLINE in the ENTITIES section. */
function polylines(pairs: DxfPair[]): DxfPolyline[] {
  const entities: DxfPolyline[] = [];
  let current: DxfPolyline | null = null;
  let pendingX: number | null = null;

  for (const pair of pairs) {
    if (pair.code === 0) {
      current = pair.value === "LWPOLYLINE" ? newPolyline() : null;
      if (current) entities.push(current);
      continue;
    }
    if (!current) continue;

    if (pair.code === 5) current.handle = pair.value;
    else if (pair.code === 8) current.layer = pair.value;
    else if (pair.code === 100) current.subclasses.push(pair.value);
    else if (pair.code === 90) current.declaredVertices = Number(pair.value);
    else if (pair.code === 70) current.flags = Number(pair.value);
    else if (pair.code === 10) pendingX = Number(pair.value);
    else if (pair.code === 20) {
      expect(pendingX).not.toBeNull();
      current.ring.push({ x: pendingX as number, y: Number(pair.value) });
      pendingX = null;
    }
  }
  return entities;
}

function newPolyline(): DxfPolyline {
  return {
    layer: "",
    handle: "",
    declaredVertices: -1,
    flags: -1,
    subclasses: [],
    ring: [],
  };
}

/** A 100×100 square with a 20×20 hole. */
function annulus(): Outline {
  return buildOutline([rectRing(0, 0, 100, 100), rectRing(40, 40, 20, 20)]);
}

const uncalibrated: ExportScale = { mmPerPx: null, imageHeight: 200 };
const calibrated: ExportScale = { mmPerPx: 0.5, imageHeight: 200 };

describe("generateDXF — header", () => {
  it("declares millimetres", () => {
    const pairs = parsePairs(generateDXF(annulus(), calibrated));
    const insunits = headerVariable(pairs, "$INSUNITS");

    expect(insunits).toEqual({ code: 70, value: "4" });
  });

  it("declares the AC1027 version the subclass markers imply", () => {
    const pairs = parsePairs(generateDXF(annulus(), calibrated));
    expect(headerVariable(pairs, "$ACADVER")).toEqual({ code: 1, value: "AC1027" });
  });

  it("writes no $DIMSCALE", () => {
    // Regression: the legacy writer emitted `$DIMSCALE` with `70` and `40`
    // codes for what is a single `40` real — malformed — and the scale is
    // already baked into the coordinates, so a drawing scale would double it.
    const dxf = generateDXF(annulus(), calibrated);
    expect(dxf).not.toContain("$DIMSCALE");
    expect(headerVariable(parsePairs(dxf), "$DIMSCALE")).toBeUndefined();
  });

  it("seeds handles above every handle it uses", () => {
    const pairs = parsePairs(generateDXF(annulus(), calibrated));
    const seed = Number.parseInt(headerVariable(pairs, "$HANDSEED")?.value ?? "", 16);
    const handles = polylines(pairs).map((entity) => Number.parseInt(entity.handle, 16));

    expect(handles).toHaveLength(2);
    expect(new Set(handles).size).toBe(handles.length);
    for (const handle of handles) expect(handle).toBeLessThan(seed);
  });

  it("says which units the coordinates are actually in", () => {
    expect(generateDXF(annulus(), calibrated)).toContain("Units: millimetres");
    // $INSUNITS says mm either way so the file opens; the comment is where an
    // uncalibrated export admits it is carrying pixels.
    expect(generateDXF(annulus(), uncalibrated)).toContain("Units: source pixels");
  });
});

describe("generateDXF — entities", () => {
  it("writes one closed LWPOLYLINE per ring", () => {
    const entities = polylines(parsePairs(generateDXF(annulus(), uncalibrated)));

    expect(entities).toHaveLength(2);
    for (const entity of entities) {
      expect(entity.flags & 1).toBe(1); // Closed.
      expect(entity.declaredVertices).toBe(entity.ring.length);
      expect(entity.ring).toHaveLength(4);
    }
  });

  it("writes one LWPOLYLINE per ring across several shapes", () => {
    const outline = [...annulus(), ...buildOutline([rectRing(200, 0, 30, 30)])];
    const entities = polylines(parsePairs(generateDXF(outline, uncalibrated)));
    expect(entities).toHaveLength(3);
  });

  it("carries the AcDbEntity / AcDbPolyline subclass markers", () => {
    // Regression: the legacy POLYLINE/VERTEX/SEQEND output had no subclass
    // markers, which strict AC1027 readers reject.
    const entities = polylines(parsePairs(generateDXF(annulus(), uncalibrated)));
    expect(entities).toHaveLength(2); // Or the loop below passes vacuously.
    for (const entity of entities) {
      expect(entity.subclasses).toEqual(["AcDbEntity", "AcDbPolyline"]);
    }
  });

  it("uses no old-style POLYLINE entities", () => {
    const dxf = generateDXF(annulus(), uncalibrated);
    const values = parsePairs(dxf)
      .filter((pair) => pair.code === 0)
      .map((pair) => pair.value);

    expect(values).not.toContain("POLYLINE");
    expect(values).not.toContain("VERTEX");
    expect(values).not.toContain("SEQEND");
  });

  it("puts a hole on the same layer as its shell", () => {
    // A layer-based CAM selection must pick up the pocket and its islands
    // together, or the island is cut away.
    const entities = polylines(parsePairs(generateDXF(annulus(), uncalibrated)));
    expect(entities.map((entity) => entity.layer)).toEqual(["0", "0"]);
  });

  it("never repeats the first vertex — the polyline is flagged closed", () => {
    const entities = polylines(parsePairs(generateDXF(annulus(), uncalibrated)));
    const ring = entities[0].ring;
    expect(ring[0]).not.toEqual(ring[ring.length - 1]);
  });

  it("emits a valid empty drawing for an empty outline", () => {
    const dxf = generateDXF([], uncalibrated);
    expect(polylines(parsePairs(dxf))).toHaveLength(0);
    expect(dxf.endsWith("  0\nEOF\n")).toBe(true);
  });

  it("writes no empty OBJECTS section", () => {
    // An OBJECTS section must contain at least the root dictionary; the legacy
    // writer emitted an empty one.
    expect(generateDXF(annulus(), uncalibrated)).not.toContain("OBJECTS");
  });
});

describe("generateDXF — coordinates", () => {
  it("flips Y about the image height", () => {
    // DXF is y-up and the tracer is y-down, so this is the one place the
    // exported drawing may differ from the on-screen outline.
    const outline = buildOutline([rectRing(5, 10, 15, 20)]);
    const [entity] = polylines(parsePairs(generateDXF(outline, uncalibrated)));

    expect(ringBounds(entity.ring)).toEqual({
      minX: 5,
      minY: 170, // 200 − 30
      maxX: 20,
      maxY: 190, // 200 − 10
    });
  });

  it("keeps shells positive and holes negative after the flip", () => {
    // `flipOutlineY` reverses each ring, so the winding convention survives.
    const [shell, hole] = polylines(parsePairs(generateDXF(annulus(), uncalibrated)));
    expect(signedArea(shell.ring)).toBeGreaterThan(0);
    expect(signedArea(hole.ring)).toBeLessThan(0);
  });

  it("scales to millimetres when calibrated", () => {
    const outline = buildOutline([rectRing(0, 0, 100, 100)]);
    const [entity] = polylines(parsePairs(generateDXF(outline, calibrated)));

    expect(ringBounds(entity.ring)).toEqual({
      minX: 0,
      minY: 50, // (200 − 100) × 0.5
      maxX: 50,
      maxY: 100,
    });
  });

  it("stays in pixels when uncalibrated", () => {
    const outline = buildOutline([rectRing(0, 0, 100, 100)]);
    const [entity] = polylines(parsePairs(generateDXF(outline, uncalibrated)));
    expect(ringBounds(entity.ring)?.maxX).toBe(100);
  });

  it("keeps a concave bay open", () => {
    // The C's bay must still be empty space after export; a hull or a filled
    // bay would show up as the bay centre landing inside the ring.
    const outline = buildOutline([cShapeRing()]);
    const [entity] = polylines(parsePairs(generateDXF(outline, uncalibrated)));

    const bayCentre: Point = { x: 80, y: 200 - 50 };
    const solidPoint: Point = { x: 20, y: 200 - 50 };
    expect(pointInRing(entity.ring, bayCentre)).toBe(false);
    expect(pointInRing(entity.ring, solidPoint)).toBe(true);
  });
});
