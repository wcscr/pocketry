// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Slider } from "./slider";

let host: HTMLDivElement;
let root: Root;

function dispatchPointer(
  element: Element,
  type: string,
  { x, y, pointerId = 1, pointerType = "touch", button = 0 }: {
    x: number;
    y: number;
    pointerId?: number;
    pointerType?: string;
    button?: number;
  },
): void {
  React.act(() => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      pointerId: { value: pointerId },
      pointerType: { value: pointerType },
      button: { value: button },
      clientX: { value: x },
      clientY: { value: y },
    });
    element.dispatchEvent(event);
  });
}

function mockSliderGeometry(slider: HTMLElement, { left = 100, top = 520, width = 200, height = 32 } = {}): void {
  const rect = {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
  vi.spyOn(slider, "getBoundingClientRect").mockReturnValue(rect);
  const captured = new Set<number>();
  const attachCapture = (el: Element) => {
    Object.defineProperty(el, "setPointerCapture", {
      configurable: true,
      value: (id: number) => { captured.add(id); },
    });
    Object.defineProperty(el, "releasePointerCapture", {
      configurable: true,
      value: (id: number) => { captured.delete(id); },
    });
    Object.defineProperty(el, "hasPointerCapture", {
      configurable: true,
      value: (id: number) => captured.has(id),
    });
  };
  attachCapture(slider);
  slider.querySelectorAll("*").forEach(attachCapture);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  React.act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderControlled({ initial = 0, min = -127, max = 128, step = 1, onChange = vi.fn(), onCommit = vi.fn() } = {}) {
  function Harness() {
    const [val, setVal] = React.useState(initial);
    return (
      <Slider
        id="test-slider"
        aria-label="Sensitivity"
        min={min}
        max={max}
        step={step}
        value={[val]}
        onValueChange={([next]) => { setVal(next); onChange(next); }}
        onValueCommit={([next]) => onCommit(next)}
      />
    );
  }
  React.act(() => root.render(<Harness />));
  const slider = host.querySelector<HTMLElement>("#test-slider")!;
  const thumb = slider.querySelector<HTMLElement>('[role="slider"]')!;
  mockSliderGeometry(slider);
  return { slider, thumb, onChange, onCommit };
}

describe("Slider touch scroll protection", () => {
  it("allows vertical touch panning via touch-pan-y instead of touch-none", () => {
    const { slider } = renderControlled();
    expect(slider.className).toContain("touch-pan-y");
    expect(slider.className).not.toContain("touch-none");
  });

  it("ignores a vertical touch swipe starting on the track", () => {
    const { slider, thumb, onChange, onCommit } = renderControlled();
    dispatchPointer(slider, "pointerdown", { x: 242, y: 536 });
    dispatchPointer(slider, "pointermove", { x: 243, y: 510 });
    dispatchPointer(slider, "pointermove", { x: 242, y: 446 });
    dispatchPointer(slider, "pointerup", { x: 242, y: 446 });
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(thumb.getAttribute("aria-valuenow")).toBe("0");
  });

  it("ignores a vertical touch swipe starting on the thumb", () => {
    const { slider, thumb, onChange, onCommit } = renderControlled();
    dispatchPointer(thumb, "pointerdown", { x: 200, y: 536 });
    dispatchPointer(slider, "pointermove", { x: 203, y: 512 });
    dispatchPointer(slider, "pointermove", { x: 202, y: 450 });
    dispatchPointer(slider, "pointerup", { x: 202, y: 450 });
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(thumb.getAttribute("aria-valuenow")).toBe("0");
  });

  it("ignores a vertical touch swipe that is cancelled by native scrolling", () => {
    const { slider, thumb, onChange, onCommit } = renderControlled();
    dispatchPointer(slider, "pointerdown", { x: 242, y: 536 });
    dispatchPointer(slider, "pointermove", { x: 242, y: 531 });
    dispatchPointer(slider, "pointercancel", { x: 242, y: 520 });
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(thumb.getAttribute("aria-valuenow")).toBe("0");
  });

  it("supports intentional horizontal touch dragging from the thumb", () => {
    const { slider, thumb, onChange, onCommit } = renderControlled();
    dispatchPointer(thumb, "pointerdown", { x: 200, y: 536 });
    expect(onChange).not.toHaveBeenCalled();
    dispatchPointer(slider, "pointermove", { x: 225, y: 537 });
    // Real touch browsers fire a bubbling lostpointercapture on the thumb when
    // explicit capture moves from the thumb to the slider root.
    dispatchPointer(thumb, "lostpointercapture", { x: 225, y: 537 });
    expect(onChange).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    dispatchPointer(slider, "pointermove", { x: 250, y: 538 });
    dispatchPointer(slider, "pointerup", { x: 250, y: 538 });
    // x=250 on [100..300] is 75% of [-127..128] => 64.25 -> 64
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(64);
    expect(thumb.getAttribute("aria-valuenow")).toBe("64");
  });

  it("supports intentional horizontal touch dragging starting on the track", () => {
    const { slider, thumb, onChange, onCommit } = renderControlled();
    dispatchPointer(slider, "pointerdown", { x: 220, y: 536 });
    expect(onChange).not.toHaveBeenCalled();
    dispatchPointer(slider, "pointermove", { x: 260, y: 536 });
    expect(onChange).toHaveBeenCalled();
    dispatchPointer(slider, "pointerup", { x: 260, y: 536 });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(77);
    expect(thumb.getAttribute("aria-valuenow")).toBe("77");
  });

  it("commits an intentional stationary tap on the track without committing a tap on the thumb", () => {
    const { slider, thumb, onChange, onCommit } = renderControlled();
    dispatchPointer(thumb, "pointerdown", { x: 200, y: 536 });
    dispatchPointer(thumb, "pointerup", { x: 200, y: 536 });
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();

    dispatchPointer(slider, "pointerdown", { x: 250, y: 536 });
    dispatchPointer(slider, "pointerup", { x: 250, y: 536 });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(64);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(64);
    expect(thumb.getAttribute("aria-valuenow")).toBe("64");
  });

  it("rolls back an interrupted horizontal touch drag on pointercancel or second finger", () => {
    const { slider, thumb, onChange, onCommit } = renderControlled();
    dispatchPointer(thumb, "pointerdown", { x: 200, y: 536, pointerId: 1 });
    dispatchPointer(slider, "pointermove", { x: 250, y: 536, pointerId: 1 });
    expect(thumb.getAttribute("aria-valuenow")).toBe("64");
    dispatchPointer(slider, "pointercancel", { x: 250, y: 536, pointerId: 1 });
    expect(thumb.getAttribute("aria-valuenow")).toBe("0");
    expect(onCommit).not.toHaveBeenCalled();

    onChange.mockClear();
    dispatchPointer(thumb, "pointerdown", { x: 200, y: 536, pointerId: 2 });
    dispatchPointer(slider, "pointermove", { x: 250, y: 536, pointerId: 2 });
    expect(thumb.getAttribute("aria-valuenow")).toBe("64");
    dispatchPointer(slider, "pointerdown", { x: 260, y: 536, pointerId: 3 });
    expect(thumb.getAttribute("aria-valuenow")).toBe("0");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("preserves immediate mouse dragging and keyboard adjustments", () => {
    const { slider, thumb, onChange, onCommit } = renderControlled();
    dispatchPointer(slider, "pointerdown", { x: 250, y: 536, pointerType: "mouse" });
    expect(onChange).toHaveBeenCalledWith(64);
    dispatchPointer(slider, "pointerup", { x: 250, y: 536, pointerType: "mouse" });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(64);

    React.act(() => {
      thumb.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(thumb.getAttribute("aria-valuenow")).toBe("65");
    expect(onCommit).toHaveBeenLastCalledWith(65);
  });
});
