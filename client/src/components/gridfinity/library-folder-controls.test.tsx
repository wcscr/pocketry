import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { LibraryFolderControls, type LibraryFolderControlsProps } from "./library-folder-controls";
import { reportFolderStatus, type FolderState } from "@/lib/project/folder-library";

afterEach(() => { reportFolderStatus({ state: "browser", folderName: null }); vi.unstubAllGlobals(); });

function render() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const props: LibraryFolderControlsProps = { busy: false, onConnect: vi.fn(), onReconnect: vi.fn(), onKeepBoth: vi.fn(), onDisconnect: vi.fn(), onExportProject: vi.fn() };
  React.act(() => root.render(<LibraryFolderControls {...props} />));
  return { host, props, button: (text: string) => [...host.querySelectorAll("button")].find(button => button.textContent === text)!,
    unmount: () => { React.act(() => root.unmount()); host.remove(); } };
}

it("explains the existing backup workflow when native folder access is unavailable", () => {
  const view = render();
  try {
    expect(view.host.textContent).toContain("You can still save here and export/import library backups");
    expect(view.button("Connect library folder")).toBeUndefined();
  } finally { view.unmount(); }
});

it("offers an explicit choice to copy existing browser projects", () => {
  vi.stubGlobal("showDirectoryPicker", vi.fn());
  const view = render();
  try {
    React.act(() => view.button("Connect library folder").click());
    expect(view.props.onConnect).toHaveBeenLastCalledWith(true);
    React.act(() => view.host.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
    React.act(() => view.button("Connect library folder").click());
    expect(view.props.onConnect).toHaveBeenLastCalledWith(false);
  } finally { view.unmount(); }
});

it.each<[FolderState, string, keyof LibraryFolderControlsProps]>([
  ["permission-required", "Reconnect folder", "onReconnect"],
  ["conflict", "Keep both versions", "onKeepBoth"],
  ["error", "Export current project", "onExportProject"],
])("offers recovery and preserves the error message in state %s", (state, label, action) => {
  reportFolderStatus({ state, folderName: "Documents", message: "Your work is still open." });
  const view = render();
  try {
    expect(view.host.textContent).toContain("Documents/pocketry-library");
    expect(view.host.querySelector('[role="status"]')!.textContent).toBe("Your work is still open.");
    React.act(() => view.button(label).click());
    expect(view.props[action]).toHaveBeenCalledOnce();
    expect(view.button("Disconnect folder")).toBeDefined();
  } finally { view.unmount(); }
});
