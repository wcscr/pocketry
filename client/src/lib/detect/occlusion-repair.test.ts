import { expect, it } from "vitest";
import { repairOccludedOutline } from "./occlusion-repair";
import { pointInRing } from "@shared/geometry/rings";
import type { Outline, Point, Ring } from "@shared/geometry/types";

it.each([0, .7, 2.1, 4.5])("repairs a short hidden round edge without changing visible evidence, angle %s", angle => {
  const footprint: Ring = [{ x: 140, y: 115 }, { x: 175, y: 115 }, { x: 175, y: 143 }, { x: 140, y: 143 }];
  const ring = Array.from({ length: 360 }, (_, i) => ({ x: 100 + 60 * Math.cos(i * Math.PI / 180), y: 100 + 60 * Math.sin(i * Math.PI / 180) }));
  const hidden = ring.flatMap((p, i) => pointInRing(footprint, p) ? [i] : []);
  const a = ring[hidden[0] - 1], b = ring[hidden.at(-1)! + 1];
  hidden.forEach((index, i) => { const t = (i + 1) / (hidden.length + 1); ring[index] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; });
  const transform = (p: Point): Point => ({ x: (p.x * Math.cos(angle) - p.y * Math.sin(angle)) * .75 + 200,
    y: (p.x * Math.sin(angle) + p.y * Math.cos(angle)) * .75 + 100 });
  const source: Outline = [{ outer: ring.map(transform), holes: [] }], mask = footprint.map(transform);
  const result = repairOccludedOutline(source, [mask], .75);
  expect(result).not.toBe(source);
  for (const p of source[0].outer.filter(p => !pointInRing(mask, p))) expect(result[0].outer).toContainEqual(p);
  const center = transform({ x: 100, y: 100 });
  const error = (p: Point) => Math.abs(Math.hypot(p.x - center.x, p.y - center.y) - 45);
  const before = Math.max(...source[0].outer.map(error)), after = Math.max(...result[0].outer.map(error));
  expect(after).toBeLessThan(before * .3);
});

it("does not guess across a long missing edge or several crossings", () => {
  const ring = Array.from({ length: 200 }, (_, i) => ({ x: 100 + 60 * Math.cos(i * Math.PI / 100), y: 100 + 60 * Math.sin(i * Math.PI / 100) }));
  const source: Outline = [{ outer: ring, holes: [] }];
  expect(repairOccludedOutline(source, [[{ x: 90, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 200 }, { x: 90, y: 200 }]], 1)).toBe(source);
  expect(repairOccludedOutline(source, [[{ x: 0, y: 90 }, { x: 200, y: 90 }, { x: 200, y: 110 }, { x: 0, y: 110 }]], 1)).toBe(source);
  expect(repairOccludedOutline(source, [], 1)).toBe(source);
});
