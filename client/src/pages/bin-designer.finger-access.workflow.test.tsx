import {
  EMPTY_PROJECT,
  rectangularShape,
  flushHydration,
  renderPage,
  openSettingsSection,
  clickBinHistory,
} from "./bin-designer.test-support";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { parseProjectDoc } from "@shared/gridfinity/project";
import { fingerHoleSchema, parseCutoutPlacement } from "@shared/gridfinity/cutout";
import { useBinGeometry } from "@/lib/gridfinity/use-bin-geometry";
import * as ProjectPersistence from "@/lib/project/persist";

describe("BinDesignerPage", () => {

  it.each(["straight", "scoop", "deep-scoop", "oblong-deep-scoop", "flat-ended-scoop", "oblong-straight", "flat-ended-straight"] as const)("edits %s at 1 mm depth without a duplicate heading", async (kind) => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, fingerHoles: [fingerHoleSchema.parse({ id: "shallow", kind, center: { x: 0, y: 0 }, depthMm: 12, lengthMm: 40 })],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "finger-holes");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-select-finger-hole-shallow"]')!.click());
    const properties = container.querySelector('#finger-access-properties')!;
    expect(properties.textContent).toContain("Shape");
    expect(properties.querySelector('[aria-label="Finger access depth"] h4')).toBeNull();
    const input = properties.querySelector<HTMLInputElement>('[aria-label="Depth in millimetres"]')!;
    expect(input.min).toBe("1");
    React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "1");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    React.act(() => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(input.value).toBe("1");
    expect(vi.mocked(useBinGeometry).mock.lastCall?.[2]?.fingerHoles?.[0]).toMatchObject({ kind: kind === "scoop" ? "deep-scoop" : kind, depthMm: 1 });
    unmount();
  });

  it("groups finger access like pockets and supports renaming, undo, and cancellation", async () => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT,
      fingerHoles: [fingerHoleSchema.parse({ id: "named-hole", center: { x: 0, y: 0 } })],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "finger-holes");
    const select = () => container.querySelector<HTMLButtonElement>('[data-testid="button-select-finger-hole-named-hole"]')!;
    React.act(() => select().click());
    expect(select().getAttribute("aria-pressed")).toBe("true");
    const properties = container.querySelector("#finger-access-properties")!;
    expect(properties.firstElementChild?.textContent).toContain("Finger access properties");
    expect(properties.querySelector('[aria-label="Depth in millimetres"]')!.closest('details')).toBeNull();
    for (const id of ["finger-size-settings", "finger-edge-settings", "finger-position-settings"]) {
      expect(properties.querySelector<HTMLDetailsElement>(`[data-testid="${id}"]`)!.open).toBe(false);
    }
    expect(properties.lastElementChild?.getAttribute("data-testid")).toBe("linked-copies-disclosure");
    expect(properties.lastElementChild?.previousElementSibling?.getAttribute("data-testid")).toBe("finger-position-settings");
    expect((properties.lastElementChild as HTMLDetailsElement).open).toBe(false);
    const editName = (value: string) => {
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-rename-finger-hole-named-hole"]')!.click());
      const input = container.querySelector<HTMLInputElement>('[aria-label="Finger access name"]')!;
      React.act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      return input;
    };
    let input = editName("  Thumb access  ");
    React.act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(select().textContent).toBe("Thumb access");
    expect(properties.firstElementChild?.textContent).toContain("Thumb access");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(select().textContent).toBe("Finger access 1");
    clickBinHistory(container, "redo");
    expect(select().textContent).toBe("Thumb access");
    input = editName("Cancelled name");
    React.act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(select().textContent).toBe("Thumb access");
    input = editName("   ");
    React.act(() => input.blur());
    expect(select().textContent).toBe("Thumb access");
    unmount();
  });

  it.each(["flat-ended-scoop", "flat-ended-straight"] as const)("edits %s corner rounding with size limits, undo, and retained shape preferences", async (kind) => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
      fingerHoles: [fingerHoleSchema.parse({ id: "corners", kind, center: { x: 0, y: 0 }, diameterMm: 24, lengthMm: 16, depthMm: 20 })],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "finger-holes");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-select-finger-hole-corners"]')!.click());
    const input = () => container.querySelector<HTMLInputElement>('[aria-label="Corner round in millimetres"]');
    const current = () => vi.mocked(useBinGeometry).mock.lastCall?.[2]?.fingerHoles?.[0];
    const edit = (label: string, value: string) => {
      const field = container.querySelector<HTMLInputElement>(`#finger-access-properties [aria-label="${label} in millimetres"]`)!;
      React.act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
      React.act(() => field.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    };
    expect(input()!.closest("details")?.getAttribute("data-testid")).toBe("finger-edge-settings");
    expect(input()!.value).toBe("0");
    expect(input()!.max).toBe("8");
    edit("Corner round", "5");
    expect(current()?.cornerRoundMm).toBe(5);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(input()!.value).toBe("0");
    clickBinHistory(container, "redo");
    expect(input()!.value).toBe("5");
    edit("Width", "6");
    expect(input()!.max).toBe("3");
    expect(input()!.value).toBe("3");
    expect(current()?.cornerRoundMm).toBe(5);
    edit("Width", "24");
    expect(input()!.value).toBe("5");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="finger-ends-rounded"]')!.click());
    expect(input()).toBeNull();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="finger-ends-flat"]')!.click());
    expect(input()!.value).toBe("5");
    edit("Corner round", "99");
    expect(input()!.value).toBe("5");
    edit("Corner round", "8");
    expect(input()!.value).toBe("8");
    expect(parseProjectDoc({ ...EMPTY_PROJECT, fingerHoles: [current()] })?.fingerHoles[0].cornerRoundMm).toBe(8);
    unmount();
  });

  it("switches all six shape combinations without losing dimensions and undoes the change", async () => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
      fingerHoles: [fingerHoleSchema.parse({ id: "styles", kind: "straight", center: { x: 0, y: 0 }, diameterMm: 18, depthMm: 30, lengthMm: 40, rotationDeg: 37, bottomFilletMm: 2 })],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "finger-holes");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-select-finger-hole-styles"]')!.click());
    const current = () => vi.mocked(useBinGeometry).mock.lastCall?.[2]?.fingerHoles?.[0];
    expect(container.querySelector('[data-testid="finger-ends-flat"]')).toBeNull();
    for (const [option, kind] of [["bottom-curved", "deep-scoop"], ["shape-slot", "oblong-deep-scoop"],
      ["ends-flat", "flat-ended-scoop"], ["bottom-flat", "flat-ended-straight"],
      ["ends-rounded", "oblong-straight"], ["shape-round", "straight"]] as const) {
      React.act(() => container.querySelector<HTMLButtonElement>(`[data-testid="finger-${option}"]`)!.click());
      expect(current()).toMatchObject({ kind, depthMm: 30, diameterMm: 18, lengthMm: 40, rotationDeg: 37, bottomFilletMm: 2 });
      expect(container.querySelector('[data-testid="finger-access-shape-controls"] [role="img"]')).not.toBeNull();
      const bottomRound = container.querySelector('#finger-access-properties [aria-label="Bottom edge round"]');
      expect(bottomRound !== null).toBe(kind.endsWith("straight"));
    }
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(current()).toMatchObject({ kind: "oblong-straight", depthMm: 30 });
    expect(container.querySelector('[data-testid="finger-ends-rounded"]')?.getAttribute("aria-checked")).toBe("true");
    unmount();
  });

  it.each(["scoop", "oblong-deep-scoop", "flat-ended-scoop"] as const)("keeps saved %s geometry until edited and allows an 80 mm opening", async (kind) => {
    const original = fingerHoleSchema.parse({ id: "wide", kind, center: { x: 0, y: 0 }, diameterMm: 18, depthMm: 8, lengthMm: 40 });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, fingerHoles: [original] });
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "finger-holes");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-select-finger-hole-wide"]')!.click());
    expect(vi.mocked(useBinGeometry).mock.lastCall?.[2]?.fingerHoles?.[0]).toEqual(original);
    const input = container.querySelector<HTMLInputElement>(`#finger-access-properties [aria-label="${kind === "scoop" ? "Diameter" : "Width"} in millimetres"]`)!;
    expect(input.max).toBe(kind === "scoop" ? "83.5" : "80");
    React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "80");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    React.act(() => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    const updated = vi.mocked(useBinGeometry).mock.lastCall?.[2]?.fingerHoles?.[0];
    expect(updated).toMatchObject({ diameterMm: 80, depthMm: 8, kind: kind === "scoop" ? "deep-scoop" : kind });
    expect(parseProjectDoc({ ...EMPTY_PROJECT, fingerHoles: [updated] })?.fingerHoles[0]).toEqual(updated);
    unmount();
  });

  it.each(["straight", "scoop", "deep-scoop"] as const)("edits large %s diameters up to bin width with slider, persistence and undo", async (kind) => {
    const project = { ...EMPTY_PROJECT, spec: { ...EMPTY_PROJECT.spec, gridX: 4, gridY: 2 },
      fingerHoles: [fingerHoleSchema.parse({ id: "large-round", kind, center: { x: 0, y: 0 }, diameterMm: 18, depthMm: 1 })] };
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(project);
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "finger-holes");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-select-finger-hole-large-round"]')!.click());
    const field = () => container.querySelector<HTMLInputElement>('[aria-label="Diameter in millimetres"]')!;
    const current = () => vi.mocked(useBinGeometry).mock.lastCall?.[2]?.fingerHoles?.[0];
    const edit = (value: string) => {
      React.act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field(), value);
        field().dispatchEvent(new Event("input", { bubbles: true }));
      });
      React.act(() => field().dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    };
    expect(field().max).toBe("167.5");
    edit("150");
    expect(current()).toMatchObject({ diameterMm: 150, depthMm: 1 });
    edit("168");
    expect(field().value).toBe("150");
    const slider = container.querySelector<HTMLElement>('[role="slider"][aria-label="Diameter"]')!;
    React.act(() => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(field().value).toBe("167.5");
    expect(current()).toMatchObject({ diameterMm: 167.5, depthMm: 1 });
    expect(parseProjectDoc(JSON.parse(JSON.stringify({ ...project, fingerHoles: [current()] })))?.fingerHoles[0]).toEqual(current());
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(field().value).toBe("150");
    unmount();
  });

  it.each(["oblong-deep-scoop", "flat-ended-scoop", "oblong-straight", "flat-ended-straight"] as const)(
    "edits a 193 mm %s groove with slider, persistence and undo", async (kind) => {
      const project = { ...EMPTY_PROJECT, spec: { ...EMPTY_PROJECT.spec, gridX: 5, gridY: 5 },
        fingerHoles: [fingerHoleSchema.parse({ id: "long-slot", kind, center: { x: 0, y: 0 }, diameterMm: 23, depthMm: 10, lengthMm: 107 })] };
      vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(project);
      const { container, unmount } = renderPage();
      await flushHydration();
      openSettingsSection(container, "finger-holes");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-select-finger-hole-long-slot"]')!.click());
      const field = () => container.querySelector<HTMLInputElement>('[aria-label="Length in millimetres"]')!;
      const current = () => vi.mocked(useBinGeometry).mock.lastCall?.[2]?.fingerHoles?.[0];
      const edit = (value: string) => {
        React.act(() => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field(), value);
          field().dispatchEvent(new Event("input", { bubbles: true }));
        });
        React.act(() => field().dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
      };
      expect(field().max).toBe("219.97");
      edit("193");
      expect(current()).toMatchObject({ lengthMm: 193, diameterMm: 23, depthMm: 10 });
      expect(parseProjectDoc(JSON.parse(JSON.stringify({ ...project, fingerHoles: [current()] })))?.fingerHoles[0]).toEqual(current());
      edit("220");
      expect(field().value).toBe("193");
      const slider = container.querySelector<HTMLElement>('[role="slider"][aria-label="Length"]')!;
      React.act(() => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
      expect(field().value).toBe("219.97");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(field().value).toBe("193");
      unmount();
    },
  );

  it("updates finger-access field limits with bin height and slot rotation, rejecting oversized input", async () => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
      spec: { ...EMPTY_PROJECT.spec, gridX: 1, gridY: 2, heightUnits: 2 },
      fingerHoles: [fingerHoleSchema.parse({ id: "limits", kind: "flat-ended-straight", center: { x: 0, y: 0 }, diameterMm: 18, lengthMm: 30, depthMm: 12 })],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "finger-holes");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-select-finger-hole-limits"]')!.click());
    const input = (name: string) => container.querySelector<HTMLInputElement>(`[aria-label="${name}"]`)!;
    const setNumber = (name: string, value: string) => {
      const field = input(name);
      React.act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
      React.act(() => field.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    };
    expect(input("Depth in millimetres").max).toBe("12.8");
    const slider = container.querySelector<HTMLElement>('[role="slider"][aria-label="Depth"]')!;
    expect(input("Length in millimetres").max).toBe("43.57");
    expect(input("Width in millimetres").max).toBe("80");
    setNumber("Depth in millimetres", "20");
    expect(input("Depth in millimetres").value).toBe("12");
    setNumber("Length in millimetres", "100");
    expect(input("Length in millimetres").value).toBe("30");
    setNumber("Elongated finger access rotation", "90");
    expect(input("Length in millimetres").max).toBe("87.67");
    expect(input("Width in millimetres").max).toBe("43.57");
    React.act(() => container.querySelector<HTMLButtonElement>('#bin-settings-size [data-panel-section-trigger]')!.click());
    setNumber("Bin height in units", "1");
    expect(input("Depth in millimetres").max).toBe("5.8");
    expect(input("Depth in millimetres").value).toBe("5.8");
    expect(vi.mocked(useBinGeometry).mock.lastCall?.[2]?.fingerHoles?.[0].depthMm).toBe(5.8);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(input("Bin height in units").value).toBe("2");
    expect(input("Depth in millimetres").value).toBe("12");
    React.act(() => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(input("Depth in millimetres").value).toBe("12.8");
    expect(vi.mocked(useBinGeometry).mock.lastCall?.[2]?.fingerHoles?.[0].depthMm).toBe(12.8);
    unmount();
  });

  it.each([
    { heightUnits: 4, lip: "standard" as const, flatBottom: false, depth: 26.8 },
    { heightUnits: 4, lip: "none" as const, flatBottom: true, depth: 28 },
    { heightUnits: 20, lip: "none" as const, flatBottom: false, depth: 120 },
  ])("keeps the depth cap without a floor indicator for $heightUnits units, $lip lip, flat bottom $flatBottom", async ({ heightUnits, lip, flatBottom, depth }) => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
      spec: { ...EMPTY_PROJECT.spec, heightUnits, lip, flatBottom },
      fingerHoles: [fingerHoleSchema.parse({ id: "floor", center: { x: 0, y: 0 }, depthMm: 12 })],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "finger-holes");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-select-finger-hole-floor"]')!.click());
    expect(container.querySelector<HTMLInputElement>('[aria-label="Depth in millimetres"]')?.max).toBe(String(depth));
    expect(container.querySelector('[data-slider-marker]')).toBeNull();
    expect(container.querySelector('[aria-label="Finger access depth"]')?.textContent).not.toContain("Base floor");
    unmount();
  });

  it("flags an oversized saved slot without silently rewriting it or inverting its length range", async () => {
    const hole = fingerHoleSchema.parse({ id: "old-large", kind: "oblong-straight", center: { x: 0, y: 0 }, diameterMm: 80, lengthMm: 160, depthMm: 120 });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
      spec: { ...EMPTY_PROJECT.spec, gridX: 1, gridY: 1, heightUnits: 1 }, fingerHoles: [hole],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "finger-holes");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-select-finger-hole-old-large"]')!.click());
    expect(container.querySelector('#finger-access-properties')?.textContent).toContain("Opening exceeds this bin's size limits.");
    expect(vi.mocked(useBinGeometry).mock.lastCall?.[2]?.fingerHoles?.[0]).toEqual(hole);
    const length = container.querySelector<HTMLInputElement>('[aria-label="Length in millimetres"]')!;
    expect(Number(length.min)).toBeLessThanOrEqual(Number(length.max));
    unmount();
  });

  it("shows effective shallow rounding and restores the requested radii when depth increases", async () => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
      fingerHoles: [fingerHoleSchema.parse({ id: "rounding", center: { x: 0, y: 0 }, depthMm: 1, topFilletMm: 1, bottomFilletMm: 2 })],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "finger-holes");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-select-finger-hole-rounding"]')!.click());
    for (const label of ["Top edge round", "Bottom edge round"]) {
      const input = container.querySelector<HTMLInputElement>(`[aria-label="${label} in millimetres"]`)!;
      expect(input.value).toBe("0.5");
      expect(input.max).toBe("0.5");
    }
    expect(container.textContent).toContain("Requested 1 mm; limited by depth.");
    const depth = container.querySelector<HTMLInputElement>('[aria-label="Depth in millimetres"]')!;
    React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(depth, "12");
      depth.dispatchEvent(new Event("input", { bubbles: true }));
    });
    React.act(() => depth.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(container.querySelector<HTMLInputElement>('[aria-label="Top edge round in millimetres"]')!.value).toBe("1");
    expect(container.querySelector<HTMLInputElement>('[aria-label="Bottom edge round in millimetres"]')!.value).toBe("2");
    expect(vi.mocked(useBinGeometry).mock.lastCall?.[2]?.fingerHoles?.[0]).toMatchObject({ depthMm: 12, topFilletMm: 1, bottomFilletMm: 2 });
    unmount();
  });

  it("restores a deep finger scoop as Round with a curved bottom without changing geometry", async () => {
    const shape = rectangularShape("shape-deep", "Deep pliers");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT,
      shapes: [shape],
      cutouts: [
        parseCutoutPlacement({
          id: "cutout-deep",
          shapeId: shape.id,
          position: { x: 0, y: 0 },
        }),
      ],
      fingerHoles: [
        {
          id: "finger-deep",
          kind: "deep-scoop",
          center: { x: 15, y: 0 },
          diameterMm: 16,
          depthMm: 30,
          topFilletMm: 0,
          bottomFilletMm: 0,
        },
      ],
    });

    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "finger-holes");
    React.act(() => {
      (
        container.querySelector(
          '[data-testid="button-select-finger-hole-finger-deep"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(
      container.querySelector('[data-testid="finger-shape-round"]')?.getAttribute("aria-checked"),
    ).toBe("true");
    expect(container.querySelector('[data-testid="finger-bottom-curved"]')?.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector('[aria-label="Diameter"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Depth"]')).not.toBeNull();
    const fingerHoleSection = container.querySelector(
      '#bin-settings-finger-holes',
    );
    expect(
      fingerHoleSection?.querySelector('[aria-label="Top edge round"]'),
    ).not.toBeNull();
    expect(
      fingerHoleSection?.querySelector('[aria-label="Bottom edge round"]'),
    ).toBeNull();
    expect(container.querySelector('[aria-label="Reach"]')).toBeNull();
    expect(vi.mocked(useBinGeometry).mock.lastCall?.[2]?.fingerHoles?.[0]).toMatchObject({ kind: "deep-scoop", depthMm: 30, diameterMm: 16 });

    React.act(() => {
      (container.querySelector('[data-testid="view-toggle-2d"]') as HTMLButtonElement).click();
    });
    expect(
      container.querySelector('[data-testid="finger-hole-deep-scoop-finger-deep"]'),
    ).not.toBeNull();
    unmount();
  });

  it.each([
    ["oblong-deep-scoop", 30], ["flat-ended-scoop", 30], ["flat-ended-scoop", 1],
    ["oblong-straight", 1], ["flat-ended-straight", 30],
  ] as const)("restores %s with rotation controls and endpoint handles", async (kind, depthMm) => {
    const shape = rectangularShape("shape-oblong-deep", "Long pliers");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT,
      shapes: [shape],
      cutouts: [
        parseCutoutPlacement({
          id: "cutout-oblong-deep",
          shapeId: shape.id,
          position: { x: 0, y: 0 },
        }),
      ],
      fingerHoles: [
        {
          id: "finger-oblong-deep",
          kind,
          center: { x: 0, y: 15 },
          diameterMm: 12,
          depthMm,
          lengthMm: 40,
          rotationDeg: 0,
          topFilletMm: 0,
          bottomFilletMm: 0,
        },
      ],
    });

    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "finger-holes");
    React.act(() => {
      (
        container.querySelector(
          '[data-testid="button-select-finger-hole-finger-oblong-deep"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(
      container.querySelector('[data-testid="finger-shape-slot"]')?.getAttribute("aria-checked"),
    ).toBe("true");
    expect(container.querySelector(`[data-testid="finger-ends-${kind.startsWith("flat-ended") ? "flat" : "rounded"}"]`)?.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector('#finger-access-properties [aria-label="Width"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Depth"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Length"]')).not.toBeNull();
    const rotateClockwise = container.querySelector(
      '[aria-label="Rotate elongated finger access 90 degrees clockwise"]',
    ) as HTMLButtonElement;
    expect(rotateClockwise).not.toBeNull();
    expect(
      container.querySelector(
        '[aria-label="Rotate elongated finger access 90 degrees counterclockwise"]',
      ),
    ).not.toBeNull();
    const depthInput = container.querySelector<HTMLInputElement>('[aria-label="Depth in millimetres"]')!;
    expect(depthInput.value).toBe(String(depthMm));
    expect(depthInput.min).toBe("1");

    React.act(() => {
      (container.querySelector('[data-testid="view-toggle-2d"]') as HTMLButtonElement).click();
    });
    const handle = (endpoint: "start" | "end") =>
      container.querySelector(
        `[data-testid="finger-hole-oblong-end-${endpoint}-finger-oblong-deep"]`,
      ) as SVGCircleElement;
    expect(handle("start")).not.toBeNull();
    expect(handle("end")).not.toBeNull();
    expect(
      Math.abs(Number(handle("end").getAttribute("cx")) - Number(handle("start").getAttribute("cx"))),
    ).toBeGreaterThan(10);

    React.act(() => rotateClockwise.click());
    expect(
      Math.abs(Number(handle("end").getAttribute("cy")) - Number(handle("start").getAttribute("cy"))),
    ).toBeGreaterThan(10);
    unmount();
  });});
