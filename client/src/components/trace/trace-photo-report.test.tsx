import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { downloadBlob } from "@/lib/download";
import * as reports from "@/lib/trace-photo-report";
import { TraceProvider, useTrace, type TraceStore } from "@/state/trace-store";
import { TracePhotoReport } from "./trace-photo-report";

vi.mock("@/lib/download", () => ({ downloadBlob: vi.fn() }));
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
let root: Root;
let host: HTMLDivElement;
let trace: TraceStore;
function Harness() { trace = useTrace(); return <TracePhotoReport key={trace.sourceRevision} />; }
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === text)!;
const click = (text: string) => React.act(async () => button(text).click());
const email = () => document.querySelector<HTMLAnchorElement>('a[href^="mailto:"]');

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await React.act(async () => root.render(<TraceProvider><Harness /></TraceProvider>));
});
afterEach(() => {
  React.act(() => root.unmount());
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals();
});
async function loadPhoto() {
  await React.act(async () => trace.dispatch({ type: "SOURCE_LOADED", imageUrl: png, fileName: "My tool" }));
}

it("waits for a photo, warns before preparing anything, and cancels without a download or email", async () => {
  expect(host.querySelector("button")).toBeNull();
  await loadPhoto();
  expect(trace.region).toBeNull(); expect(trace.outline).toEqual([]); expect(trace.calibration).toBeNull();
  expect(button("Report tracing problem").getAttribute("aria-haspopup")).toBe("dialog");
  await click("Report tracing problem");
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Your photo will be sent via email to the project maintainer at feedback@pocketry.xyz.");
  expect(dialog.textContent).toContain("Nothing is sent until you attach the report and send the email yourself.");
  expect(dialog.querySelector("img")?.getAttribute("src")).toBe(png);
  expect(downloadBlob).not.toHaveBeenCalled(); expect(email()).toBeNull();
  await click("Cancel");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(downloadBlob).not.toHaveBeenCalled(); expect(email()).toBeNull();
  await vi.waitFor(() => expect(document.activeElement).toBe(button("Report tracing problem")));
});

it("downloads a ZIP before offering an email draft, without changing the trace", async () => {
  await loadPhoto();
  const before = trace;
  await click("Report tracing problem");
  await click("Download photo report");
  expect(downloadBlob).toHaveBeenCalledOnce();
  const [blob, fileName] = vi.mocked(downloadBlob).mock.calls[0];
  expect(blob.type).toBe("application/zip");
  expect(email()?.href).toBe(reports.traceReportEmailHref(fileName));
  expect(document.querySelector('[role="status"]')?.textContent).toContain(fileName);
  expect(document.querySelector('[role="status"]')?.textContent).toContain("Attach it to your email before sending.");
  expect(document.body.textContent).not.toContain("Report sent");
  expect(trace).toBe(before);
});

it("keeps the captured photo and settings consistent while processing finishes", async () => {
  await loadPhoto();
  await click("Report tracing problem");
  const snapshot = trace;
  await React.act(async () => trace.dispatch({ type: "SET_SENSITIVITY", sensitivity: 97 }));
  const build = vi.spyOn(reports, "createTracePhotoReport");
  await click("Download photo report");
  expect(build.mock.calls[0][0]).toBe(snapshot);
  expect(build.mock.calls[0][0].sensitivity).toBe(128);
});

it("requires a fresh download after the description changes, and resets for a replacement photo", async () => {
  await loadPhoto(); await click("Report tracing problem"); await click("Download photo report");
  const [, firstName] = vi.mocked(downloadBlob).mock.calls[0];
  await React.act(async () => {
    const textarea = document.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Missing tip");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(email()).toBeNull();
  const build = vi.spyOn(reports, "createTracePhotoReport");
  await click("Download photo report");
  expect(build.mock.calls[0][1]).toBe("Missing tip");
  const [, secondName] = vi.mocked(downloadBlob).mock.calls[1];
  expect(secondName).not.toBe(firstName);
  expect(email()?.href).toBe(reports.traceReportEmailHref(secondName));
  await loadPhoto();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click("Report tracing problem");
  expect(document.querySelector("textarea")?.value).toBe(""); expect(email()).toBeNull();
});

it("reports preparation failures without opening email or claiming delivery, and allows retry", async () => {
  await loadPhoto(); await click("Report tracing problem");
  vi.spyOn(reports, "createTracePhotoReport").mockImplementationOnce(() => { throw new Error("Cannot build report"); });
  await click("Download photo report");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Couldn’t prepare the photo report.");
  expect(email()).toBeNull(); expect(downloadBlob).not.toHaveBeenCalled();
  await click("Download photo report");
  expect(document.querySelector('[role="alert"]')).toBeNull(); expect(email()).not.toBeNull();
});
