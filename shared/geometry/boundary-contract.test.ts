import { describe, expect, it } from "vitest";
import { boundsMaterialGrowth, preservesMaterial } from "./boundary-contract";
import type { Outline, Ring } from "./types";
const shape=(outer:Ring):Outline=>[{outer,holes:[]}];
const square=shape([{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}]);
describe("final material contract",()=>{
  it("rejects a deep narrow cut even when almost all boundary points agree",()=>{
    const notch=shape([{x:0,y:0},{x:48,y:0},{x:48,y:4},{x:52,y:4},{x:52,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}]);
    expect(preservesMaterial(square,notch,.1)).toBe(false);
  });
  it("accepts equality and outward growth, rejects missing and empty shapes",()=>{
    expect(preservesMaterial(square,structuredClone(square),.1)).toBe(true);
    const grown=shape([{x:-1,y:-1},{x:101,y:-1},{x:101,y:101},{x:-1,y:101}]);
    expect(preservesMaterial(square,grown,.1)).toBe(true);
    expect(preservesMaterial(grown,square,.1)).toBe(false);
    expect(preservesMaterial(square,[],.1)).toBe(false);
  });
  it("checks hole material with the opposite direction",()=>{
    const withHole:Outline=[{...square[0],holes:[[{x:20,y:20},{x:20,y:80},{x:80,y:80},{x:80,y:20}]]}];
    const largerHole:Outline=[{...square[0],holes:[[{x:19,y:19},{x:19,y:81},{x:81,y:81},{x:81,y:19}]]}];
    expect(preservesMaterial(withHole,largerHole,.1)).toBe(false);
    expect(preservesMaterial(largerHole,withHole,.1)).toBe(true);
    expect(boundsMaterialGrowth(largerHole,withHole,.1)).toBe(false);
    expect(boundsMaterialGrowth(largerHole,withHole,1.5)).toBe(true);
  });

  const circle = (radius: number, count: number): Ring =>
    Array.from({ length: count }, (_, i) => ({ x: radius * Math.cos(2 * Math.PI * i / count), y: radius * Math.sin(2 * Math.PI * i / count) }));

  it("does not reject a long outline for its size alone", () => {
    // About 12,000 points, with the candidate using most of the allowance all the way round.
    const reference = shape(circle(1900, 12_000));
    expect(preservesMaterial(reference, shape(circle(1899, 12_000)), 1.2)).toBe(true);
    expect(preservesMaterial(reference, shape(circle(1898.5, 12_000)), 1.2)).toBe(false);
    expect(boundsMaterialGrowth(reference, shape(circle(1901, 12_000)), 1.2)).toBe(true);
  });

  it("certifies long straight edges against a tight allowance", () => {
    // A sparse rectangle against a densely sampled copy grown by a hundredth: the case that
    // made outward smoothing fall back to the unsmoothed ring.
    const sparse = shape([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }, { x: 0, y: 200 }]);
    const dense: Ring = [];
    for (let x = 0; x < 300; x += 1.5) dense.push({ x, y: -0.01 });
    for (let y = 0; y < 200; y += 1.5) dense.push({ x: 300.01, y });
    for (let x = 300; x > 0; x -= 1.5) dense.push({ x, y: 200.01 });
    for (let y = 200; y > 0; y -= 1.5) dense.push({ x: -0.01, y });
    expect(preservesMaterial(sparse, shape(dense), 0.05)).toBe(true);
  });

  it("keeps a corner whose vertex is repeated", () => {
    const doubled = shape([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]);
    expect(preservesMaterial(square, doubled, 0.5)).toBe(true);
    expect(preservesMaterial(doubled, square, 0.5)).toBe(true);
    // A notch whose inner corner is repeated must still count as a notch.
    const notched = shape([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 50, y: 20 }, { x: 50, y: 20 }, { x: 60, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]);
    expect(boundsMaterialGrowth(notched, square, 0.5)).toBe(false);
  });
});
