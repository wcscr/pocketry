import { webcrypto } from "node:crypto";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserLibraryFolder, type FolderIntent } from "@/lib/project/browser-folder";
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
        hasDraft={false} onOpen={vi.fn()} onOpened={vi.fn()} onExportDraft={vi.fn()}
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
