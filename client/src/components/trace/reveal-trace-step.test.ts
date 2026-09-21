// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { revealTraceStep } from "./reveal-trace-step";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function setup(height: number, groupTop: number, groupHeight: number, focusTop: number) {
  const outer = document.createElement("div");
  const scroller = document.createElement("div");
  const section = document.createElement("section");
  const group = document.createElement("div");
  const focus = document.createElement("button");
  document.body.append(outer);
  outer.append(scroller);
  scroller.append(section);
  section.append(group);
  group.append(focus);
  Object.defineProperty(scroller, "clientHeight", { value: height });
  // Reproduce the old bug: offsetTop includes a pinned toolbar outside the scroller.
  Object.defineProperty(section, "offsetTop", { value: 230 });
  vi.spyOn(scroller, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 180, 300, height));
  for (const [element, top, size] of [[section, 50, 1000], [group, groupTop, groupHeight], [focus, focusTop, 36]] as const) {
    vi.spyOn(element, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, 180 + top - scroller.scrollTop, 300, size),
    );
  }
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => frames.push(callback));
  const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  return { outer, scroller, section, group, focus, frames, cancel };
}

describe("guided Trace visibility", () => {
  it("keeps the heading, placement action and instructions below pinned navigation", () => {
    const { outer, scroller, section, group, focus } = setup(400, 90, 170, 90);
    outer.scrollTop = 17;
    revealTraceStep(section, focus, group);
    expect(section.getBoundingClientRect().top).toBe(180);
    expect(focus.getBoundingClientRect().top).toBeGreaterThanOrEqual(180);
    expect(group.getBoundingClientRect().bottom).toBeLessThanOrEqual(580);
    expect(scroller.scrollTop).toBe(50);
    expect(outer.scrollTop).toBe(17);
  });

  it("keeps the length input together with its label and confirmation instructions on a short screen", () => {
    const { scroller, section, group, focus } = setup(220, 210, 120, 240);
    revealTraceStep(section, focus, group);
    expect(group.getBoundingClientRect().top).toBeGreaterThanOrEqual(180);
    expect(group.getBoundingClientRect().bottom).toBeLessThanOrEqual(400);
    expect(focus.getBoundingClientRect().bottom).toBeLessThanOrEqual(400);
    expect(scroller.style.paddingBottom).toBe("220px");
  });

  it("prioritizes the active control when its review group cannot fit in the viewport", () => {
    const { section, group, focus } = setup(220, 90, 600, 330);
    revealTraceStep(section, focus, group);
    expect(focus.getBoundingClientRect().top).toBeGreaterThanOrEqual(180);
    expect(focus.getBoundingClientRect().bottom).toBeLessThanOrEqual(400);
  });

  it("settles after layout changes and cancels pending alignment when the step changes", () => {
    const { scroller, section, group, focus, frames, cancel } = setup(400, 90, 170, 90);
    const cleanup = revealTraceStep(section, focus, group);
    scroller.scrollTop += 100;
    frames[0](0);
    expect(section.getBoundingClientRect().top).toBe(180);
    cleanup();
    expect(cancel).toHaveBeenCalledWith(2);
  });

  it("does not scroll a hidden controls pane", () => {
    const { scroller, section, group, focus } = setup(0, 90, 170, 90);
    revealTraceStep(section, focus, group);
    expect(scroller.scrollTop).toBe(0);
    expect(scroller.style.paddingBottom).toBe("");
  });
});
