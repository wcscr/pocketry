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

function mountHook(refiner: OutlineRefiner): {
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
    useOutlineRefinement(refiner);
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
  it("recomputes a displayed physical margin when reference length changes", async () => {
    const refiner = vi.fn<OutlineRefiner>(async () => [
      { ...OUTLINE[0], holes: [[{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }]] },
    ]);
    const mounted = mountHook(refiner);

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

    expect(refiner).toHaveBeenCalledOnce();
    expect(refiner).toHaveBeenLastCalledWith(
      OUTLINE,
      expect.objectContaining({
        margin: 1.5,
        calibration: expect.objectContaining({ lengthMm: 50 }),
      }),
    );

    await React.act(async () => {
      mounted.store().dispatch({ type: "SET_RULER_LENGTH", rulerLengthMm: 100 });
      await Promise.resolve();
    });

    expect(refiner).toHaveBeenCalledTimes(2);
    expect(refiner).toHaveBeenLastCalledWith(
      OUTLINE,
      expect.objectContaining({
        margin: 1.5,
        calibration: expect.objectContaining({ lengthMm: 100 }),
      }),
    );
    mounted.unmount();
  });

  it("still applies an explicit contour-setting change using the current scale", async () => {
    const refined: Outline = [
      { ...OUTLINE[0], outer: [...OUTLINE[0].outer, { x: -1, y: 5 }] },
    ];
    const refiner = vi.fn<OutlineRefiner>(async () => refined);
    const mounted = mountHook(refiner);
    const calibration = {
      startX: 0,
      startY: 0,
      endX: 100,
      endY: 0,
      lengthMm: 50,
    };

    React.act(() => {
      mounted.store().dispatch({
        type: "DETECTED",
        imageUrl: null,
        outline: OUTLINE,
        rawOutline: OUTLINE,
        svg: "<svg/>",
        region: null,
      });
      mounted.store().dispatch({ type: "SET_CALIBRATION", calibration });
    });
    await React.act(async () => Promise.resolve());
    refiner.mockClear();

    await React.act(async () => {
      mounted.store().dispatch({ type: "SET_MARGIN", margin: 2 });
      await Promise.resolve();
    });

    expect(refiner).toHaveBeenCalledOnce();
    expect(refiner).toHaveBeenCalledWith(
      OUTLINE,
      expect.objectContaining({ calibration, margin: 2 }),
    );
    expect(mounted.store().outline).toEqual(refined);
    mounted.unmount();
  });
});
