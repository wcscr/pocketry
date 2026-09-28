import { expect, it } from "vitest";
import { withKernel } from "@/lib/manifold/runtime";
import { placeObjectCells, type ConvexObjectCell } from "@shared/gridfinity/object-pose";
import { buildObjectCavity } from "./object-cavity";

it("poses a finite 3D tetrahedron through the shared path without a traced profile", async () => {
  const model: ConvexObjectCell = { vertices: [{x:0,y:0,z:0},{x:8,y:0,z:0},{x:0,y:6,z:0},{x:0,y:0,z:10}],
    edges:[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]] };
  const pose={rotation:{xDeg:145,yDeg:-90,zDeg:32},position:{x:3,y:-2},elevationMm:7};
  const cells=placeObjectCells([model],pose);
  expect(Math.min(...cells[0].vertices.map(p=>p.z))).toBe(7);
  await withKernel(kernel=>{
    const source=kernel.arena.track(kernel.Manifold.hull(model.vertices.map(p=>[p.x,p.y,p.z])));
    const cutter=buildObjectCavity(kernel,source,pose,40)!;
    expect(cutter.status()).toBe("NoError");
    expect(cutter.boundingBox().min[2]).toBeCloseTo(7,5);
    const low=kernel.arena.track(cutter.slice(10)),high=kernel.arena.track(cutter.slice(39));
    expect(low.area()).toBeGreaterThan(0);
    expect(high.area()).toBe(0);
    expect(cutter.volume()).toBeCloseTo(8 * 6 * 10 / 6, 5);
    expect(cutter.boundingBox().max[2]).toBeCloseTo(Math.max(...cells[0].vertices.map(p => p.z)), 5);
    expect(buildObjectCavity(kernel,source,pose,6)).toBeNull();
  });
});
