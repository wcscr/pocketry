// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { Outline } from "@shared/geometry/types";

import {
  TraceProvider,
  useTrace,
  type TraceStore,
} from "@/state/trace-store";

import {
  useOutlineRefinement,
  type OutlineOffsetter,
  type OutlineRefiner,
} from "./use-outline-refinement";

const OUTLINE: Outline = [
  {
    outer: [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 0, y: 10 },
    ],
    holes: [],
  },
];

function mountHook(
  refiner: OutlineRefiner,
  offsetter: OutlineOffsetter = async (outline) => outline,
): {
  store: () => TraceStore;
  unmount: () => void;
} {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let latest: TraceStore | null = null;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  function Probe() {
    latest = useTrace();
    useOutlineRefinement(refiner, offsetter);
    return null;
  }

  React.act(() => {
    root.render(
      <TraceProvider>
        <Probe />
      </TraceProvider>,
    );
  });

  return {
    store: () => {
      if (!latest) throw new Error("probe never rendered");
      return latest;
    },
    unmount: () => {
      React.act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    },
  };
}

describe("useOutlineRefinement", () => {
  it("recomputes scale-dependent margin from the edited contour", async () => {
    const rawWithDeletedHole: Outline = [
      {
        ...OUTLINE[0],
        holes: [[{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }]],
      },
    ];
    const edited: Outline = [
      { ...OUTLINE[0], outer: [...OUTLINE[0].outer, { x: -2, y: 5 }] },
    ];
    const adjusted: Outline = [
      { ...edited[0], outer: [...edited[0].outer, { x: -3, y: 5 }] },
    ];
    const refiner = vi.fn<OutlineRefiner>(async () => rawWithDeletedHole);
    const offsetter = vi.fn<OutlineOffsetter>(async () => adjusted);
    const mounted = mountHook(refiner, offsetter);

    React.act(() => {
      mounted.store().dispatch({
        type: "SET_CALIBRATION",
        calibration: {
          startX: 0,
          startY: 0,
          endX: 100,
          endY: 0,
          lengthMm: 50,
        },
      });
    });
    await React.act(async () => Promise.resolve());

    React.act(() => {
      mounted.store().dispatch({
        type: "DETECTED",
        imageUrl: null,
        outline: OUTLINE,
        rawOutline: rawWithDeletedHole,
        svg: "<svg/>",
        region: null,
      });
      mounted.store().dispatch({
        type: "OUTLINE_COMMITTED",
        outline: edited,
        label: "Delete detected hole and move contour node",
      });
    });
    await React.act(async () => Promise.resolve());

    await React.act(async () => {
      mounted.store().dispatch({ type: "SET_RULER_LENGTH", rulerLengthMm: 100 });
      await Promise.resolve();
    });

    expect(refiner).not.toHaveBeenCalled();
    expect(offsetter).toHaveBeenCalledOnce();
    expect(offsetter).toHaveBeenCalledWith(edited, -1.5);
    expect(mounted.store().outline).toEqual(adjusted);
    expect(mounted.store().outline[0].holes).toEqual([]);
    mounted.unmount();
  });

  it("does not route a margin selection through raw-outline refinement", async () => {
    const refined: Outline = [
      { ...OUTLINE[0], outer: [...OUTLINE[0].outer, { x: -1, y: 5 }] },
    ];
    const refiner = vi.fn<OutlineRefiner>(async () => refined);
    const offsetter = vi.fn<OutlineOffsetter>(async () => refined);
    const mounted = mountHook(refiner, offsetter);
    const calibration = {
      startX: 0,
      startY: 0,
      endX: 100,
      endY: 0,
      lengthMm: 50,
    };

    React.act(() => {
      mounted.store().dispatch({ type: "SET_CALIBRATION", calibration });
    });
    await React.act(async () => Promise.resolve());

    React.act(() => {
      mounted.store().dispatch({
        type: "DETECTED",
        imageUrl: null,
        outline: OUTLINE,
        rawOutline: OUTLINE,
        svg: "<svg/>",
        region: null,
      });
    });
    await React.act(async () => Promise.resolve());
    refiner.mockClear();
    offsetter.mockClear();

    await React.act(async () => {
      mounted.store().dispatch({ type: "SET_MARGIN", margin: 2 });
      await Promise.resolve();
    });

    expect(refiner).not.toHaveBeenCalled();
    expect(offsetter).not.toHaveBeenCalled();
    expect(mounted.store().outline).toEqual(OUTLINE);
    expect(mounted.store().margin).toBe(2);
    mounted.unmount();
  });

  it("does not apply the scale-dependent margin a second time after rotation", async () => {
    const refiner = vi.fn<OutlineRefiner>(async (outline) => outline);
    const offsetter = vi.fn<OutlineOffsetter>(async (outline) => outline);
    const mounted = mountHook(refiner, offsetter);

    React.act(() => {
      mounted.store().dispatch({
        type: "SOURCE_LOADED",
        imageUrl: "data:image/png;base64,AA==",
        fileName: "tool",
      });
      mounted.store().dispatch({
        type: "SOURCE_READY",
        imageSize: { width: 20, height: 10 },
      });
      mounted.store().dispatch({
        type: "SET_CALIBRATION",
        calibration: {
          startX: 0,
          startY: 0,
          endX: 20,
          endY: 0,
          lengthMm: 10,
        },
      });
      mounted.store().dispatch({
        type: "DETECTED",
        imageUrl: "data:image/png;base64,AA==",
        outline: OUTLINE,
        rawOutline: OUTLINE,
        svg: "<svg/>",
        region: null,
      });
    });
    await React.act(async () => Promise.resolve());
    refiner.mockClear();
    offsetter.mockClear();

    await React.act(async () => {
      mounted.store().dispatch({
        type: "ROTATE_SOURCE",
        direction: "clockwise",
        naturalSize: { width: 20, height: 10 },
        maxSize: { width: 800, height: 600 },
      });
      await Promise.resolve();
    });

    expect(refiner).not.toHaveBeenCalled();
    expect(offsetter).not.toHaveBeenCalled();
    expect(mounted.store().imageSize).toEqual({ width: 10, height: 20 });
    expect(mounted.store().outline[0].outer).toEqual([
      { x: 10, y: 0 },
      { x: 10, y: 20 },
      { x: 0, y: 20 },
      { x: 0, y: 0 },
    ]);
    mounted.unmount();
  });
});
