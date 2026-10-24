import { z } from "zod";
import data from "./hardware-symbols.json";
import type { Outline } from "../geometry/types";

/** Bundled GFLabel artwork; provenance and BSD-3-Clause terms are in NOTICE. */
export type HardwareSymbolId = keyof typeof data.symbols;
export const HARDWARE_SYMBOL_IDS = Object.keys(data.symbols) as [HardwareSymbolId, ...HardwareSymbolId[]];
export const hardwareSymbolIdSchema = z.enum(HARDWARE_SYMBOL_IDS);
export const HARDWARE_SYMBOLS = HARDWARE_SYMBOL_IDS.map(id => ({ id, ...data.symbols[id] }));
export const HARDWARE_SYMBOL_SOURCE = data.source;

export function hardwareSymbol(id: HardwareSymbolId): { name: string; outline: Outline } {
  return data.symbols[id];
}
