import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FeedbackDialog } from "./feedback-dialog";

let root: Root;
let widgetOptions: Parameters<NonNullable<Window["turnstile"]>["render"]>[1];
const remove = vi.fn();
const reset = vi.fn();
const fetchMock = vi.fn<typeof fetch>();
const onOpenChange = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetchMock.mockReset(); remove.mockReset(); reset.mockReset(); onOpenChange.mockReset();
  fetchMock.mockResolvedValueOnce(Response.json({ siteKey: "test-site-key" }));
  vi.stubGlobal("fetch", fetchMock);
  window.turnstile = { render: vi.fn((_element, options) => { widgetOptions = options; return "widget"; }), remove, reset };
  const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => {
  React.act(() => root.unmount()); delete window.turnstile;
  vi.unstubAllGlobals(); document.body.replaceChildren();
});
async function render(open = true) {
  await React.act(async () => { root.render(<FeedbackDialog open={open} kind="problem" onOpenChange={onOpenChange} />); });
}
function setField(id: string, value: string) {
  const element = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  React.act(() => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function complete() {
  setField("feedback-subject", "Export stopped");
  setField("feedback-message", "I clicked export but nothing downloaded.");
  React.act(() => widgetOptions.callback("valid-token"));
}
async function submit() {
  await React.act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
}

it("does not fetch configuration or load Turnstile until opened", async () => {
  await render(false);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(window.turnstile!.render).not.toHaveBeenCalled();
});

it("sends only explicit form fields, allows no email, and confirms success", async () => {
  await render(); complete();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).toContain("Photos and projects stay on your device");
  fetchMock.mockResolvedValueOnce(Response.json({ ok: true }));
  await submit();
  expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
    kind: "problem", subject: "Export stopped", message: "I clicked export but nothing downloaded.",
    replyEmail: "", website: "", turnstileToken: "valid-token",
  });
  expect(document.querySelector('[role="status"]')?.textContent).toContain("submitted");
});

it("preserves the draft on delivery failure and requires a fresh spam check", async () => {
  await render(); complete();
  fetchMock.mockResolvedValueOnce(Response.json({ error: "Could not send. Try later." }, { status: 502 }));
  await submit();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Could not send");
  expect((document.getElementById("feedback-message") as HTMLTextAreaElement).value).toContain("nothing downloaded");
  expect((document.querySelector('[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
  expect(reset).toHaveBeenCalledWith("widget");
  expect(remove).not.toHaveBeenCalled();
});

it("retries with a fresh token on the same widget", async () => {
  await render(); complete();
  fetchMock.mockResolvedValueOnce(Response.json({ error: "Try again." }, { status: 503 }));
  await submit();
  expect(reset).toHaveBeenCalledTimes(1);
  React.act(() => widgetOptions.callback("fresh-token"));
  fetchMock.mockResolvedValueOnce(Response.json({ ok: true }));
  await submit();
  expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body)).turnstileToken).toBe("fresh-token");
  expect(window.turnstile!.render).toHaveBeenCalledTimes(1);
});

it("uses the provided site key and feedback action", async () => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValueOnce(Response.json({ siteKey: "0x4AAAAAAFEX5UTaSUHC-qpj" }));
  await render();
  expect(widgetOptions.sitekey).toBe("0x4AAAAAAFEX5UTaSUHC-qpj");
  expect(widgetOptions.action).toBe("feedback");
});

it("retains unsent text when closed and reopened", async () => {
  await render(); complete(); await render(false);
  fetchMock.mockResolvedValueOnce(Response.json({ siteKey: "test-site-key" }));
  await render();
  expect((document.getElementById("feedback-subject") as HTMLInputElement).value).toBe("Export stopped");
  expect((document.querySelector('[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
});

it("shows an unavailable message when a static-only host returns HTML", async () => {
  fetchMock.mockReset(); fetchMock.mockResolvedValueOnce(new Response("<!doctype html>"));
  await render();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("unavailable");
  expect((document.querySelector('[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
  expect(window.turnstile!.render).not.toHaveBeenCalled();
});

it("expires tokens and removes the widget on close", async () => {
  await render(); complete();
  React.act(() => widgetOptions["expired-callback"]());
  expect((document.querySelector('[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
  await render(false);
  expect(remove).toHaveBeenCalledWith("widget");
});

it("never interprets an HTML response to submission as success", async () => {
  await render(); complete(); fetchMock.mockResolvedValueOnce(new Response("<!doctype html>"));
  await submit();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("could not confirm delivery");
  expect(document.body.textContent).not.toContain("Thanks!");
});
