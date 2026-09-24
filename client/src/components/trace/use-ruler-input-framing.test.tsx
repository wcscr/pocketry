import * as React from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useViewportTransform, type ViewportTransformApi } from "@/hooks/use-viewport-transform";
import { useRulerInputFraming } from "./use-ruler-input-framing";

it("keeps distant reference marks visible through keyboard resizing and restores the photo on blur", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("visualViewport", Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 }));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let viewport: ViewportTransformApi;
  const ruler = { startX: 1500, startY: 1500, endX: 1800, endY: 1900 };
  function Harness({ height }: { height: number }) {
    viewport = useViewportTransform({ contentWidth: 2000, contentHeight: 2000, containerWidth: 390, containerHeight: height, padding: Math.min(64, height / 5) });
    useRulerInputFraming(true, ruler, { width: 390, height }, viewport);
    return <input id="mobile-ruler-length" />;
  }
  try {
    React.act(() => root.render(<Harness height={600} />));
    React.act(() => host.querySelector("input")!.focus());
    for (const height of [300, 110, 180]) {
      React.act(() => root.render(<Harness height={height} />));
      const { scale, translateX, translateY } = viewport!.transform;
      for (const [x, y] of [[ruler.startX, ruler.startY], [ruler.endX, ruler.endY]]) {
        expect(x * scale + translateX).toBeGreaterThan(0);
        expect(x * scale + translateX).toBeLessThan(390);
        expect(y * scale + translateY).toBeGreaterThan(0);
        expect(y * scale + translateY).toBeLessThan(height);
      }
    }
    React.act(() => host.querySelector("input")!.blur());
    React.act(() => root.render(<Harness height={600} />));
    expect(viewport!.transform.scale).toBe(viewport!.fitScale);
  } finally {
    React.act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
