import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { PanelProvider } from "@/components/layout/panel-context";
import { ShapeLibraryProvider } from "@/state/shape-library";
import { parseBinSpec } from "@shared/gridfinity/types";
import { BinDesignerPage, EMPTY_PROJECT, flushHydration, openSettingsSection, render, sampleDoc } from "./bin-designer.test-support";
import { loadOpenLinkSource } from "@/lib/project/open-link";
import * as ProjectPersistence from "@/lib/project/persist";

vi.mock("@/lib/project/open-link", () => ({ loadOpenLinkSource: vi.fn() }));

const source = "https://example.com/trays.json";
const linkedDoc = { ...sampleDoc, name: "Shared tray" };
const projects = [
  { id: "first", name: "First tray", updatedAt: "2026-11-25T12:00:00Z", doc: { ...linkedDoc, name: "First tray" } },
  { id: "second", name: "Second tray", updatedAt: "2026-11-25T12:00:00Z", doc: { ...linkedDoc, name: "Second tray", spec: parseBinSpec({ ...linkedDoc.spec, gridX: 4 }) } },
];

function renderLink(projectId?: string, initialPath?: string) {
  const params = new URLSearchParams({ source });
  if (projectId !== undefined) params.set("project", projectId);
  const route = memoryLocation({ path: initialPath ?? `/bin?${params}`, record: true });
  const usePath: typeof route.hook = () => {
    const [url, navigate] = route.hook();
    return [url.split("?")[0], navigate];
  };
  const useQuery = () => route.hook()[0].split("?")[1] ?? "";
  let navigateTo: ReturnType<typeof useLocation>[1] | undefined;
  function NavigationProbe() { navigateTo = useLocation()[1]; return null; }
  const rendered = render(<Router hook={usePath} searchHook={useQuery}><PanelProvider><ShapeLibraryProvider>
    <NavigationProbe /><BinDesignerPage />
  </ShapeLibraryProvider></PanelProvider></Router>);
  return { route, container: rendered.container, reopen: () => navigateTo?.(`/bin?${params}`), navigate: (path: string) => navigateTo?.(path) };
}

async function settleLink() {
  await flushHydration();
  await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

describe("Open in Pocketry links", () => {
  it("opens a standalone project as an unnamed editable copy without a confirmation on an empty page", async () => {
    vi.mocked(loadOpenLinkSource).mockResolvedValue({ kind: "project", doc: linkedDoc });
    const { route, container } = renderLink();
    await settleLink();
    openSettingsSection(container, "project");
    expect(loadOpenLinkSource).toHaveBeenCalledOnce();
    expect(ProjectPersistence.openLinkedProjectCopy).toHaveBeenCalledExactlyOnceWith(linkedDoc);
    expect(ProjectPersistence.importProjectToLibrary).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="current-project-title"]')?.textContent).toBe("Shared tray");
    expect(document.querySelector('[data-testid="open-link-dialog"]')).toBeNull();
    expect(route.history).toEqual(["/bin"]);
  });

  it("opens only the selected project from a multi-project library", async () => {
    vi.mocked(loadOpenLinkSource).mockResolvedValue({ kind: "library", projects });
    const { container } = renderLink("second");
    await settleLink();
    openSettingsSection(container, "project");
    expect(ProjectPersistence.openLinkedProjectCopy).toHaveBeenCalledExactlyOnceWith(projects[1].doc);
    expect(document.querySelector('[data-testid="current-project-title"]')?.textContent).toBe("Second tray");
    expect(ProjectPersistence.importProjectLibrary).not.toHaveBeenCalled();
    expect(ProjectPersistence.importProjectToLibrary).not.toHaveBeenCalled();
  });

  it("shows a picker when the library URL omits project and opens the chosen copy", async () => {
    vi.mocked(loadOpenLinkSource).mockResolvedValue({ kind: "library", projects });
    const { route } = renderLink();
    await settleLink();
    expect(document.querySelector('[data-testid="open-link-project-picker"]')?.textContent).toContain("First tray");
    expect(document.querySelector('[data-testid="open-link-project-picker"]')?.textContent).toContain("Second tray");
    expect(ProjectPersistence.openLinkedProjectCopy).not.toHaveBeenCalled();
    await React.act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="open-link-project-picker"] button:nth-child(2)')!.click();
      await Promise.resolve();
    });
    expect(ProjectPersistence.openLinkedProjectCopy).toHaveBeenCalledExactlyOnceWith(projects[1].doc);
    expect(route.history).toEqual(["/bin"]);
  });

  it("shows an actionable error for a missing project ID and closes without a refetch loop", async () => {
    vi.mocked(loadOpenLinkSource).mockResolvedValue({ kind: "library", projects });
    const { route, reopen } = renderLink("missing");
    await settleLink();
    expect(document.querySelector('[data-testid="open-link-dialog"]')?.textContent).toContain("Project ID “missing” was not found");
    await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="open-link-dialog"] button')!.click());
    expect(route.history).toEqual(["/bin"]);
    expect(loadOpenLinkSource).toHaveBeenCalledOnce();
    expect(ProjectPersistence.openLinkedProjectCopy).not.toHaveBeenCalled();
    await React.act(async () => reopen());
    await settleLink();
    expect(loadOpenLinkSource).toHaveBeenCalledTimes(2);
  });

  it("keeps an existing unnamed draft until the user explicitly confirms replacement", async () => {
    const draft = { ...EMPTY_PROJECT, spec: parseBinSpec({ ...EMPTY_PROJECT.spec, gridX: 3 }) };
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(draft);
    vi.mocked(loadOpenLinkSource).mockResolvedValue({ kind: "project", doc: linkedDoc });
    renderLink();
    await settleLink();
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Replace the current draft?");
    expect(ProjectPersistence.openLinkedProjectCopy).not.toHaveBeenCalled();
    await React.act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="button-discard-draft-open"]')!.click();
      await Promise.resolve();
    });
    expect(ProjectPersistence.openLinkedProjectCopy).toHaveBeenCalledExactlyOnceWith(linkedDoc);
  });

  it("keeps the current project open when loading the source fails", async () => {
    vi.mocked(loadOpenLinkSource).mockRejectedValue(new Error("The host blocks browser access (CORS)."));
    renderLink();
    await settleLink();
    expect(document.querySelector('[data-testid="open-link-dialog"]')?.textContent).toContain("The host blocks browser access (CORS).");
    expect(ProjectPersistence.openLinkedProjectCopy).not.toHaveBeenCalled();
  });

  it("ignores an earlier fetch that settles after a different link opens", async () => {
    let resolveFirst: (value: Awaited<ReturnType<typeof loadOpenLinkSource>>) => void = () => {};
    const nextSource = "https://example.com/other.json";
    const nextDoc = { ...linkedDoc, name: "Next tray", spec: parseBinSpec({ ...linkedDoc.spec, gridX: 5 }) };
    vi.mocked(loadOpenLinkSource).mockImplementation(url => url === source
      ? new Promise(resolve => { resolveFirst = resolve; })
      : Promise.resolve({ kind: "project", doc: nextDoc }));
    const { navigate } = renderLink();
    await flushHydration();
    expect(loadOpenLinkSource).toHaveBeenCalledOnce();
    await React.act(async () => navigate(`/bin?source=${encodeURIComponent(nextSource)}`));
    await settleLink();
    expect(ProjectPersistence.openLinkedProjectCopy).toHaveBeenCalledExactlyOnceWith(nextDoc);
    await React.act(async () => resolveFirst({ kind: "project", doc: linkedDoc }));
    expect(ProjectPersistence.openLinkedProjectCopy).toHaveBeenCalledOnce();
    expect(vi.mocked(loadOpenLinkSource).mock.calls[0][1]?.aborted).toBe(true);
  });

  it("resumes a link download interrupted by a pending file import", async () => {
    const fileDoc = { ...EMPTY_PROJECT, name: "Local tray" };
    const fileProject = { id: "local-tray", name: "Local tray", updatedAt: "2026-11-25T12:00:00Z" };
    const localImport = {
      doc: fileDoc, project: fileProject,
      library: { activeProjectId: fileProject.id, projects: [fileProject] },
    };
    let finishImport: (value: typeof localImport) => void = () => {};
    vi.mocked(ProjectPersistence.importProjectToLibrary)
      .mockReturnValueOnce(new Promise(resolve => { finishImport = resolve; }));
    vi.mocked(loadOpenLinkSource)
      .mockImplementationOnce((_source, signal) => new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      }))
      .mockResolvedValueOnce({ kind: "project", doc: linkedDoc });
    let finishRead: (value: string) => void = () => {};
    const json = JSON.stringify(fileDoc);
    const file = new File([json], "Local tray.pocketry.json");
    Object.defineProperty(file, "text", { value: () => new Promise(resolve => { finishRead = resolve; }) });
    const { container, reopen } = renderLink(undefined, "/bin");
    await flushHydration();
    openSettingsSection(container, "project");
    const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*=".pocketry.json"]')!;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await React.act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });

    await React.act(async () => reopen());
    expect(loadOpenLinkSource).toHaveBeenCalledOnce();
    await React.act(async () => finishRead(json));
    expect(ProjectPersistence.importProjectToLibrary).toHaveBeenCalledOnce();
    expect(vi.mocked(loadOpenLinkSource).mock.calls[0][1]?.aborted).toBe(true);
    await React.act(async () => finishImport(localImport));
    await settleLink();
    expect(loadOpenLinkSource).toHaveBeenCalledTimes(2);
    expect(ProjectPersistence.openLinkedProjectCopy).toHaveBeenCalledExactlyOnceWith(linkedDoc);
  });

  it("reports an empty library instead of presenting an empty picker", async () => {
    vi.mocked(loadOpenLinkSource).mockResolvedValue({ kind: "library", projects: [] });
    renderLink();
    await settleLink();
    expect(document.querySelector('[data-testid="open-link-dialog"]')?.textContent).toContain("contains no projects to open");
    expect(ProjectPersistence.openLinkedProjectCopy).not.toHaveBeenCalled();
  });
});
