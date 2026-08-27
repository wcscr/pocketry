// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";

/**
 * Whole-app render smoke tests.
 *
 * No browser is available in this environment, so these stand in for "open the
 * page and see whether it explodes". They catch the failure modes a unit test
 * on an individual component cannot: a hook used outside its provider, a
 * circular import, a component that touches an imperative DOM API during its
 * first render. jsdom does no layout, so nothing here asserts geometry.
 */

class NoopResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  window.history.replaceState(null, "", "/");
  // Called unguarded by useIsMobile().
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderApp(): void {
  act(() => {
    root.render(React.createElement(App));
  });
}

function clickWorkspace(label: "Trace" | "Bin"): void {
  const link = [...container.querySelectorAll<HTMLAnchorElement>("nav a")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(link).toBeDefined();
  act(() => {
    link!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
  });
}

function openTraceSettings(section: "detect" | "scale" | "output"): void {
  const jump = container.querySelector<HTMLButtonElement>(
    `[data-testid="trace-settings-index"] [aria-controls="trace-settings-${section}"]`,
  );
  expect(jump).not.toBeNull();
  act(() => jump!.click());
}

describe("App", () => {
  it("mounts without throwing", () => {
    expect(() => renderApp()).not.toThrow();
  });

  it("renders the shell chrome", () => {
    renderApp();
    expect(container.textContent).toContain("ToolTrace");
    expect(container.textContent).toContain("Pocketry");
    const legacyWordmark = [...container.querySelectorAll("span")].find(
      (element) => element.textContent === "ToolTrace",
    );
    const pocketryWordmark = [...container.querySelectorAll("span")].find(
      (element) => element.textContent === "Pocketry",
    );
    expect(legacyWordmark?.className).toContain("line-through");
    expect(pocketryWordmark?.style.fontFamily).toContain("Rockwell");
    expect(container.textContent).toContain("Trace");
    expect(
      container.querySelector<HTMLAnchorElement>('a[aria-label="Pocketry home"]')
        ?.getAttribute("href"),
    ).toBe("/");
    expect(
      [...container.querySelectorAll("nav a")].map((link) =>
        link.textContent?.trim(),
      ),
    ).toEqual(["Trace", "Bin"]);
    expect(
      container
        .querySelector<HTMLAnchorElement>('[aria-label="Pocketry on GitHub"]')
        ?.getAttribute("href"),
    ).toBe("https://github.com/wcscr/pocketry");
  });

  it("links to a scrollable About page with legal notices and related tools", () => {
    renderApp();
    const about = container.querySelector<HTMLAnchorElement>(
      '[aria-label="About Pocketry"]',
    );
    expect(about).not.toBeNull();

    act(() => {
      about!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      );
    });

    expect(window.location.pathname).toBe("/about");
    expect(container.textContent).toContain("About Pocketry");
    expect(container.textContent).toContain("AGPL-3.0-only");
    expect(container.textContent).toContain("OpenCV/OpenCV.js");
    expect(container.textContent).toContain("Gridfinity Rebuilt OpenSCAD");
    expect(container.textContent).toContain("Gridfinity Extended");
    expect(container.textContent).toContain("Gridfinity Layout Tool");
    expect(container.textContent).toContain("Outline App");
    expect(container.textContent).toContain("Tracefinity");
    expect(container.textContent).toContain("Perplexing Labs Gridfinity Generator");
    expect(container.textContent).toContain("ToolTrace.ai");
    expect(container.textContent).toContain("Systemax DIY");
    expect(container.textContent).toContain("Gridfinity Rebase");
    expect(container.textContent).toContain("GridFlock");
    expect(container.textContent).toContain(
      "complement Pocketry or provide",
    );
    const openSourceProjects = container.querySelector<HTMLElement>(
      '[aria-labelledby="open-source-projects-heading"]',
    );
    const closedSourceTools = container.querySelector<HTMLElement>(
      '[aria-labelledby="closed-source-projects-heading"]',
    );
    expect(openSourceProjects?.textContent).toContain("Tracefinity");
    expect(openSourceProjects?.textContent).toContain("GridFlock");
    expect(openSourceProjects?.textContent).not.toContain("Perplexing Labs");
    expect(openSourceProjects?.textContent).not.toContain("ToolTrace.ai");
    expect(openSourceProjects?.textContent).not.toContain("Systemax DIY");
    expect(closedSourceTools?.textContent).toContain("Perplexing Labs");
    expect(closedSourceTools?.textContent).toContain("ToolTrace.ai");
    expect(closedSourceTools?.textContent).toContain("Systemax DIY");
    expect(closedSourceTools?.textContent).not.toContain("Tracefinity");
    expect(closedSourceTools?.textContent).toContain(
      "not presented as open-source projects",
    );
    expect(container.textContent).not.toContain("Visit open-source project");
    expect(container.textContent).not.toContain("Visit service");
    for (const [name, href] of [
      ["GridFlock", "https://github.com/yawkat/GridFlock"],
      [
        "Perplexing Labs Gridfinity Generator",
        "https://gridfinity.perplexinglabs.com/",
      ],
    ] as const) {
      const titleLink = container.querySelector<HTMLAnchorElement>(
        `h3 > a[href="${href}"]`,
      );
      expect(titleLink?.textContent).toContain(name);
      expect(titleLink?.target).toBe("_blank");
    }
    expect(
      container.querySelector<HTMLAnchorElement>('a[href="/LICENSE.txt"]'),
    ).not.toBeNull();
    expect(
      container.querySelector<HTMLAnchorElement>('a[href="/NOTICE.txt"]'),
    ).not.toBeNull();
    expect(container.querySelector('[aria-label="Hide controls"]')).toBeNull();
  });

  it("no longer registers the retired Baseplate route", () => {
    window.history.replaceState(null, "", "/baseplate");
    renderApp();
    expect(container.textContent).toContain("404 Page Not Found");
    expect(container.querySelector("nav")?.textContent).not.toContain(
      "Baseplate",
    );
  });

  it("shows the empty state before an image is loaded", () => {
    renderApp();
    // The dropzone belongs in the empty canvas, not in the controls panel.
    expect(container.textContent).toContain("Trace a tool from a photo");
    expect(container.textContent).toContain("Drag & drop an image here");
    expect(container.textContent).not.toContain("Untitled");
    expect(container.textContent).not.toContain("0 × 0 px");
    expect(
      container.querySelector('[data-testid="button-source-image"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("Replace image");
  });

  it("documents the current Trace, Bin, project, and export workflows", () => {
    renderApp();
    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Help"]')!.click();
    });
    const help = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(help?.textContent).toContain("Trace a tool");
    expect(help?.textContent).toContain("Design the bin");
    expect(help?.textContent).toContain("Save and resume projects");
    expect(help?.textContent).toContain("3MF");
    expect(help?.textContent).toContain("2D Layout view");
    expect(help?.textContent).toContain(
      "automatically looks for its calibration-sheet markers",
    );
    expect(help?.textContent).toContain(
      "paper size is identified automatically",
    );
    expect(
      help?.querySelector('[data-testid="help-print-template-a4"]'),
    ).not.toBeNull();
    expect(
      help?.querySelector('[data-testid="help-print-template-letter"]'),
    ).not.toBeNull();
    expect(help?.textContent).toContain("another item with a precisely known dimension");
    expect(help?.textContent).toContain("Before printing the full bin");
    expect(help?.textContent).toContain("Preview/shadow-board layout");
    expect(help?.textContent).not.toContain(
      "Any Bin clearance is an additional offset",
    );
    expect(help?.textContent).not.toContain("Baseplate");
  });

  it("fills the viewport instead of a fixed-width column", () => {
    renderApp();
    // The regression guard for the reported layout problem: the old page was
    // capped at max-w-4xl (896px) inside `container mx-auto`.
    const html = container.innerHTML;
    expect(html).not.toContain("max-w-4xl");
    expect(html).toContain("h-dvh");
  });

  it("exposes the panel toggle, so a collapsed panel can be recovered", () => {
    renderApp();
    // WorkspaceLayout persists panel size in localStorage; without a visible
    // toggle a user who collapses it has no way back on the next visit.
    const toggle = container.querySelector('[aria-label="Hide controls"]');
    expect(toggle).not.toBeNull();
  });

  it("renders the controls panel sections", () => {
    renderApp();
    const text = container.textContent ?? "";
    for (const section of [
      "Source image",
      "Tool Detection",
      "Edit contours",
      "Scale",
      "Set Detection Region",
      "Output",
    ]) {
      expect(text).toContain(section);
    }
  });

  it("keeps trace settings scannable and visibly gates later workflow steps", () => {
    renderApp();

    const index = container.querySelector('[data-testid="trace-settings-index"]');
    expect(index?.textContent).toContain("Find a setting");
    expect(index?.textContent).not.toContain("Color by purpose");

    for (const [id, tone, state] of [
      ["trace-settings-source", "slate", "open"],
      ["trace-settings-scale", "amber", "closed"],
      ["trace-settings-detect", "blue", "closed"],
      ["trace-settings-contours", "violet", "closed"],
      ["trace-settings-crop", "rose", "closed"],
      ["trace-settings-output", "emerald", "closed"],
    ] as const) {
      const section = container.querySelector<HTMLElement>(`#${id}`);
      expect(section?.dataset.tone).toBe(tone);
      expect(section?.dataset.state).toBe(state);
    }
    const tones = [
      ...container.querySelectorAll<HTMLElement>('[id^="trace-settings-"]'),
    ].map((section) => section.dataset.tone);
    expect(new Set(tones).size).toBe(tones.length);
    expect(
      [...container.querySelectorAll<HTMLElement>("#trace-settings-source, #trace-settings-scale, #trace-settings-detect, #trace-settings-contours")]
        .map((section) => section.id),
    ).toEqual([
      "trace-settings-source",
      "trace-settings-scale",
      "trace-settings-detect",
      "trace-settings-contours",
    ]);

    for (const section of ["scale", "crop", "detect", "contours", "output"]) {
      const jump = container.querySelector<HTMLButtonElement>(
        `[aria-controls="trace-settings-${section}"]`,
      );
      expect(jump?.disabled).toBe(true);
      expect(jump?.title).toContain("source image");
    }
    openTraceSettings("output");
    expect(
      container.querySelector<HTMLElement>("#trace-settings-output")?.dataset
        .state,
    ).toBe("closed");
  });

  it("does not expose detection controls before source and scale", () => {
    renderApp();
    openTraceSettings("detect");
    expect(
      container.querySelector("#trace-settings-detect")?.getAttribute("data-state"),
    ).toBe("closed");
    expect(container.textContent).not.toContain("Sensitivity");
    expect(container.querySelector("#margin")).toBeNull();
  });

  it("disables export until something has been traced", () => {
    renderApp();
    const buttons = [...container.querySelectorAll("button")];
    const save = buttons.find((b) => b.textContent?.includes("Save"));
    expect(save).toBeDefined();
    expect(save?.disabled).toBe(true);
  });

  it("gates Add to bin behind a trace and a calibration", () => {
    renderApp();
    const addToBin = container.querySelector(
      '[data-testid="button-add-to-bin"]',
    ) as HTMLButtonElement | null;
    expect(addToBin).not.toBeNull();
    expect(addToBin!.disabled).toBe(true);
  });

  it("does not leave a stale ruler-calibration DOM channel behind", () => {
    renderApp();
    // Exports used to read the scale back out of this attribute with
    // document.querySelector, silently losing it whenever the overlay
    // unmounted. Calibration now lives in the store.
    expect(container.querySelector("[data-ruler-calibration]")).toBeNull();
  });

  it("keeps the active Trace session across Bin navigation", () => {
    renderApp();
    expect(
      container.querySelector("#trace-settings-source")?.getAttribute("data-state"),
    ).toBe("open");

    clickWorkspace("Bin");
    expect(window.location.pathname).toBe("/bin");
    clickWorkspace("Trace");
    expect(window.location.pathname).toBe("/");
    expect(container.textContent).toContain("Trace a tool from a photo");
    expect(
      container.querySelector("#trace-settings-source")?.getAttribute("data-state"),
    ).toBe("open");
  });
});
