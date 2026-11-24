import { webcrypto } from "node:crypto";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserLibraryFolder, type FolderIntent } from "@/lib/project/browser-folder";
import * as ProjectPersistence from "@/lib/project/persist";
import { FOLDER_LIMITS, LibraryError } from "@shared/project-library/format";
import { ConnectedLibrary, type RequestOutcome } from "@shared/project-library/library";
import { PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import { parseBinSpec } from "@shared/gridfinity/types";
import { FolderLibraryContent } from "./folder-library";
import { useFolderLibrary } from "@/hooks/use-folder-library";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps a published request recoverable when removing its browser metadata fails", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", webcrypto);
  const rootNode = document.createElement("div");
  document.body.append(rootNode);
  const root = createRoot(rootNode);
  const revision = "a".repeat(64);
  const doc = {
    schemaVersion: PROJECT_SCHEMA_VERSION, name: "Test tray",
    spec: parseBinSpec({ gridX: 2, gridY: 1, heightUnits: 3 }),
    cutouts: [], shapes: [], fingerHoles: [],
  };

  let pending: FolderIntent[] = [];
  const folder = new BrowserLibraryFolder({ name: "Test folder" } as ConstructorParameters<typeof BrowserLibraryFolder>[0]);
  vi.spyOn(BrowserLibraryFolder, "supported").mockReturnValue(true);
  vi.spyOn(BrowserLibraryFolder, "saved").mockResolvedValue(folder);
  vi.spyOn(folder, "canWrite").mockResolvedValue(true);
  vi.spyOn(folder, "pending").mockImplementation(async () => pending);
  vi.spyOn(folder, "remember").mockImplementation(async intent => { pending = [intent]; });
  vi.spyOn(folder, "forget").mockRejectedValueOnce(new Error("IDB unavailable"))
    .mockImplementation(async () => { pending = []; });
  vi.spyOn(ConnectedLibrary.prototype, "list").mockResolvedValue([]);
  vi.spyOn(ConnectedLibrary.prototype, "browse").mockResolvedValue({ projects: [], hasPublishedRevisions: false, canRecoverLegacy: false });
  const commit = vi.spyOn(ConnectedLibrary.prototype, "commit").mockImplementation(async input => ({
    status: "published", requestId: input.requestId, projects: [], requestCollision: false, pendingRevisions: [],
    publications: [{ revision, fingerprint: "b".repeat(64), projectIds: [input.changes[0].projectId] }],
  } satisfies RequestOutcome));

  const button = (text: string) => [...document.querySelectorAll("button")]
    .find(candidate => candidate.textContent?.trim() === text)!;
  try {
    function Harness() {
      const library = useFolderLibrary();
      return <FolderLibraryContent library={library} active={null} busy={false}
        hasDraft={false} onOpen={vi.fn()} onOpened={vi.fn()} onExportDraft={vi.fn()} onExportCompact={vi.fn()}
        onResume={async intent => { await library.resume(intent, vi.fn()); }}
        onSave={() => void library.save(doc, doc.name)} />;
    }
    await act(async () => root.render(<Harness />));
    await act(async () => {
      button("Save current project").click();
      await vi.waitFor(() => expect(commit).toHaveBeenCalledOnce());
    });
    expect(document.querySelector('[role="status"]')?.textContent).toContain("Saved revision");
    expect(button("Save current project").disabled).toBe(true);
    await act(async () => button("Check and resume").click());
    expect(commit.mock.calls[1][0]).toEqual(commit.mock.calls[0][0]);
    expect(button("Check and resume")).toBeUndefined();
    expect(button("Save current project").disabled).toBe(false);
  } finally {
    await act(async () => { root.unmount(); await new Promise(resolve => setTimeout(resolve, 0)); });
    rootNode.remove();
  }
});

it.each([
  { action: "import", interrupted: "before" },
  { action: "copy", interrupted: "after" },
] as const)("resumes a large $action interrupted $interrupted the last batch is written", async ({ action, interrupted }) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", webcrypto);
  const node = document.createElement("div");
  const root = createRoot(node);
  const count = action === "import" ? 500 : FOLDER_LIMITS.changes + 1;
  const backup = {
    format: "pocketry-library", schemaVersion: 1, projects: Array.from({ length: count }, (_, index) => ({
      id: `tray-${index}`, name: `Tray ${index}`, updatedAt: new Date(0).toISOString(),
      doc: { schemaVersion: PROJECT_SCHEMA_VERSION, spec: parseBinSpec({ gridX: 2, gridY: 1, heightUnits: 3 }),
        shapes: [], cutouts: [], fingerHoles: [] },
    })),
  } as const;
  vi.spyOn(ProjectPersistence, "exportProjectLibrary").mockResolvedValue(backup);
  const folder = new BrowserLibraryFolder({ name: "Test folder" } as ConstructorParameters<typeof BrowserLibraryFolder>[0]);
  const service = new ConnectedLibrary(folder);
  let pending: FolderIntent[] = [];
  const files = new Map<string, Uint8Array>();
  let unavailable = false;
  vi.spyOn(BrowserLibraryFolder, "supported").mockReturnValue(true);
  vi.spyOn(BrowserLibraryFolder, "saved").mockResolvedValue(folder);
  vi.spyOn(folder, "canWrite").mockResolvedValue(true);
  vi.spyOn(folder, "pending").mockImplementation(async () => structuredClone(pending));
  vi.spyOn(folder, "remember").mockImplementation(async intent => { pending = [structuredClone(intent)]; });
  vi.spyOn(folder, "forget").mockImplementation(async () => { pending = []; });
  vi.spyOn(folder, "entries").mockImplementation(async function* () {
    if (unavailable) throw new LibraryError("storage", "The folder became unavailable.");
    for (const name of files.keys()) yield { name, kind: "file" };
  });
  vi.spyOn(folder, "read").mockImplementation(async name => {
    if (unavailable) throw new LibraryError("storage", "The folder became unavailable.");
    const bytes = files.get(name);
    return bytes ? { bytes, modifiedAt: 0 } : null;
  });
  const lastBatch = Math.ceil(count / FOLDER_LIMITS.changes);
  let writes = 0;
  vi.spyOn(folder, "publish").mockImplementation(async (name, bytes) => {
    if (++writes === lastBatch) {
      unavailable = true;
      if (interrupted === "before") throw new Error("Interrupted before writing.");
    }
    files.set(name, bytes);
  });
  let current!: ReturnType<typeof useFolderLibrary>;
  function Harness() { current = useFolderLibrary(false); return null; }

  try {
    await act(async () => root.render(<Harness key="original" />));
    await act(async () => { await current.refresh(); });
    if (action === "import") {
      const projects = backup.projects.map((project, index) => index === count - 1
        ? { ...project, doc: { ...project.doc, schemaVersion: PROJECT_SCHEMA_VERSION + 1 } } : project);
      await act(async () => { await current.importBackup({ ...backup, projects }); });
      expect(current.error).toContain("newer Pocketry version");
      expect(files.size).toBe(0);
      expect(current.pending).toHaveLength(0);
    }
    await act(async () => {
      const result = await (action === "import" ? current.importBackup(backup) : current.copyBrowserProjects());
      expect(result).toBeUndefined();
    });
    expect(current.pending).toMatchObject([{ kind: "batch", action }]);
    expect(current.error).toContain("Check and resume in Library");
    expect(files.size).toBe(lastBatch - (interrupted === "before" ? 1 : 0));

    unavailable = false;
    await act(async () => root.render(<Harness key="reloaded" />));
    await act(async () => { await current.refresh(); });
    await act(async () => { await current.resume(current.pending[0], vi.fn()); });
    expect(current.error).toBe("");
    expect(current.pending).toHaveLength(0);
    expect(current.projects).toHaveLength(count);
    expect(current.message).toContain(`${count} projects`);
    expect(writes).toBe(lastBatch + (interrupted === "before" ? 1 : 0));
    const restored = await service.backup();
    expect(restored.projects.map(project => project.name).sort()).toEqual(backup.projects.map(project => project.name).sort());
    if (action === "copy") expect(restored.projects.map(project => project.id).sort()).toEqual(backup.projects.map(project => project.id).sort());
  } finally {
    await act(async () => root.unmount());
  }
});
