// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  computeFitScale,
  computeFitTransform,
  useViewportTransform,
  type Point,
  type Transform,
  type UseViewportTransformOptions,
  type ViewportTransformApi,
} from "./use-viewport-transform";

/** An 800x600 photo in a 400x300 pane: the case the old 0.5 floor could not fit. */
const PHOTO: UseViewportTransformOptions = {
  contentWidth: 800,
  contentHeight: 600,
  containerWidth: 400,
  containerHeight: 300,
};

// fitScale = min((400 - 48) / 800, (300 - 48) / 600) = min(0.44, 0.42)
const PHOTO_FIT: Transform = { scale: 0.42, translateX: 32, translateY: 24 };

interface ViewportProbe {
  readonly api: ViewportTransformApi;
  readonly surface: HTMLDivElement;
  rerender(next: Partial<UseViewportTransformOptions>): void;
  act(run: () => void): void;
  unmount(): void;
}

/**
 * Mount the hook on a real element and keep a handle on its latest API.
 *
 * React's own `act` (18.3+) flushes the layout effects the hook fits in, and
 * keeps the test free of a testing-library dependency — same approach as
 * use-element-size.test.ts.
 */
function mountViewport(initial: UseViewportTransformOptions): ViewportProbe {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  let latest: ViewportTransformApi | null = null;
  let options = initial;

  function Probe(props: { options: UseViewportTransformOptions }) {
    const api = useViewportTransform(props.options);
    latest = api;
    // attachWheel is a stable ref callback, so React binds the wheel listener
    // once on mount and detaches it once on unmount.
    return React.createElement("div", { ref: api.attachWheel, ...api.handlers });
  }

  const render = () => {
    React.act(() => {
      root.render(React.createElement(Probe, { options }));
    });
  };
  render();

  return {
    get api() {
      if (!latest) throw new Error("probe never rendered");
      return latest;
    },
    get surface() {
      return host.firstElementChild as HTMLDivElement;
    },
    rerender(next) {
      options = { ...options, ...next };
      render();
    },
    act(run) {
      React.act(run);
    },
    unmount() {
      React.act(() => root.unmount());
      host.remove();
    },
  };
}

interface PointerInit {
  target: Element;
  pointerId?: number;
  clientX?: number;
  clientY?: number;
  button?: number;
  shiftKey?: boolean;
  pointerType?: string;
}

/**
 * Only the fields the hook reads are populated; the cast stands in for the rest
 * of the SyntheticEvent surface rather than widening to `any`. Calling the
 * handlers directly keeps the test on the hook's logic instead of on React's
 * event delegation, which jsdom cannot drive with real PointerEvents anyway.
 */
function pointerEvent(init: PointerInit): React.PointerEvent {
  return {
    pointerId: init.pointerId ?? 1,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    button: init.button ?? 0,
    buttons: 1,
    shiftKey: init.shiftKey ?? false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    pointerType: init.pointerType ?? "mouse",
    target: init.target,
    currentTarget: init.target,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.PointerEvent;
}

function dispatchWheel(
  target: Element,
  init: WheelEventInit & { deltaMode?: number },
): WheelEvent {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  React.act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function dispatchKey(type: "keydown" | "keyup", target: EventTarget): Event {
  const event = new KeyboardEvent(type, {
    code: "Space",
    key: " ",
    bubbles: true,
    cancelable: true,
  });
  React.act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** Where a content-space point lands in container space under `transform`. */
function project(transform: Transform, content: Point): Point {
  return {
    x: transform.translateX + content.x * transform.scale,
    y: transform.translateY + content.y * transform.scale,
  };
}

/** Inverse of `project`: what content sits under a container-space point. */
function unproject(transform: Transform, container: Point): Point {
  return {
    x: (container.x - transform.translateX) / transform.scale,
    y: (container.y - transform.translateY) / transform.scale,
  };
}

function expectTransform(actual: Transform, expected: Transform) {
  expect(actual.scale).toBeCloseTo(expected.scale, 6);
  expect(actual.translateX).toBeCloseTo(expected.translateX, 6);
  expect(actual.translateY).toBeCloseTo(expected.translateY, 6);
}

function expectPoint(actual: Point, expected: Point) {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("computeFitScale / computeFitTransform", () => {
  it("fits wider-than-tall content against the container width", () => {
    const input = {
      contentWidth: 800,
      contentHeight: 400,
      containerWidth: 400,
      containerHeight: 300,
      padding: 24,
    };
    // (400 - 48) / 800 = 0.44 is tighter than (300 - 48) / 400 = 0.63.
    expect(computeFitScale(input)).toBeCloseTo(0.44, 6);
    expectTransform(computeFitTransform(input), {
      scale: 0.44,
      translateX: 24, // the padding, exactly: the width is the limiting axis
      translateY: 62,
    });
  });

  it("fits taller-than-wide content against the container height", () => {
    const input = {
      contentWidth: 400,
      contentHeight: 800,
      containerWidth: 400,
      containerHeight: 300,
      padding: 24,
    };
    expect(computeFitScale(input)).toBeCloseTo(0.315, 6);
    expectTransform(computeFitTransform(input), {
      scale: 0.315,
      translateX: 137,
      translateY: 24,
    });
  });

  it("accounts for the padding", () => {
    const base = {
      contentWidth: 800,
      contentHeight: 400,
      containerWidth: 400,
      containerHeight: 300,
    };
    expect(computeFitScale({ ...base, padding: 0 })).toBeCloseTo(0.5, 6);
    expect(computeFitScale({ ...base, padding: 24 })).toBeCloseTo(0.44, 6);
  });

  it("falls back to the unpadded box when the padding exceeds the container", () => {
    // A mirrored (negative) scale would otherwise flip the whole scene.
    const scale = computeFitScale({
      contentWidth: 800,
      contentHeight: 400,
      containerWidth: 40,
      containerHeight: 30,
      padding: 24,
    });
    expect(scale).toBeCloseTo(0.05, 6);
    expect(scale).toBeGreaterThan(0);
  });

  it("returns an identity instead of NaN when a dimension is zero", () => {
    // Both sizes legitimately start at zero — no image loaded, container not
    // measured — and the old viewport wrote the resulting NaN into the CSS
    // transform, which blanks the canvas.
    for (const input of [
      { contentWidth: 0, contentHeight: 0, containerWidth: 400, containerHeight: 300 },
      { contentWidth: 800, contentHeight: 600, containerWidth: 0, containerHeight: 0 },
      { contentWidth: 800, contentHeight: 0, containerWidth: 400, containerHeight: 300 },
    ]) {
      const transform = computeFitTransform(input);
      expect(transform).toEqual({ scale: 1, translateX: 0, translateY: 0 });
      // Separately from the transform: minScale is derived from fitScale, so a
      // NaN here would poison every clamp rather than just one frame.
      expect(computeFitScale(input)).toBe(1);
    }
  });

  it("returns an identity for non-finite dimensions", () => {
    const input = {
      contentWidth: Number.NaN,
      contentHeight: 600,
      containerWidth: Number.POSITIVE_INFINITY,
      containerHeight: 300,
    };
    expect(computeFitTransform(input)).toEqual({
      scale: 1,
      translateX: 0,
      translateY: 0,
    });
    expect(computeFitScale(input)).toBe(1);
  });
});

describe("useViewportTransform — fitting", () => {
  it("fits and centres on mount", () => {
    const probe = mountViewport(PHOTO);

    expect(probe.api.fitScale).toBeCloseTo(0.42, 6);
    expectTransform(probe.api.transform, PHOTO_FIT);

    probe.unmount();
  });

  it("fits a large image into a small pane, below the old 0.5 floor", () => {
    const probe = mountViewport(PHOTO);

    // The regression: minScale was hardcoded at 0.5, so 0.42 was unreachable
    // and an 800x600 photo simply could not be shown whole.
    expect(probe.api.transform.scale).toBeLessThan(0.5);
    expect(probe.api.transform.scale).toBeCloseTo(probe.api.fitScale, 6);

    probe.act(() => probe.api.zoomTo(0.2));
    expect(probe.api.transform.scale).toBeCloseTo(0.2, 6);

    probe.unmount();
  });

  it("stays at an identity while the container is unmeasured", () => {
    const probe = mountViewport({ ...PHOTO, containerWidth: 0, containerHeight: 0 });

    expect(probe.api.transform).toEqual({ scale: 1, translateX: 0, translateY: 0 });
    // minScale is derived from fitScale, so a NaN here would poison the clamp.
    expect(probe.api.fitScale).toBe(1);

    // ...and fits as soon as the ResizeObserver reports a real box.
    probe.rerender({ containerWidth: 400, containerHeight: 300 });
    expectTransform(probe.api.transform, PHOTO_FIT);

    probe.unmount();
  });

  it("survives zooming and panning an unmeasured viewport", () => {
    // Nothing here is finite except by construction; a NaN reaching the
    // transform is unrecoverable without a remount, so the guards have to hold
    // all the way through an interaction, not just at the first fit.
    const probe = mountViewport({
      contentWidth: 0,
      contentHeight: 0,
      containerWidth: 0,
      containerHeight: 0,
    });

    probe.act(() => probe.api.zoomBy(2));
    probe.act(() => probe.api.resetZoom());
    probe.act(() => probe.api.fit());
    dispatchWheel(probe.surface, { deltaY: -120, ctrlKey: true });

    const { scale, translateX, translateY } = probe.api.transform;
    expect(Number.isFinite(scale)).toBe(true);
    expect(Number.isFinite(translateX)).toBe(true);
    expect(Number.isFinite(translateY)).toBe(true);
    expect(scale).toBeGreaterThan(0);

    probe.unmount();
  });

  it("refits when the content changes", () => {
    const probe = mountViewport(PHOTO);
    probe.act(() => probe.api.zoomTo(4));

    probe.rerender({ contentWidth: 400, contentHeight: 400 });

    // A new image gets a fresh view even though the user had zoomed the old one.
    expectTransform(probe.api.transform, {
      scale: 0.63,
      translateX: 74,
      translateY: 24,
    });

    probe.unmount();
  });

  it("refits on container resize while the user has not touched the view", () => {
    const probe = mountViewport(PHOTO);

    probe.rerender({ containerWidth: 600, containerHeight: 400 });

    expectTransform(probe.api.transform, {
      scale: 352 / 600,
      translateX: (600 - 800 * (352 / 600)) / 2,
      translateY: 24,
    });

    probe.unmount();
  });

  it("preserves the view centre on resize once the user has zoomed", () => {
    const probe = mountViewport(PHOTO);
    probe.act(() => probe.api.zoomBy(2));
    const zoomed = probe.api.transform;

    probe.rerender({ containerWidth: 600, containerHeight: 400 });

    // Never fight the user: the scale is untouched and the content that was in
    // the middle of the old box is still in the middle of the new one.
    expect(probe.api.transform.scale).toBeCloseTo(zoomed.scale, 6);
    expectPoint(
      project(probe.api.transform, unproject(zoomed, { x: 200, y: 150 })),
      { x: 300, y: 200 },
    );

    probe.unmount();
  });

  it("resumes following resizes after an explicit fit()", () => {
    const probe = mountViewport(PHOTO);
    probe.act(() => probe.api.zoomBy(3));
    probe.act(() => probe.api.fit());
    expectTransform(probe.api.transform, PHOTO_FIT);

    probe.rerender({ containerWidth: 600, containerHeight: 400 });

    expect(probe.api.transform.scale).toBeCloseTo(352 / 600, 6);

    probe.unmount();
  });

  it("resets to 1:1, centred", () => {
    const probe = mountViewport(PHOTO);

    probe.act(() => probe.api.resetZoom());

    expectTransform(probe.api.transform, {
      scale: 1,
      translateX: (400 - 800) / 2,
      translateY: (300 - 600) / 2,
    });

    probe.unmount();
  });
});

describe("useViewportTransform — zooming", () => {
  it("keeps the anchored point stationary", () => {
    const probe = mountViewport(PHOTO);
    const anchor = { x: 100, y: 80 };
    const pinned = unproject(probe.api.transform, anchor);

    probe.act(() => probe.api.zoomBy(2, anchor));

    expect(probe.api.transform.scale).toBeCloseTo(0.84, 6);
    expectPoint(project(probe.api.transform, pinned), anchor);

    probe.unmount();
  });

  it("anchors against the container, not the window", () => {
    const probe = mountViewport(PHOTO);
    // The canvas never sits at the window origin in the real layout: it is to
    // the right of the controls panel and below the header.
    vi.spyOn(probe.surface, "getBoundingClientRect").mockReturnValue({
      x: 50,
      y: 20,
      left: 50,
      top: 20,
      right: 450,
      bottom: 320,
      width: 400,
      height: 300,
      toJSON: () => ({}),
    });
    const pinned = unproject(probe.api.transform, { x: 100, y: 100 });

    probe.act(() => probe.api.zoomBy(2, { x: 150, y: 120 }));

    expectPoint(project(probe.api.transform, pinned), { x: 100, y: 100 });

    probe.unmount();
  });

  it("zooms about the container centre with no anchor", () => {
    const probe = mountViewport(PHOTO);
    const pinned = unproject(probe.api.transform, { x: 200, y: 150 });

    probe.act(() => probe.api.zoomBy(2));

    expectPoint(project(probe.api.transform, pinned), { x: 200, y: 150 });

    probe.unmount();
  });

  it("is symmetric: zooming in then out returns the original scale", () => {
    const probe = mountViewport(PHOTO);
    const before = probe.api.transform;

    probe.act(() => probe.api.zoomBy(Math.exp(0.18), { x: 120, y: 90 }));
    probe.act(() => probe.api.zoomBy(Math.exp(-0.18), { x: 120, y: 90 }));

    expectTransform(probe.api.transform, before);

    probe.unmount();
  });

  it("is symmetric over the wheel too", () => {
    const probe = mountViewport(PHOTO);
    const before = probe.api.transform;

    dispatchWheel(probe.surface, { deltaY: -120, ctrlKey: true, clientX: 120, clientY: 90 });
    const zoomedIn = probe.api.transform.scale;
    dispatchWheel(probe.surface, { deltaY: 120, ctrlKey: true, clientX: 120, clientY: 90 });

    // Exponential, so one notch is the same proportion in each direction. The
    // old linear `scale + deltaY * -0.01` was neither symmetric nor bounded.
    expect(zoomedIn).toBeCloseTo(0.42 * Math.exp(0.18), 6);
    expectTransform(probe.api.transform, before);

    probe.unmount();
  });

  it("clamps at maxScale", () => {
    const probe = mountViewport(PHOTO);

    probe.act(() => probe.api.zoomTo(1000));
    expect(probe.api.transform.scale).toBe(8);

    probe.rerender({ maxScale: 4 });
    probe.act(() => probe.api.zoomTo(1000));
    expect(probe.api.transform.scale).toBe(4);

    probe.unmount();
  });

  it("clamps at minScale, which is relaxed to reach the fit scale", () => {
    const probe = mountViewport(PHOTO);
    probe.act(() => probe.api.zoomTo(0.0001));
    expect(probe.api.transform.scale).toBeCloseTo(0.1, 6);

    // A huge image only fits far below the 0.1 floor, so the floor gives way.
    const wall = mountViewport({ ...PHOTO, contentWidth: 8000, contentHeight: 6000 });
    expect(wall.api.fitScale).toBeCloseTo(0.042, 6);
    wall.act(() => wall.api.zoomTo(0.0001));
    expect(wall.api.transform.scale).toBeCloseTo(wall.api.fitScale, 6);

    probe.unmount();
    wall.unmount();
  });

  it("ignores a non-finite or negative zoom factor", () => {
    const probe = mountViewport(PHOTO);

    probe.act(() => probe.api.zoomBy(Number.NaN));
    probe.act(() => probe.api.zoomBy(-2));
    probe.act(() => probe.api.zoomTo(Number.POSITIVE_INFINITY));

    expectTransform(probe.api.transform, PHOTO_FIT);

    probe.unmount();
  });
});

describe("useViewportTransform — wheel", () => {
  it("pans on a plain wheel and always preventDefaults", () => {
    const probe = mountViewport(PHOTO);

    const event = dispatchWheel(probe.surface, { deltaX: 10, deltaY: 20 });

    // The page must not scroll underneath the canvas, which needs a
    // {passive:false} listener for preventDefault to bite at all.
    expect(event.defaultPrevented).toBe(true);
    expectTransform(probe.api.transform, {
      scale: 0.42,
      translateX: PHOTO_FIT.translateX - 10,
      translateY: PHOTO_FIT.translateY - 20,
    });

    probe.unmount();
  });

  it("zooms at the cursor on ctrl/meta wheel", () => {
    const probe = mountViewport(PHOTO);
    const pinned = unproject(probe.api.transform, { x: 300, y: 200 });

    dispatchWheel(probe.surface, {
      deltaY: -120,
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });

    expect(probe.api.transform.scale).toBeGreaterThan(0.42);
    expectPoint(project(probe.api.transform, pinned), { x: 300, y: 200 });

    // A trackpad pinch reports metaKey on macOS Firefox; same path.
    const scaleAfterCtrl = probe.api.transform.scale;
    dispatchWheel(probe.surface, { deltaY: -120, metaKey: true, clientX: 300, clientY: 200 });
    expect(probe.api.transform.scale).toBeGreaterThan(scaleAfterCtrl);

    probe.unmount();
  });

  it("pans horizontally on shift wheel", () => {
    const probe = mountViewport(PHOTO);

    dispatchWheel(probe.surface, { deltaY: 30, shiftKey: true });

    // A plain mouse reports its only wheel axis in deltaY, so shift has to
    // redirect it rather than look for a deltaX that never arrives.
    expectTransform(probe.api.transform, {
      scale: 0.42,
      translateX: PHOTO_FIT.translateX - 30,
      translateY: PHOTO_FIT.translateY,
    });

    probe.unmount();
  });

  it("prefers a real deltaX under shift", () => {
    const probe = mountViewport(PHOTO);

    dispatchWheel(probe.surface, { deltaX: 12, deltaY: 30, shiftKey: true });

    expectTransform(probe.api.transform, {
      scale: 0.42,
      translateX: PHOTO_FIT.translateX - 12,
      translateY: PHOTO_FIT.translateY,
    });

    probe.unmount();
  });

  it("normalises deltaMode line and page", () => {
    const lines = mountViewport(PHOTO);
    dispatchWheel(lines.surface, { deltaY: 3, deltaMode: 1 });
    // Firefox reports a mouse notch as three lines; unscaled that is a 3px pan.
    expect(lines.api.transform.translateY).toBeCloseTo(PHOTO_FIT.translateY - 48, 6);
    lines.unmount();

    const pages = mountViewport(PHOTO);
    dispatchWheel(pages.surface, { deltaY: 1, deltaMode: 2 });
    expect(pages.api.transform.translateY).toBeCloseTo(PHOTO_FIT.translateY - 300, 6);
    pages.unmount();
  });

  it("zooms on a plain wheel in wheelMode zoom", () => {
    const probe = mountViewport({ ...PHOTO, wheelMode: "zoom" });

    dispatchWheel(probe.surface, { deltaY: -120, clientX: 200, clientY: 150 });

    expect(probe.api.transform.scale).toBeCloseTo(0.42 * Math.exp(0.18), 6);

    probe.unmount();
  });

  it("stops listening once attachWheel is passed null", () => {
    const probe = mountViewport(PHOTO);
    const surface = probe.surface;

    probe.act(() => probe.api.attachWheel(null));
    const event = dispatchWheel(surface, { deltaY: 20 });

    // preventDefault is the first thing the handler does, so an un-prevented
    // event proves the listener is gone.
    expect(event.defaultPrevented).toBe(false);
    expectTransform(probe.api.transform, PHOTO_FIT);

    probe.unmount();
  });

  it("moves the listener when attachWheel is passed a different element", () => {
    const probe = mountViewport(PHOTO);
    const first = probe.surface;
    const second = document.createElement("div");
    document.body.appendChild(second);

    probe.act(() => probe.api.attachWheel(second));

    expect(dispatchWheel(first, { deltaY: 20 }).defaultPrevented).toBe(false);
    expect(dispatchWheel(second, { deltaY: 20 }).defaultPrevented).toBe(true);

    probe.unmount();
    second.remove();
  });

  it("removes the listener on unmount", () => {
    const probe = mountViewport(PHOTO);
    const surface = probe.surface;

    probe.unmount();

    expect(dispatchWheel(surface, { deltaY: 20 }).defaultPrevented).toBe(false);
  });
});

describe("useViewportTransform — pointer panning", () => {
  const drag = (
    probe: ViewportProbe,
    from: Point,
    to: Point,
    init: Partial<PointerInit> = {},
  ) => {
    const target = probe.surface;
    probe.act(() =>
      probe.api.handlers.onPointerDown(
        pointerEvent({ target, clientX: from.x, clientY: from.y, ...init }),
      ),
    );
    probe.act(() =>
      probe.api.handlers.onPointerMove(
        pointerEvent({ target, clientX: to.x, clientY: to.y, ...init }),
      ),
    );
  };

  it("pans on middle-drag", () => {
    const probe = mountViewport(PHOTO);

    drag(probe, { x: 100, y: 100 }, { x: 140, y: 70 }, { button: 1 });
    expect(probe.api.isPanning).toBe(true);
    expectTransform(probe.api.transform, {
      scale: 0.42,
      translateX: PHOTO_FIT.translateX + 40,
      translateY: PHOTO_FIT.translateY - 30,
    });

    probe.act(() =>
      probe.api.handlers.onPointerUp(
        pointerEvent({ target: probe.surface, clientX: 140, clientY: 70, button: 1 }),
      ),
    );
    expect(probe.api.isPanning).toBe(false);

    probe.unmount();
  });

  it("pans on shift+left-drag even when panning is otherwise disabled", () => {
    const probe = mountViewport({ ...PHOTO, panEnabled: false });

    drag(probe, { x: 100, y: 100 }, { x: 90, y: 120 }, { shiftKey: true });

    expectTransform(probe.api.transform, {
      scale: 0.42,
      translateX: PHOTO_FIT.translateX - 10,
      translateY: PHOTO_FIT.translateY + 20,
    });

    probe.unmount();
  });

  it("pans on plain left-drag when panEnabled", () => {
    const probe = mountViewport(PHOTO);

    drag(probe, { x: 0, y: 0 }, { x: 25, y: 25 });

    expectTransform(probe.api.transform, {
      scale: 0.42,
      translateX: PHOTO_FIT.translateX + 25,
      translateY: PHOTO_FIT.translateY + 25,
    });

    probe.unmount();
  });

  it("leaves a plain left-drag to the editing tool when panEnabled is false", () => {
    const probe = mountViewport({ ...PHOTO, panEnabled: false });

    drag(probe, { x: 0, y: 0 }, { x: 25, y: 25 });

    expect(probe.api.isPanning).toBe(false);
    expectTransform(probe.api.transform, PHOTO_FIT);

    probe.unmount();
  });

  it("pans on space+left-drag, and space does not scroll or activate buttons", () => {
    const probe = mountViewport({ ...PHOTO, panEnabled: false });

    const down = dispatchKey("keydown", window);
    expect(down.defaultPrevented).toBe(true);
    expect(probe.api.isSpaceHeld).toBe(true);

    drag(probe, { x: 100, y: 100 }, { x: 130, y: 100 });
    expect(probe.api.transform.translateX).toBeCloseTo(PHOTO_FIT.translateX + 30, 6);

    dispatchKey("keyup", window);
    expect(probe.api.isSpaceHeld).toBe(false);

    probe.unmount();
  });

  it("never steals the space bar from a text field", () => {
    const probe = mountViewport(PHOTO);
    const input = document.createElement("input");
    document.body.appendChild(input);

    const event = dispatchKey("keydown", input);

    expect(event.defaultPrevented).toBe(false);
    expect(probe.api.isSpaceHeld).toBe(false);

    input.remove();
    probe.unmount();
  });

  it("pans on a one-finger touch drag", () => {
    const probe = mountViewport(PHOTO);

    drag(probe, { x: 200, y: 200 }, { x: 180, y: 260 }, { pointerType: "touch" });

    expectTransform(probe.api.transform, {
      scale: 0.42,
      translateX: PHOTO_FIT.translateX - 20,
      translateY: PHOTO_FIT.translateY + 60,
    });

    probe.unmount();
  });
});

describe("useViewportTransform — pinch", () => {
  const touchDown = (probe: ViewportProbe, id: number, at: Point) =>
    probe.act(() =>
      probe.api.handlers.onPointerDown(
        pointerEvent({
          target: probe.surface,
          pointerId: id,
          clientX: at.x,
          clientY: at.y,
          pointerType: "touch",
        }),
      ),
    );

  const touchMove = (probe: ViewportProbe, id: number, at: Point) =>
    probe.act(() =>
      probe.api.handlers.onPointerMove(
        pointerEvent({
          target: probe.surface,
          pointerId: id,
          clientX: at.x,
          clientY: at.y,
          pointerType: "touch",
        }),
      ),
    );

  it("zooms about the midpoint of two pointers", () => {
    const probe = mountViewport(PHOTO);
    touchDown(probe, 1, { x: 100, y: 100 });
    touchDown(probe, 2, { x: 200, y: 100 });

    const before = probe.api.transform;
    // Content under the old midpoint; after the gesture it must sit under the
    // new one, which is what "zoom about the fingers" means.
    const pinned = unproject(before, { x: 150, y: 100 });

    touchMove(probe, 1, { x: 50, y: 100 });

    expect(probe.api.transform.scale).toBeCloseTo(before.scale * 1.5, 6);
    expectPoint(project(probe.api.transform, pinned), { x: 125, y: 100 });

    probe.unmount();
  });

  it("pinches even while an editing tool owns one-finger input", () => {
    const probe = mountViewport({ ...PHOTO, panEnabled: false });
    touchDown(probe, 1, { x: 100, y: 100 });
    touchDown(probe, 2, { x: 200, y: 100 });
    expect(probe.api.transform.scale).toBeCloseTo(0.42, 6);

    touchMove(probe, 2, { x: 300, y: 100 });

    expect(probe.api.transform.scale).toBeCloseTo(0.42 * 2, 6);

    probe.unmount();
  });

  it("continues as a one-finger pan when one finger lifts", () => {
    const probe = mountViewport(PHOTO);
    touchDown(probe, 1, { x: 100, y: 100 });
    touchDown(probe, 2, { x: 200, y: 100 });

    probe.act(() =>
      probe.api.handlers.onPointerUp(
        pointerEvent({
          target: probe.surface,
          pointerId: 2,
          clientX: 200,
          clientY: 100,
          pointerType: "touch",
        }),
      ),
    );
    expect(probe.api.isPanning).toBe(true);

    const before = probe.api.transform;
    touchMove(probe, 1, { x: 140, y: 100 });

    // Pure pan, no scale change: dropping the gesture instead would make the
    // canvas jump on the next move.
    expect(probe.api.transform.scale).toBeCloseTo(before.scale, 6);
    expect(probe.api.transform.translateX).toBeCloseTo(before.translateX + 40, 6);

    probe.act(() =>
      probe.api.handlers.onPointerCancel(
        pointerEvent({
          target: probe.surface,
          pointerId: 1,
          clientX: 140,
          clientY: 100,
          pointerType: "touch",
        }),
      ),
    );
    expect(probe.api.isPanning).toBe(false);

    probe.unmount();
  });
});

describe("fitToRect", () => {
  it("frames the rectangle: padded scale, rect centre at container centre", () => {
    const probe = mountViewport(PHOTO);
    probe.act(() => probe.api.fitToRect({ x: 100, y: 100, width: 200, height: 100 }));

    // available = (400−48) × (300−48); scale = min(352/200, 252/100) = 1.76.
    expect(probe.api.transform.scale).toBeCloseTo(1.76, 6);
    // Rect centre (200, 150) lands at the container centre (200, 150).
    expect(probe.api.transform.translateX).toBeCloseTo(200 - 1.76 * 200, 6);
    expect(probe.api.transform.translateY).toBeCloseTo(150 - 1.76 * 150, 6);
    probe.unmount();
  });

  it("counts as deliberate framing: container resizes stop refitting", () => {
    const probe = mountViewport(PHOTO);
    probe.act(() => probe.api.fitToRect({ x: 0, y: 0, width: 200, height: 200 }));
    const framed = probe.api.transform;

    probe.rerender({ containerWidth: 500, containerHeight: 400 });

    // Not the full-content fit — the framing survives, recentred by half the
    // container growth like any user-framed view.
    expect(probe.api.transform.scale).toBeCloseTo(framed.scale, 6);
    expect(probe.api.transform.translateX).toBeCloseTo(framed.translateX + 50, 6);
    expect(probe.api.transform.translateY).toBeCloseTo(framed.translateY + 50, 6);
    probe.unmount();
  });

  it("ignores degenerate rectangles", () => {
    const probe = mountViewport(PHOTO);
    const before = probe.api.transform;
    probe.act(() => probe.api.fitToRect({ x: 10, y: 10, width: 0, height: 50 }));
    expect(probe.api.transform).toEqual(before);
    probe.unmount();
  });
});
