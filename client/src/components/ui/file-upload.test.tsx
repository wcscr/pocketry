import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TRACE_PHOTO_MAX_BYTES } from "@/lib/trace-photo";
import { FileUpload } from "./file-upload";

let host: HTMLDivElement, root: Root;
const selected = vi.fn(), rejected = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  React.act(() => root.render(<FileUpload onFileSelected={selected} onFileRejected={rejected} />));
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

async function drop(files: File[], type = "drop") {
  await React.act(async () => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: {
      files, types: ["Files"], items: files.map(file => ({ kind: "file", type: file.type, getAsFile: () => file })),
    } });
    host.querySelector('[role="button"]')!.dispatchEvent(event);
  });
}

it("accepts WebP photos and states the formats, size limit, and local processing", async () => {
  const file = new File(["photo"], "tool.webp", { type: "image/webp" });
  await drop([file]);
  expect(selected).toHaveBeenCalledExactlyOnceWith(file);
  expect(rejected).not.toHaveBeenCalled();
  expect(host.textContent).toContain("PNG, JPG, or WebP up to 10 MB");
  expect(host.textContent).toContain("Photos stay on your device");
});

it("explains unsupported file rejection and clears drag feedback after the drop", async () => {
  const file = new File(["not a photo"], "notes.txt", { type: "text/plain" });
  await drop([file], "dragenter");
  expect(host.textContent).toContain("Drop photo here");
  await drop([file]);
  expect(rejected).toHaveBeenCalledExactlyOnceWith("Choose a PNG, JPG, or WebP photo.");
  expect(selected).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("Drop photo here");
});

it("rejects oversized photos before selecting them", async () => {
  const file = new File(["photo"], "large.png", { type: "image/png" });
  Object.defineProperty(file, "size", { value: TRACE_PHOTO_MAX_BYTES + 1 });
  await drop([file]);
  expect(rejected).toHaveBeenCalledExactlyOnceWith("This photo is too large. Choose a photo up to 10 MB.");
  expect(selected).not.toHaveBeenCalled();
});

it("explains multiple-photo rejection without choosing an arbitrary file", async () => {
  await drop([new File(["one"], "one.png", { type: "image/png" }), new File(["two"], "two.png", { type: "image/png" })]);
  expect(rejected).toHaveBeenCalledExactlyOnceWith("Choose one photo at a time.");
  expect(selected).not.toHaveBeenCalled();
});
