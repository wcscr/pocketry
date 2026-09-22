import { isValidRing } from "@shared/geometry/rings";
import type { Outline, Ring } from "@shared/geometry/types";

import { iterateRings } from "@/lib/geometry/outline";

import { describeScale, toModelSpace, type ExportScale } from "./scale";

/**
 * DXF export (AC1027 / AutoCAD 2013).
 *
 * DXF is y-up, so this exporter flips — through `toModelSpace`, the same call
 * the STL writer makes, which is what stops the two formats disagreeing about
 * handedness.
 *
 * Emit a complete drawing scaffold, including symbol tables, model/paper-space
 * blocks and the root dictionary. An ENTITIES-only interchange file is suitable
 * for R12, but declaring AC1027 with that structure can import empty in Fusion.
 * See docs/dxf-compatibility.md for the reproduction and format references.
 */

/** Millimetres. Written unconditionally; see {@link unitsComment}. */
const INSUNITS_MILLIMETRES = 4;

/** 1 = metric, which selects the metric linetype/hatch pattern files. */
const MEASUREMENT_METRIC = 1;

/** First entity handle. Anything below 0x100 is conventionally reserved. */
const FIRST_HANDLE = 0x100;

/** Six decimals is ~1 nm at millimetre scale — far past any real tolerance. */
const COORDINATE_DECIMALS = 6;

/**
 * Every layer is `0`.
 *
 * A hole must sit on the same layer as its shell, or a CAM tool's
 * layer-based selection cuts the pocket without its islands. Define layer `0`
 * explicitly in TABLES so readers can discover it before importing entities.
 */
const LAYER = "0";

type WritePair = (code: number, value: string | number) => void;

/** Drawing records live below FIRST_HANDLE; geometry gets the remaining range. */
const HANDLES = {
  ltypeTable: "1", byBlock: "2", byLayer: "3", continuous: "4",
  layerTable: "5", layer: "6", styleTable: "7", style: "8",
  appidTable: "9", acad: "A", dimstyleTable: "B", dimstyle: "C",
  blockTable: "D", model: "E", paper: "F",
  modelBegin: "10", modelEnd: "11", paperBegin: "12", paperEnd: "13",
  root: "14", groups: "15", vportTable: "16", viewTable: "17", ucsTable: "18",
} as const;

/** A DXF drawing containing one closed `LWPOLYLINE` per ring. */
export function generateDXF(outline: Outline, scale: ExportScale): string {
  const model = toModelSpace(outline, scale);
  const rings: Ring[] = [];
  for (const { ring } of iterateRings(model)) {
    if (isValidRing(ring)) rings.push(ring);
  }
  return dxfFromModelRings(rings, unitsComment(scale));
}

/**
 * The writer proper, over rings already in model space (millimetres, y-up).
 * Split out so the bin-layout export — which is born in millimetres and must
 * not pass the px→mm boundary a second time — shares one DXF encoder.
 */
export function dxfFromModelRings(rings: readonly Ring[], comment: string): string {
  const lines: string[] = [];
  const pair = (code: number, value: string | number): void => {
    // Group codes are right-justified in three columns, as every DXF writer
    // since R12 has done; values are written unpadded, and readers trim.
    lines.push(String(code).padStart(3, " "));
    lines.push(String(value));
  };

  pair(999, "Pocketry outline export");
  pair(999, comment);

  pair(0, "SECTION");
  pair(2, "HEADER");
  pair(9, "$ACADVER");
  pair(1, "AC1027");
  pair(9, "$INSUNITS");
  pair(70, INSUNITS_MILLIMETRES);
  pair(9, "$MEASUREMENT");
  pair(70, MEASUREMENT_METRIC);
  pair(9, "$HANDSEED");
  // Must exceed every handle used below, or a reader may hand out a duplicate.
  pair(5, handleHex(FIRST_HANDLE + rings.length));
  pair(0, "ENDSEC");

  pair(0, "SECTION");
  pair(2, "CLASSES");
  pair(0, "ENDSEC");
  writeTables(pair);
  writeBlocks(pair);

  pair(0, "SECTION");
  pair(2, "ENTITIES");
  rings.forEach((ring, index) => {
    pair(0, "LWPOLYLINE");
    pair(5, handleHex(FIRST_HANDLE + index));
    pair(330, HANDLES.model);
    pair(100, "AcDbEntity");
    pair(8, LAYER);
    pair(100, "AcDbPolyline");
    pair(90, ring.length);
    // Bit 1: closed. The ring's closing edge is implicit in our model too, so
    // the first point is never repeated.
    pair(70, 1);
    for (const point of ring) {
      pair(10, point.x.toFixed(COORDINATE_DECIMALS));
      pair(20, point.y.toFixed(COORDINATE_DECIMALS));
    }
  });
  pair(0, "ENDSEC");

  writeObjects(pair);
  pair(0, "EOF");
  return `${lines.join("\n")}\n`;
}

/** Standard symbol tables required by the modern DXF drawing structure. */
function writeTables(pair: WritePair): void {
  const table = (name: string, handle: string, count: number): void => {
    pair(0, "TABLE");
    pair(2, name);
    pair(5, handle);
    pair(330, "0");
    pair(100, "AcDbSymbolTable");
    pair(70, count);
    if (name === "DIMSTYLE") pair(100, "AcDbDimStyleTable");
  };
  const record = (
    type: string, handle: string, owner: string, subclass: string, name: string,
  ): void => {
    pair(0, type);
    // DIMSTYLE is the one symbol record whose handle uses group 105.
    pair(type === "DIMSTYLE" ? 105 : 5, handle);
    pair(330, owner);
    pair(100, "AcDbSymbolTableRecord");
    pair(100, subclass);
    pair(2, name);
    pair(70, 0);
  };

  pair(0, "SECTION");
  pair(2, "TABLES");
  table("VPORT", HANDLES.vportTable, 0);
  pair(0, "ENDTAB");

  table("LTYPE", HANDLES.ltypeTable, 3);
  for (const [name, handle] of [
    ["ByBlock", HANDLES.byBlock],
    ["ByLayer", HANDLES.byLayer],
    ["CONTINUOUS", HANDLES.continuous],
  ]) {
    record("LTYPE", handle, HANDLES.ltypeTable, "AcDbLinetypeTableRecord", name);
    pair(3, "");
    pair(72, 65);
    pair(73, 0);
    pair(40, 0);
  }
  pair(0, "ENDTAB");

  table("LAYER", HANDLES.layerTable, 1);
  record("LAYER", HANDLES.layer, HANDLES.layerTable, "AcDbLayerTableRecord", LAYER);
  pair(62, 7);
  pair(6, "CONTINUOUS");
  pair(370, -3); // Default lineweight.
  // Fusion rejects a modern layer record without group 390. A null handle
  // explicitly means this outline layer has no named plot-style object.
  pair(390, "0");
  pair(0, "ENDTAB");

  table("STYLE", HANDLES.styleTable, 1);
  record("STYLE", HANDLES.style, HANDLES.styleTable, "AcDbTextStyleTableRecord", "Standard");
  pair(40, 0);
  pair(41, 1);
  pair(50, 0);
  pair(71, 0);
  pair(42, 2.5);
  pair(3, "txt");
  pair(4, "");
  pair(0, "ENDTAB");

  table("VIEW", HANDLES.viewTable, 0);
  pair(0, "ENDTAB");
  table("UCS", HANDLES.ucsTable, 0);
  pair(0, "ENDTAB");

  table("APPID", HANDLES.appidTable, 1);
  record("APPID", HANDLES.acad, HANDLES.appidTable, "AcDbRegAppTableRecord", "ACAD");
  pair(0, "ENDTAB");

  table("DIMSTYLE", HANDLES.dimstyleTable, 1);
  record("DIMSTYLE", HANDLES.dimstyle, HANDLES.dimstyleTable, "AcDbDimStyleTableRecord", "Standard");
  pair(340, HANDLES.style);
  pair(0, "ENDTAB");

  table("BLOCK_RECORD", HANDLES.blockTable, 2);
  for (const [name, handle] of [["*Model_Space", HANDLES.model], ["*Paper_Space", HANDLES.paper]]) {
    record("BLOCK_RECORD", handle, HANDLES.blockTable, "AcDbBlockTableRecord", name);
    pair(280, 1);
    pair(281, 0);
  }
  pair(0, "ENDTAB");
  pair(0, "ENDSEC");
}

/** Space definitions are empty: the model geometry belongs in ENTITIES. */
function writeBlocks(pair: WritePair): void {
  pair(0, "SECTION");
  pair(2, "BLOCKS");
  for (const [name, owner, begin, end] of [
    ["*Model_Space", HANDLES.model, HANDLES.modelBegin, HANDLES.modelEnd],
    ["*Paper_Space", HANDLES.paper, HANDLES.paperBegin, HANDLES.paperEnd],
  ]) {
    pair(0, "BLOCK");
    pair(5, begin);
    pair(330, owner);
    pair(100, "AcDbEntity");
    pair(8, LAYER);
    pair(100, "AcDbBlockBegin");
    pair(2, name);
    pair(70, 0);
    pair(10, 0);
    pair(20, 0);
    pair(30, 0);
    pair(3, name);
    pair(1, "");
    pair(0, "ENDBLK");
    pair(5, end);
    pair(330, owner);
    pair(100, "AcDbEntity");
    pair(8, LAYER);
    pair(100, "AcDbBlockEnd");
  }
  pair(0, "ENDSEC");
}

/** Root named-object dictionary and its (empty) ACAD_GROUP dictionary. */
function writeObjects(pair: WritePair): void {
  pair(0, "SECTION");
  pair(2, "OBJECTS");
  pair(0, "DICTIONARY");
  pair(5, HANDLES.root);
  pair(330, "0");
  pair(100, "AcDbDictionary");
  pair(281, 1);
  pair(3, "ACAD_GROUP");
  pair(350, HANDLES.groups);
  pair(0, "DICTIONARY");
  pair(5, HANDLES.groups);
  pair(330, HANDLES.root);
  pair(100, "AcDbDictionary");
  pair(281, 1);
  pair(0, "ENDSEC");
}

/**
 * The `999` comment that says what the numbers actually mean.
 *
 * `$INSUNITS` is 4 (mm) either way, because a CAD reader needs *some* unit and
 * "unitless" imports at an arbitrary size. When there is no calibration the
 * coordinates are still raw pixels, so that declaration is a convenient lie —
 * hence saying so in the file rather than only in the UI.
 */
function unitsComment(scale: ExportScale): string {
  return scale.mmPerPx === null
    ? "Units: source pixels (no ruler calibration) — $INSUNITS declares mm so the drawing opens, but 1 unit = 1 pixel"
    : `Units: millimetres — ${describeScale(scale)}`;
}

function handleHex(handle: number): string {
  return handle.toString(16).toUpperCase();
}
