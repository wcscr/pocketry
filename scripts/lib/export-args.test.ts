import { describe, expect, it } from "vitest";
import { parseExportArgs } from "./export-args";

describe("export CLI arguments", () => {
  it("preserves the empty-bin defaults and legacy solid/no-lip syntax", () => {
    expect(parseExportArgs([]).spec).toEqual({ gridX: 2, gridY: 3, heightUnits: 6, fill: "none", lip: "standard" });
    expect(parseExportArgs(["4x2x3", "--fill", "solid", "--no-lip"]).spec)
      .toEqual({ gridX: 4, gridY: 2, heightUnits: 3, fill: "solid", lip: "none" });
  });

  it("keeps SVG sizing automatic and distinguishes body depth from total height", () => {
    const args = parseExportArgs(["--svg", "tool.svg", "--object-depth", "9", "--object-height", "15", "--plan"]);
    expect(args.svgOptions).toEqual({ objectDepthMm: 9, objectHeightMm: 15 });
    expect(args.planOnly).toBe(true);
    expect(args.svgPath).toBe("tool.svg");
  });

  it("preserves original last-value-wins options for legacy empty-bin commands", () => {
    const args = parseExportArgs(["1x1x2", "4x2x3", "--fill", "none", "--fill", "solid",
      "--no-lip", "--no-lip", "--out", "first", "--out", "last"]);
    expect(args.spec).toEqual({ gridX: 4, gridY: 2, heightUnits: 3, fill: "solid", lip: "none" });
    expect(args.outDir).toBe("last");
  });

  it("preserves negative custom coordinates and explicit rotation without order dependence", () => {
    const args = parseExportArgs(["--svg", "tool.svg", "--finger-center", "-10,8", "--finger-diameter", "12",
      "--finger-center", "10,-8", "--object-depth", "10", "--rotation", "-45", "--finger-access", "custom"]);
    expect(args.svgOptions.fingerAccess).toEqual({ placement: "custom", diameterMm: 12, centers: [{ x: -10, y: 8 }, { x: 10, y: -8 }] });
    expect(args.svgOptions.rotationDeg).toBe(-45);
  });

  it.each([
    ["--svg", "tool.svg"], ["--object-depth", "10"], ["--svg", "tool.svg", "--object-depth", "NaN"],
    ["--svg", "tool.svg", "--project", "tool.json"], ["--svg", "tool.svg", "--object-depth", "10", "--fill", "none"],
    ["--out"], ["--out", "--json"], ["--json", "--json"],
    ["2x1x4", "3x1x4", "--svg", "tool.svg", "--object-depth", "9"],
    ["--project", "tool.json", "--no-lip"], ["--svg", "tool.svg", "--object-depth", "10", "--finger-center", "1"],
  ])("rejects contradictory or malformed syntax before exporting: %j", (...args) => {
    expect(() => parseExportArgs(args)).toThrow();
  });
});
