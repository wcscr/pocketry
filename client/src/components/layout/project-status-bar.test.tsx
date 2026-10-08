import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { parseBinSpec } from "@shared/gridfinity/types";
import { PROJECT_SCHEMA_VERSION, type ProjectDoc } from "@shared/gridfinity/project";
import { readProjectOverview } from "@/lib/project/persist";
import { downloadBlob } from "@/lib/download";
import { ProjectActivityProvider, useProjectActivityActions } from "@/state/project-activity";
import { PanelProvider, usePanelState } from "./panel-context";
import { ProjectStatusBar } from "./project-status-bar";

vi.mock("@/lib/project/persist", () => ({ readProjectOverview: vi.fn() }));
vi.mock("@/lib/download", () => ({ downloadBlob: vi.fn() }));
const DOC: ProjectDoc = { schemaVersion: PROJECT_SCHEMA_VERSION, name: "Socket tray", spec: parseBinSpec({ gridX: 3, gridY: 2, heightUnits: 6 }), shapes: [], cutouts: [], fingerHoles: [] };
let host: HTMLDivElement, root: Root;
let actions: NonNullable<ReturnType<typeof useProjectActivityActions>>;
const route = memoryLocation({ path: "/" });
function Probe() {
  actions = useProjectActivityActions()!;
  const panel = usePanelState();
  return <output data-library-requested={String(panel.libraryRequested)} />;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  vi.mocked(readProjectOverview).mockResolvedValue({ doc: DOC, activeProjectId: "socket" });
  route.navigate("/");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = async () => React.act(async () => root.render(<Router hook={route.hook}><PanelProvider><ProjectActivityProvider><ProjectStatusBar /><Probe /></ProjectActivityProvider></PanelProvider></Router>));
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === text)!;

it("shows the saved project on Trace, updates the tab title and opens its library", async () => {
  await render();
  expect(host.textContent).toContain("Bin project: Socket tray");
  expect(host.textContent).toContain("Saved in this browser");
  expect(document.title).toBe("Socket tray · Trace · Pocketry");
  React.act(() => host.querySelector<HTMLButtonElement>('[aria-label="Manage project: Socket tray"]')!.click());
  expect(host.querySelector("output")!.dataset.libraryRequested).toBe("true");
  expect(document.title).toBe("Socket tray · Bin · Pocketry");
});

it("explains backup scope and exports the latest in-memory edits after leaving Bin", async () => {
  await render();
  React.act(() => actions.publish({ name: "Unsaved changes", activeProjectId: "socket", status: "saving", error: null, hasDocument: true }, { ...DOC, name: "Unsaved changes", spec: { ...DOC.spec, gridX: 5 } }));
  React.act(() => route.navigate("/bin"));
  React.act(() => route.navigate("/"));
  // Completion may arrive after the Bin page has unmounted.
  React.act(() => actions.saved(false, new Error("Storage is full")));
  expect(host.textContent).toContain("Project storage needs attention");
  React.act(() => button("Backups").click());
  expect(document.body.textContent).toContain("Storage is full");
  expect(document.body.textContent).toContain("does not include the original Trace photo");
  expect(document.body.textContent).toContain("An unnamed draft needs its own project backup");
  React.act(() => button("Download current project backup").click());
  const [blob, name] = vi.mocked(downloadBlob).mock.calls[0];
  expect(name).toMatch(/^Unsaved-changes-.*\.pocketry\.json$/);
  const json = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
  expect(JSON.parse(json).spec.gridX).toBe(5);
});

it("does not let a slow initial read replace a newer workspace identity", async () => {
  let resolve!: (value: Awaited<ReturnType<typeof readProjectOverview>>) => void;
  vi.mocked(readProjectOverview).mockReturnValue(new Promise(done => { resolve = done; }));
  await render();
  React.act(() => actions.publish({ name: "New tray", activeProjectId: "new", status: "saving", error: null, hasDocument: true }, { ...DOC, name: "New tray" }));
  await React.act(async () => resolve({ doc: DOC, activeProjectId: "socket" }));
  expect(host.textContent).toContain("New tray");
  expect(host.textContent).not.toContain("Socket tray");
  React.act(() => actions.saved(true));
  expect(host.textContent).toContain("Saved in this browser");
});

it("returns keyboard focus to Backups when its dialog closes", async () => {
  await render();
  React.act(() => button("Backups").click());
  await React.act(async () => button("Close").click());
  await vi.waitFor(() => expect(document.activeElement).toBe(button("Backups")));
});

it.each(["empty", "unreadable"])("does not offer a fabricated project backup for %s storage", async kind => {
  if (kind === "empty") vi.mocked(readProjectOverview).mockResolvedValue({ doc: null, activeProjectId: null });
  else vi.mocked(readProjectOverview).mockRejectedValue(new Error("Saved by a newer Pocketry version"));
  await render();
  React.act(() => button("Backups").click());
  expect(button("Download current project backup").disabled).toBe(true);
  expect(document.body.textContent).toContain(kind === "empty" ? "No bin project yet" : "Saved by a newer Pocketry version");
});
