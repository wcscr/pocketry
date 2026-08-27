// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useElementSize, type Size } from "./use-element-size";

/**
 * jsdom ships no ResizeObserver, so the hook's whole update path has to be
 * driven by hand. This stub records what was observed and exposes `emit` so a
 * test can play the role of the layout engine.
 */
class FakeResizeObserver implements ResizeObserver {
  static instances: FakeResizeObserver[] = [];

  readonly observed: Element[] = [];
  disconnectCount = 0;

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element) {
    this.observed.push(target);
  }

  unobserve() {}

  disconnect() {
    this.disconnectCount += 1;
  }

  emit(size: Size) {
    // Only the two fields the hook reads are populated; the cast stands in for
    // the rest of the ResizeObserverEntry surface rather than widening to `any`.
    const entry = {
      target: this.observed[0],
      borderBoxSize: [{ inlineSize: size.width, blockSize: size.height }],
    } as unknown as ResizeObserverEntry;
    this.callback([entry], this);
  }
}

/** Force `getBoundingClientRect()` — jsdom always reports 0 x 0 otherwise. */
function stubBoundingRect(width: number, height: number) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}

/**
 * Mount the hook on a real DOM node. React's own `act` (18.3+) flushes the
 * layout effect synchronously, which is exactly what this hook relies on, and
 * keeps the test free of a testing-library dependency.
 */
function mountProbe() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let latest: Size = { width: -1, height: -1 };

  function Probe(): React.ReactElement {
    const [ref, size] = useElementSize<HTMLDivElement>();
    latest = size;
    return React.createElement("div", { ref });
  }

  React.act(() => {
    root.render(React.createElement(Probe));
  });

  return {
    get size(): Size {
      return latest;
    },
    element: container.firstElementChild as HTMLDivElement,
    act: React.act,
    unmount() {
      React.act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  FakeResizeObserver.instances.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useElementSize", () => {
  it("measures the element on mount", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    stubBoundingRect(320, 240);

    const probe = mountProbe();

    expect(probe.size).toEqual({ width: 320, height: 240 });
    expect(FakeResizeObserver.instances).toHaveLength(1);
    expect(FakeResizeObserver.instances[0]?.observed).toEqual([probe.element]);

    probe.unmount();
  });

  it("updates when the observer reports a new size", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    stubBoundingRect(320, 240);

    const probe = mountProbe();
    const observer = FakeResizeObserver.instances[0]!;

    // Stands in for a ResizablePanel drag: no window resize event is involved.
    probe.act(() => observer.emit({ width: 900, height: 512 }));

    expect(probe.size).toEqual({ width: 900, height: 512 });

    probe.unmount();
  });

  it("keeps the same Size object when the dimensions have not moved", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    stubBoundingRect(320, 240);

    const probe = mountProbe();
    const observer = FakeResizeObserver.instances[0]!;

    probe.act(() => observer.emit({ width: 900, height: 512 }));
    const first = probe.size;
    probe.act(() => observer.emit({ width: 900, height: 512 }));

    // Consumers use this as an effect dependency, so identity has to be stable.
    expect(probe.size).toBe(first);

    probe.unmount();
  });

  it("falls back to a single measurement when ResizeObserver is missing", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", undefined);
    stubBoundingRect(640, 480);

    const probe = mountProbe();

    expect(probe.size).toEqual({ width: 640, height: 480 });
    expect(FakeResizeObserver.instances).toHaveLength(0);

    expect(() => probe.unmount()).not.toThrow();
  });

  it("disconnects the observer on unmount", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    stubBoundingRect(320, 240);

    const probe = mountProbe();
    const observer = FakeResizeObserver.instances[0]!;

    probe.unmount();

    expect(observer.disconnectCount).toBe(1);
  });
});
