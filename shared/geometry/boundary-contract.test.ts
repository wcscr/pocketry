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
});
