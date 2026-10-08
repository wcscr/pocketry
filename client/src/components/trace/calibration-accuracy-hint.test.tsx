// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalibrationAccuracyHint } from "./calibration-accuracy-hint";

vi.mock("@/lib/calibrate/download-template", () => ({ downloadCalibrationTemplate: vi.fn() }));
vi.mock("@/lib/calibrate/download-reference-strip", () => ({ downloadMeasurementAid: vi.fn().mockResolvedValue(undefined) }));

let host: HTMLDivElement;
let root: Root;
const trigger = () => host.querySelector<HTMLButtonElement>("button")!;
const hint = () => document.querySelector<HTMLDivElement>('[role="dialog"][aria-label="Accuracy with thick objects"]');
const pointer = (target: Element, type: "pointerover" | "pointerout" | "pointerdown", pointerType = "mouse") => {
  const event = new MouseEvent(type, { bubbles: true, relatedTarget: document.body });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  target.dispatchEvent(event);
};
const advance = async (ms: number) => React.act(async () => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  React.act(() => root.render(<CalibrationAccuracyHint><p>Paper and aid detected.</p></CalibrationAccuracyHint>));
});

afterEach(() => {
  React.act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("calibration accuracy guidance", () => {
  it("keeps programmatic or keyboard focus silent, then accepts native keyboard activation", async () => {
    React.act(() => trigger().focus());
    await advance(500);
    expect(hint()).toBeNull();
    expect(trigger().getAttribute("aria-haspopup")).toBe("dialog");
    // Native buttons turn Enter/Space into a click with detail=0. jsdom does
    // not synthesize that browser default from a dispatched keyboard event.
    await React.act(async () => trigger().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 })));
    expect(hint()?.textContent).toContain("Paper and aid detected.");
    expect(document.activeElement).toBe(hint());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    await React.act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await advance(20);
    expect(hint()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("opens on a deliberate tap and closes on an outside interaction", async () => {
    React.act(() => pointer(trigger(), "pointerover", "touch"));
    await advance(500);
    expect(hint()).toBeNull();
    await React.act(async () => trigger().click());
    expect(hint()?.textContent).toContain("closer to the camera");
    await advance(20);
    await React.act(async () => pointer(document.body, "pointerdown"));
    expect(hint()).toBeNull();
  });

  it("allows moving from the hover trigger to its download link without stealing focus", async () => {
    React.act(() => trigger().focus());
    React.act(() => pointer(trigger(), "pointerover"));
    await advance(250);
    expect(hint()).not.toBeNull();
    expect(document.activeElement).toBe(trigger());
    React.act(() => pointer(trigger(), "pointerout"));
    await advance(100);
    React.act(() => pointer(hint()!, "pointerover"));
    await advance(250);
    expect(hint()).not.toBeNull();
    React.act(() => pointer(hint()!, "pointerout"));
    await advance(200);
    expect(hint()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("pins a hovered hint on click so moving the pointer away does not dismiss it", async () => {
    React.act(() => pointer(trigger(), "pointerover"));
    await advance(250);
    await React.act(async () => trigger().click());
    React.act(() => pointer(trigger(), "pointerout"));
    await advance(500);
    expect(hint()).not.toBeNull();
    expect(document.activeElement).toBe(hint());
  });

  it("keeps downloads open after the hint closes and restores focus when downloads close", async () => {
    React.act(() => pointer(trigger(), "pointerover"));
    await advance(250);
    await React.act(async () => hint()!.querySelector<HTMLButtonElement>("button")!.click());
    expect(hint()).toBeNull();
    const downloads = document.querySelector<HTMLDivElement>('[role="dialog"]')!;
    expect(downloads.textContent).toContain("Calibration aids");
    React.act(() => pointer(trigger(), "pointerout"));
    await advance(500);
    expect(downloads.isConnected).toBe(true);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("3D printable aids");
    await React.act(async () => Array.from(downloads.querySelectorAll("button")).find((button) => button.textContent === "Close")!.click());
    await advance(50);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
});
