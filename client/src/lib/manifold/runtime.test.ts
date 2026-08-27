import { describe, expect, it } from "vitest";

import { Arena, withArena } from "./arena";
import { loadManifold, withKernel } from "./runtime";

describe("Arena", () => {
  it("disposes tracked handles newest-first", () => {
    const order: number[] = [];
    const handle = (id: number) => ({ delete: () => order.push(id) });

    const arena = new Arena();
    arena.track(handle(1));
    arena.track(handle(2));
    arena.track(handle(3));
    arena.dispose();

    expect(order).toEqual([3, 2, 1]);
  });

  it("keeps released handles alive", () => {
    let deleted = false;
    const kept = { delete: () => void (deleted = true) };

    const arena = new Arena();
    arena.track(kept);
    arena.release(kept);
    arena.dispose();

    expect(deleted).toBe(false);
    expect(arena.size).toBe(0);
  });

  it("disposes even when the body throws", () => {
    let deleted = false;
    expect(() =>
      withArena((arena) => {
        arena.track({ delete: () => void (deleted = true) });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(deleted).toBe(true);
  });

  it("is idempotent and survives a handle that throws on delete", () => {
    let secondDeleted = false;
    const arena = new Arena();
    arena.track({
      delete: () => {
        secondDeleted = true;
      },
    });
    arena.track({
      delete: () => {
        throw new Error("already freed");
      },
    });

    expect(() => arena.dispose()).not.toThrow();
    expect(secondDeleted).toBe(true);
    arena.dispose();
    expect(arena.size).toBe(0);
  });
});

describe("manifold runtime", () => {
  it("loads the wasm and returns a working kernel", async () => {
    const wasm = await loadManifold();
    expect(typeof wasm.CrossSection).toBe("function");
    expect(typeof wasm.Manifold).toBe("function");
    expect(typeof wasm.triangulate).toBe("function");
  });

  it("returns the same instance on repeated loads", async () => {
    const [a, b] = await Promise.all([loadManifold(), loadManifold()]);
    expect(a).toBe(b);
  });

  it("performs a 2D offset and a 3D extrude", async () => {
    const result = await withKernel(({ CrossSection, arena }) => {
      // 10x10 square, outer ring wound CCW.
      const square = arena.track(
        new CrossSection([
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
          ],
        ]),
      );
      const grown = arena.track(square.offset(1, "Round", 2, 32));
      const solid = arena.track(square.extrude(5));

      return {
        squareArea: square.area(),
        grownArea: grown.area(),
        volume: solid.volume(),
        genus: solid.genus(),
        status: solid.status(),
      };
    });

    expect(result.squareArea).toBeCloseTo(100, 6);
    // 10x10 grown by 1 with round joins: 100 + perimeter*1 + pi*1^2.
    expect(result.grownArea).toBeCloseTo(100 + 40 + Math.PI, 1);
    expect(result.volume).toBeCloseTo(500, 4);
    expect(result.genus).toBe(0);
    expect(result.status).toBe("NoError");
  });

  it("keeps holes as holes through an offset", async () => {
    // Annulus: 20x20 outer (CCW) with a 10x10 hole (CW).
    const { area, genus } = await withKernel(({ CrossSection, arena }) => {
      const annulus = arena.track(
        new CrossSection([
          [
            [0, 0],
            [20, 0],
            [20, 20],
            [0, 20],
          ],
          [
            [5, 5],
            [5, 15],
            [15, 15],
            [15, 5],
          ],
        ]),
      );
      // A positive delta must grow the shell and shrink the hole.
      const grown = arena.track(annulus.offset(1, "Miter", 2, 32));
      const solid = arena.track(annulus.extrude(3));
      return { area: grown.area(), genus: solid.genus() };
    });

    // Shell 22x22 = 484, hole shrinks to 8x8 = 64.
    expect(area).toBeCloseTo(484 - 64, 1);
    // A through-hole in an extruded annulus is a handle: genus 1.
    expect(genus).toBe(1);
  });
});
