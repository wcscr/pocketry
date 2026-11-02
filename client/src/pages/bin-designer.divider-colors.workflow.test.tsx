import { EMPTY_PROJECT, binHistoryButton, flushHydration, openConstructionGroup, openSettingsSection, renderPage } from "./bin-designer.test-support";
import * as React from "react";
import { expect, it, vi } from "vitest";
import { DEFAULT_BIN_MATERIALS } from "@shared/gridfinity/materials";
import { parseBinSpec } from "@shared/gridfinity/types";
import { useBinGeometry } from "@/lib/gridfinity/use-bin-geometry";
import * as ProjectPersistence from "@/lib/project/persist";

const contexts = [
  { layout: "standard", mobile: false }, { layout: "workflow", mobile: false },
  { layout: "standard", mobile: true }, { layout: "workflow", mobile: true },
] as const;
const click = (container: ParentNode, selector: string) => React.act(() => container.querySelector<HTMLButtonElement>(selector)!.click());
async function finishNavigation() {
  for (let frame = 0; frame < 6; frame++) await React.act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
}
function openCompartments(container: HTMLElement, mobile: boolean) {
  if (mobile) {
    const workflow = container.querySelector<HTMLElement>('#workflow-panel');
    const properties = container.querySelector<HTMLElement>(workflow ? '#objects-panel' : '[data-testid="mobile-properties-panel"]')!;
    if (workflow?.hidden || !workflow && properties.hidden) {
      if (workflow && !properties.hidden) click(properties, '[data-testid="button-back-to-canvas"]');
      React.act(() => [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "Workflow")!.click());
    }
  }
  openSettingsSection(container, "construction");
  openConstructionGroup(container, "compartments");
}

it.each(contexts.flatMap(context => [true, false].map(rimOn => ({ ...context, rimOn }))))(
  "Divider colors opens its existing option without edits in $layout (mobile: $mobile, rim on: $rimOn)",
  async ({ layout, mobile, rimOn }) => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const spec = parseBinSpec({ ...EMPTY_PROJECT.spec, fill: "none", lip: layout === "standard" ? "standard" : "none", compartments: { enabled: true, rows: 2, columns: 3 } });
    // Also cover retaining an existing divider choice while rim coloring is off.
    const materials = { ...DEFAULT_BIN_MATERIALS, colorStackingRim: rimOn, colorDividerTops: !rimOn };
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec, materials });
    const { container, unmount } = renderPage({ mobile });
    try {
      await flushHydration();
      for (const view of ["3d", "2d"]) {
        click(container, `[data-testid="view-toggle-${view}"]`);
        const canvasSelector = view === "3d" ? '[data-testid="bin-viewport-stub"]' : '[data-testid="layout-canvas"]';
        const canvas = container.querySelector(canvasSelector);
        openCompartments(container, mobile);
        const link = container.querySelector<HTMLButtonElement>('[data-testid="button-divider-colors"]')!;
        expect(link.closest('[hidden]')).toBeNull();
        React.act(() => {
          link.focus();
          link.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
          // jsdom does not synthesize a native button click from Enter.
          link.click();
        });
        await finishNavigation();
        const option = container.querySelector<HTMLButtonElement>('#color-divider-tops')!;
        expect(option.getAttribute("aria-label")).toBe("Match divider tops to rim color");
        expect(option.closest('[hidden]')).toBeNull();
        expect(document.activeElement).toBe(rimOn ? option : container.querySelector('#divider-top-colors'));
        expect(option.disabled).toBe(!rimOn);
        expect(option.getAttribute("aria-checked")).toBe(String(materials.colorDividerTops));
        if (!rimOn) expect(container.querySelector('#divider-top-colors-help')!.textContent).toContain(layout === "standard" ? "Color stacking rim top" : "Color top border");
        expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toEqual(spec);
        expect(vi.mocked(useBinGeometry).mock.lastCall![4]?.colorDividerTops).toBe(materials.colorDividerTops);
        expect(container.querySelector(canvasSelector)).toBe(canvas);
        expect(binHistoryButton(container, "undo").disabled).toBe(true);
        const menu = document.querySelector('[role="menu"]');
        if (menu) React.act(() => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      }
    } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
  },
);

it.each(["standard", "workflow"])("a newer destination cancels pending Divider colors navigation in %s", async layout => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, "", `/bin?layout=${layout}`);
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
    spec: parseBinSpec({ ...EMPTY_PROJECT.spec, fill: "none", compartments: { enabled: true, rows: 2, columns: 2 } }),
  });
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    openCompartments(container, false);
    click(container, '[data-testid="button-divider-colors"]');
    React.act(() => document.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    openSettingsSection(container, "size");
    const target = container.querySelector<HTMLInputElement>('#bin-height-units')!;
    React.act(() => target.focus());
    await finishNavigation();
    expect(target.closest('[hidden]')).toBeNull();
    expect(document.activeElement).toBe(target);
    const previousTarget = container.querySelector('#color-divider-tops');
    expect(!previousTarget || !!previousTarget.closest('[hidden]')).toBe(true);
    if (layout === "workflow") expect(container.querySelector('[data-testid="inspector-properties-header"] h3')!.textContent).toBe("Bin size");
  } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
});

it.each([
  { fill: "solid", enabled: true, rows: 2 },
  { fill: "none", enabled: false, rows: 2 },
  { fill: "none", enabled: true, rows: 1 },
] as const)("does not offer an unavailable divider-color destination ($fill, enabled: $enabled, rows: $rows)", async configuration => {
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
    spec: parseBinSpec({ ...EMPTY_PROJECT.spec, fill: configuration.fill, compartments: { enabled: configuration.enabled, rows: configuration.rows, columns: 1 } }),
  });
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    openCompartments(container, false);
    expect(container.querySelector('[data-testid="button-divider-colors"]')).toBeNull();
    openSettingsSection(container, "materials");
    expect(container.querySelector('#color-divider-tops')).toBeNull();
  } finally { unmount(); }
});
