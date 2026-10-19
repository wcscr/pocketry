import { renderPage, openSettingsSection } from "./bin-designer.test-support";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { WORKSPACES } from "@/components/layout/workspaces";

describe("BinDesignerPage", () => {

  it("is registered as the /bin workspace", () => {
    const entry = WORKSPACES.find((workspace) => workspace.path === "/bin");
    expect(entry).toBeDefined();
    expect(entry!.label).toBe("Bin");
  });

  it("renders the size and feature controls with computed dimensions", () => {
    const { container, unmount } = renderPage();
    const sizeText = container.textContent ?? "";
    for (const label of ["Bin size", "Grid pitch", "Width", "Length", "Height"]) {
      expect(sizeText).toContain(label);
    }
    // Default 2×2×6: 83.5 × 83.5, 42 + 3.55 lip.
    expect(sizeText).toContain("83.5");
    expect(sizeText).toContain("45.6 mm");

    openSettingsSection(container, "construction");
    const constructionText = container.textContent ?? "";
    for (const label of [
      "Stacking lip",
      "Solid fill",
      "Magnet holes",
      "Screw holes",
    ]) {
      expect(constructionText).toContain(label);
    }
    expect(constructionText).not.toContain("Lite base");
    unmount();
  });

  it("explains the empty Layout and keeps both rulers unavailable", () => {
    const { container, unmount } = renderPage();
    const ruler3d = container.querySelector(
      '[data-testid="button-3d-ruler"]',
    ) as HTMLButtonElement;
    expect(ruler3d).not.toBeNull();
    expect(ruler3d.disabled).toBe(true);
    expect(container.querySelector('[data-testid="button-layout-ruler"]')).toBeNull();

    React.act(() => {
      (
        container.querySelector('[data-testid="view-toggle-2d"]') as HTMLButtonElement
      ).click();
    });
    const ruler = container.querySelector(
      '[data-testid="button-layout-ruler"]',
    ) as HTMLButtonElement;
    expect(ruler).not.toBeNull();
    expect(ruler.getAttribute("aria-pressed")).toBe("false");
    expect(ruler.disabled).toBe(true);
    expect(ruler.title).toContain("Add a tool cutout");
    expect(
      container.querySelector('[data-testid="layout-empty-state"]')?.textContent,
    ).toContain("Use Add pocket to draw a shape");
    expect(container.querySelector('[data-testid="layout-ruler-status"]')).toBeNull();
    expect(container.textContent).toContain("Choose Add pocket to draw a shape");
    unmount();
  });

  it("shows build stats and enabled export buttons, viewport stubbed in", () => {
    const { container, unmount } = renderPage();
    openSettingsSection(container, "export");
    const text = container.textContent ?? "";

    expect(text).toContain("8,400 triangles");
    expect(text).toContain("82.4 cm³ model volume");
    expect(text).not.toContain("g solid PLA");
    expect(text).not.toContain("Estimate filament weight in your slicer");
    expect(container.querySelector('[aria-label="About model validation"]')).not.toBeNull();
    expect(
      container.querySelector("#bin-settings-export [data-panel-section-trigger]")
        ?.textContent,
    ).toContain("No cutouts");
    expect(
      container.querySelector('[data-testid="export-no-cutouts-warning"]')
        ?.textContent,
    ).toContain("Solid fill is enabled at 100% height");
    expect(container.querySelector('[data-testid="bin-viewport-stub"]')).not.toBeNull();

    const export3mf = container.querySelector(
      '[data-testid="button-export-3mf"]',
    ) as HTMLButtonElement | null;
    expect(export3mf).not.toBeNull();
    expect(export3mf!.disabled).toBe(false);
    expect(
      (container.querySelector('[data-testid="button-export-stl"]') as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    openSettingsSection(container, "check-fit");
    expect(
      container.querySelector('[data-testid="export-preview-empty"]')?.textContent,
    ).toContain("Add a tool cutout");
    expect(
      container.querySelector('[data-testid="button-go-to-trace"]'),
    ).not.toBeNull();
    unmount();
  });

  it("counts only color regions that exist in the current model", () => {
    const { container, unmount } = renderPage();
    expect(container.querySelector('[data-testid="bin-settings-jump-materials-&-colors"]')?.textContent)
      .toBe("Materials & Colors");
    React.act(() => {
      (
        container.querySelector(
          '[data-testid="bin-settings-jump-materials-&-colors"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(
      container.querySelector("#bin-settings-materials [data-panel-section-trigger]")
        ?.textContent,
    ).toContain("2 colors");
    expect(container.querySelector("#bin-settings-materials [data-panel-section-trigger]")?.textContent)
      .toContain("Materials & Colors");
    unmount();
  });});
