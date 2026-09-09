import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { photoBoardCalibrationScad, photoBoardManifest } from "./photo-board-export";
import { H2D_PHOTO_BOARD as board } from "./photo-board";
import {
  PAPER_TEMPLATE_VARIANTS,
  TEMPLATE_FORMAT_MM,
  paperFromTemplateMarkerIds,
  templateDisplayName,
  templateFormat,
  templateFromTemplateMarkerIds,
  templateMarkerCentersMm,
  templateMarkerSpacingMm,
} from "./template";
import { perspectiveLayout, proposalFromTemplateMarkers } from "./perspective";

describe("H2D photo-board physical contract", () => {
  it("uses new IDs and cannot be mistaken for a paper download", () => {
    expect(templateFromTemplateMarkerIds([19, 17, 16, 18])).toBe("h2d-photo-board");
    expect(templateFromTemplateMarkerIds([16, 17, 18])).toBeNull();
    expect(templateFromTemplateMarkerIds([12, 17, 18, 19])).toBeNull();
    expect(paperFromTemplateMarkerIds([16, 17, 18, 19])).toBeNull();
    expect(PAPER_TEMPLATE_VARIANTS).not.toContain("h2d-photo-board");
    expect(templateFormat("h2d-photo-board")).toBe("h2d-photo-board");
    expect(templateDisplayName("h2d-photo-board")).toBe("H2D photo board (315 × 310 mm)");
  });

  it("locks the marker sizes and centers to the manufactured board", () => {
    expect(templateMarkerCentersMm("h2d-photo-board")).toEqual([
      { id: 16, x: 26, y: 26 },
      { id: 17, x: 289, y: 26 },
      { id: 18, x: 289, y: 284 },
      { id: 19, x: 26, y: 284 },
    ]);
    expect(templateMarkerSpacingMm("h2d-photo-board")).toEqual({ width: 263, height: 258 });
    expect(board.markerSize).toBe(30);
    expect((board.tileSize-board.markerSize)/2).toBe(5);
    expect(board.thickness-board.tileThickness).toBeCloseTo(3.6, 9);
  });

  it("leaves H2D single-nozzle clearance including the adhesion pads", () => {
    const overhang = board.adhesionRadius-board.adhesionInset;
    expect(board.width+2*overhang).toBe(323);
    expect(board.height+2*overhang).toBe(318);
    expect(board.width+2*overhang).toBeLessThan(325);
    expect(board.height+2*overhang).toBeLessThan(320);
    expect(board.width*board.height/(325*320)).toBeGreaterThan(0.93);
  });

  it("keeps the distributed OpenSCAD data and manifest identical to the detector", () => {
    const directory = new URL("../../../../models/h2d-photo-board/", import.meta.url);
    expect(readFileSync(new URL("calibration.scad", directory), "utf8")).toBe(photoBoardCalibrationScad());
    expect(JSON.parse(readFileSync(new URL("calibration.json", directory), "utf8"))).toEqual(photoBoardManifest());
  });

  it("rectifies the full board using its own dimensions within the raster budget", () => {
    const markers = templateMarkerCentersMm("h2d-photo-board").map(({ id, x, y }) => ({
      id,
      centerPx: { x: x*2, y: y*2 },
      cornersPx: [
        { x: (x-15)*2, y: (y-15)*2 },
        { x: (x+15)*2, y: (y-15)*2 },
        { x: (x+15)*2, y: (y+15)*2 },
        { x: (x-15)*2, y: (y+15)*2 },
      ] as [{x:number;y:number},{x:number;y:number},{x:number;y:number},{x:number;y:number}],
    }));
    const proposal = proposalFromTemplateMarkers(markers, "h2d-photo-board")!;
    const layout = perspectiveLayout(proposal, "h2d-photo-board");
    expect(proposal.paper).toBe("h2d-photo-board");
    expect(TEMPLATE_FORMAT_MM[proposal.paper!]).toEqual({ width: 315, height: 310 });
    expect(layout.width).toBe(1200);
    expect(layout.height).toBeLessThanOrEqual(1200);
    expect(layout.pxPerMm).toBeCloseTo(1199/315, 12);
    expect(layout.destination[1].x-layout.destination[0].x).toBeCloseTo(263*layout.pxPerMm, 9);
  });
});
