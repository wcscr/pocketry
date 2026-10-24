import { z } from "zod";
import data from "./hardware-symbols.json";
import type { Outline, Ring } from "../geometry/types";

/** Bundled GFLabel artwork; provenance and BSD-3-Clause terms are in NOTICE. */
export type HardwareSymbolId = keyof typeof data.symbols;
export const HARDWARE_SYMBOL_IDS = Object.keys(data.symbols) as [HardwareSymbolId, ...HardwareSymbolId[]];
export const hardwareSymbolIdSchema = z.enum(HARDWARE_SYMBOL_IDS);
export const HARDWARE_SYMBOLS = HARDWARE_SYMBOL_IDS.map(id => ({ id, ...data.symbols[id] }));
export const HARDWARE_SYMBOL_SOURCE = data.source;

export function hardwareSymbol(id: HardwareSymbolId): { name: string; outline: Outline } {
  return data.symbols[id];
}

/** Rotate around the catalog's centered origin, preserving ring winding and holes. */
export function hardwareSymbolOutline(id: HardwareSymbolId, rotationDeg = 0): Outline {
  const { outline } = hardwareSymbol(id);
  if (rotationDeg === 0) return outline;
  const radians = rotationDeg * Math.PI / 180;
  const cos = Math.cos(radians), sin = Math.sin(radians);
  const rotate = (ring: Ring) => ring.map(p => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }));
  return outline.map(shape => ({ outer: rotate(shape.outer), holes: shape.holes.map(rotate) }));
}
