import { z } from "zod";

const point = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const ring = z.array(z.object({ point, in: point.optional(), out: point.optional(), smooth: z.boolean().optional() }).strict()).min(3).max(10_000);
/** Authoritative authored curves; polygon samples are a separate derived value. */
export const curveOutlineSchema = z.array(z.object({ outer: ring, holes: z.array(ring) }).strict()).max(1_000);
