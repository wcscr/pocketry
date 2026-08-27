// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CanvasToolbar } from "@/components/layout/canvas-toolbar";
import type { Size } from "@/hooks/use-element-size";

import { CanvasViewport, useCanvasViewportSize } from "./canvas-viewport";

/**
 * jsdom has no layout engine and no ResizeObserver, so the size the viewport
 * publishes has to be driven by hand — same stub shape as
 * use-element-size.test.ts, which owns the measurement itself.
 */
class FakeResizeObserver implements ResizeObserver {
  static instances: FakeResizeObserver[] = [];

  private readonly observed: Element[] = [];

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element) {
    this.observed.push(target);
  }

  unobserve() {}

  disconnect() {}

  emit(size: Size) {
    const entry = {
      target: this.observed[0],
      borderBoxSize: [{ inlineSize: size.width, blockSize: size.height }],
    } as unknown as ResizeObserverEntry;
    this.callback([entry], this);
  }
}

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

function mount(ui: React.ReactElement) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  React.act(() => root.render(ui));

  return {
    get html() {
      return host.innerHTML;
    },
    get root() {
      return host.firstElementChild as HTMLDivElement;
    },
    act: React.act,
    unmount() {
      React.act(() => root.unmount());
      host.remove();
    },
  };
}

/** Reports whatever size the enclosing viewport published. */
function SizeProbe(): JSX.Element {
  const size = useCanvasViewportSize();
  return <span>{`${size.width}x${size.height}`}</span>;
}

afterEach(() => {
  FakeResizeObserver.instances.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CanvasViewport", () => {
  it("fills and clips its pane", () => {
    stubBoundingRect(900, 512);
    const view = mount(
      <CanvasViewport>
        <svg />
      </CanvasViewport>,
    );

    // h-full/w-full is what makes the canvas use the whole working area rather
    // than a box sized from the image; overflow-hidden clips what is panned out.
    expect(view.root.className).toContain("relative");
    expect(view.root.className).toContain("h-full");
    expect(view.root.className).toContain("w-full");
    expect(view.root.className).toContain("overflow-hidden");
    expect(view.root.className).toContain("bg-muted/30");
    // Without touch-action: none a tablet drag becomes a page scroll and the
    // pointer handlers never see it.
    expect(view.root.className).toContain("touch-none");

    view.unmount();
  });

  it("publishes its measured size through context", () => {
    stubBoundingRect(900, 512);
    const view = mount(
      <CanvasViewport>
        <SizeProbe />
      </CanvasViewport>,
    );

    expect(view.html).toContain("900x512");

    // A ResizablePanel drag fires no window resize, only an observer callback.
    const observer = FakeResizeObserver.instances[0]!;
    view.act(() => observer.emit({ width: 640, height: 480 }));

    expect(view.html).toContain("640x480");

    view.unmount();
  });

  it("reports 0 x 0 outside a viewport", () => {
    const view = mount(<SizeProbe />);

    expect(view.html).toContain("0x0");

    view.unmount();
  });

  it("renders overlays above the scene", () => {
    stubBoundingRect(900, 512);
    const view = mount(
      <CanvasViewport overlays={<CanvasToolbar>zoom</CanvasToolbar>}>
        <svg>
          <title>scene</title>
        </svg>
      </CanvasViewport>,
    );

    expect(view.html).toContain("scene");
    expect(view.html).toContain("zoom");
    // Painted later, and a direct child of the clipped box so the toolbar's own
    // absolute corner offsets anchor to the viewport rather than to a wrapper.
    expect(view.html.indexOf("zoom")).toBeGreaterThan(view.html.indexOf("scene"));
    expect(view.root.lastElementChild?.className).toContain("left-2 top-2");

    view.unmount();
  });

  it("is content-agnostic: any element can be the scene", () => {
    stubBoundingRect(900, 512);
    // A later phase drops a three.js <canvas> in here unchanged.
    const view = mount(
      <CanvasViewport>
        <canvas id="webgl" />
      </CanvasViewport>,
    );

    expect(view.root.querySelector("canvas#webgl")).not.toBeNull();

    view.unmount();
  });

  it("lets a caller override the styling", () => {
    stubBoundingRect(900, 512);
    const view = mount(
      <CanvasViewport className="bg-background">
        <svg />
      </CanvasViewport>,
    );

    expect(view.root.className).toContain("bg-background");
    expect(view.root.className).not.toContain("bg-muted/30");

    view.unmount();
  });
});
