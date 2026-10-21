import { describe, expect, it } from "vitest";
import { defaultLabelTabWall } from "./label-tab";
import { compartmentLayout } from "./compartments";
import { parseBinSpec } from "./types";

describe("label tab defaults", () => {
  it.each([
    ["x", 20, "west", "right"], ["x", -20, "east", "left"],
    ["y", 20, "south", "back"], ["y", -20, "north", "front"],
  ] as const)("places tabs opposite scoops for %s/%s", (axis, angleDeg, wall, scoopWall) => {
    for (const side of ["both", "negative", "positive"] as const) {
      const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "none", lip: "none", wallSlant: { axis, angleDeg, side } });
      expect(defaultLabelTabWall(spec)).toBe(wall);
      expect(compartmentLayout(spec).scoopWall).toBe(scoopWall);
    }
  });
  it("uses the back for upright walls", () => {
    expect(defaultLabelTabWall({ wallSlant: null })).toBe("north");
    expect(defaultLabelTabWall({ wallSlant: { axis: "x", angleDeg: 0 } })).toBe("north");
  });
});
