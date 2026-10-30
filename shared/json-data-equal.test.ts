import { describe, expect, it } from "vitest";
import { sameJsonData } from "./json-data-equal";

describe("non-serializing JSON data comparison", () => {
  it.each([
    [{ a: 1, optional: undefined }, { a: 1 }],
    [[undefined, NaN, Infinity], [null, null, null]],
    [Array(2), [null, null]],
    [Array(2), [null, 1]],
    [{ a: 1, b: 2 }, { b: 2, a: 1 }],
    [{ a: [1, { b: "font" }] }, { a: [1, { b: "changed" }] }],
    [null, undefined], [0, -0],
  ])("preserves JSON equality for %j and %j", (left, right) => {
    expect(sameJsonData(left, right)).toBe(JSON.stringify(left) === JSON.stringify(right));
  });

  it("compares repeated strings without constructing a serialized copy", () => {
    const data = "A".repeat(17_000_000);
    const left = Array.from({ length: 50 }, () => ({ data }));
    const right = Array.from({ length: 50 }, () => ({ data }));
    expect(sameJsonData(left, right)).toBe(true);
    right[49] = { data: data.slice(0, -1) + "B" };
    expect(sameJsonData(left, right)).toBe(false);
  });
});
