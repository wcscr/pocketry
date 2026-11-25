import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TraceProvider, useTrace, type TraceStore } from "@/state/trace-store";
import { TracePhotoReport } from "./trace-photo-report";

vi.mock("@/components/help/turnstile", () => ({ Turnstile: ({ onToken }: { onToken: (token: string) => void }) =>
  <button type="button" onClick={() => onToken("verified-token")}>Complete spam check</button> }));
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
let root: Root;
let host: HTMLDivElement;
let trace: TraceStore;
const fetchMock = vi.fn<typeof fetch>();
function Harness() { trace = useTrace(); return <TracePhotoReport key={trace.sourceRevision} />; }
function button(text: string) { return [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === text)!; }
async function click(text: string) { await React.act(async () => button(text).click()); }
async function loadPhoto() { await React.act(async () => trace.dispatch({ type: "SOURCE_LOADED", imageUrl: png, fileName: "My tool" })); }
async function typeInto(selector: string, value: string) {
  await React.act(async () => {
    const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetchMock.mockReset(); fetchMock.mockResolvedValue(Response.json({ siteKey: "site-key" })); vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await React.act(async () => root.render(<TraceProvider><Harness /></TraceProvider>));
});
afterEach(() => {
  React.act(() => root.unmount()); document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("shows a button before calibration, warns about the photo, and sends nothing on cancel", async () => {
  expect(host.querySelector("button")).toBeNull();
  await loadPhoto();
  expect(trace.region).toBeNull(); expect(trace.outline).toEqual([]);
  await click("Report tracing problem");
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Sending shares your original photo");
  expect(dialog.querySelector("img")?.getAttribute("src")).toBe(png);
  expect(dialog.querySelector('input[type="email"]')).not.toBeNull();
  await vi.waitFor(() => expect(button("Complete spam check")).toBeTruthy());
  await click("Cancel");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(fetchMock.mock.calls.filter(([url]) => url === "/api/trace-report")).toHaveLength(0);
});

it("keeps the fallback button until the detection region is usable", async () => {
  await loadPhoto();
  await React.act(async () => {
    trace.dispatch({ type: "SET_CALIBRATION", calibration: { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 50 } });
    trace.dispatch({ type: "SET_REGION", region: { x: 0, y: 0, width: 4, height: 4 } });
  });
  expect(button("Report tracing problem")).toBeDefined();
});

it("recovers from a configuration timeout without losing the draft", async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  }));
  await loadPhoto(); await click("Report tracing problem");
  await typeInto("textarea", "Outline missed one edge");
  await typeInto('input[type="email"]', "visitor@example.com");

  await React.act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("took too long");
  expect(document.querySelector('[role="status"]')).toBeNull();

  await click("Retry connection");
  await click("Complete spam check");
  expect(button("Send photo report").disabled).toBe(false);
  expect(document.querySelector("textarea")?.value).toBe("Outline missed one edge");
  expect(document.querySelector<HTMLInputElement>('input[type="email"]')?.value).toBe("visitor@example.com");
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/feedback", "/api/feedback"]);
});

it("offers the maintainer's email when a self-hosted installation lacks the form API", async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
  await loadPhoto(); await click("Report tracing problem");

  const alert = document.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain("Email issues or recommendations to the maintainer");
  expect(alert?.querySelector("a")?.getAttribute("href")).toBe("mailto:feedback@pocketry.xyz");
  expect(button("Send photo report").disabled).toBe(true);
});

it("submits the captured original photo and optional email after the explicit send click", async () => {
  await loadPhoto(); await click("Report tracing problem");
  const snapshot = trace;
  await typeInto("textarea", "Missing tip"); await typeInto('input[type="email"]', "visitor@example.com");
  await React.act(async () => trace.dispatch({ type: "SET_SENSITIVITY", sensitivity: 97 }));
  await vi.waitFor(() => expect(button("Complete spam check")).toBeTruthy());
  await click("Complete spam check");
  fetchMock.mockResolvedValueOnce(Response.json({ ok: true }));
  await click("Send photo report");
  const post = fetchMock.mock.calls.find(([url]) => url === "/api/trace-report")!;
  expect(post[1]?.headers).toEqual({ "Content-Type": "application/json", "X-Pocketry-Turnstile": "verified-token" });
  const body = JSON.parse(String(post[1]?.body));
  expect(body.photo).toEqual({ type: "image/png", content: png.split(",")[1] });
  expect(body.replyEmail).toBe("visitor@example.com");
  expect(JSON.parse(body.details)).toMatchObject({ description: "Missing tip", trace: { sensitivity: snapshot.sensitivity } });
  expect(document.querySelector('[role="status"]')?.textContent).toContain("submitted");
});

it("preserves the form on failed delivery and resets for a replacement photo", async () => {
  await loadPhoto(); await click("Report tracing problem");
  await typeInto("textarea", "Outline includes shadow");
  await vi.waitFor(() => expect(button("Complete spam check")).toBeTruthy());
  await click("Complete spam check");
  fetchMock.mockResolvedValueOnce(Response.json({ error: "Delivery failed" }, { status: 502 }));
  await click("Send photo report");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Delivery failed");
  expect(document.querySelector("textarea")?.value).toBe("Outline includes shadow");
  expect(document.body.textContent).not.toContain("has been submitted");
  await loadPhoto();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click("Report tracing problem");
  expect(document.querySelector("textarea")?.value).toBe("");
});
