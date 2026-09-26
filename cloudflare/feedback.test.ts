import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleFeedback, type FeedbackEnv } from "./feedback";
import worker from "./worker";
import { onRequest } from "../functions/api/feedback";

const env = {
  TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret",
  TURNSTILE_HOSTNAMES: "pocketry.example",
  FEEDBACK_ACCOUNT_ID: "a".repeat(32), FEEDBACK_EMAIL_TOKEN: "private-token",
  FEEDBACK_FROM: "feedback@example.com", FEEDBACK_TO: "inbox@example.com",
};
const submission = {
  kind: "problem", subject: "Export stopped", message: "I clicked export and nothing downloaded.",
  replyEmail: "", website: "", turnstileToken: "verified-token",
};
const fetchMock = vi.fn<typeof fetch>();
const accepted = { success: true, result: { delivered: [env.FEEDBACK_TO], queued: [], permanent_bounces: [] } };
function request(data: object = submission, headers: Record<string, string> = {}): Request {
  return new Request("https://pocketry.example/api/feedback", { method: "POST", headers: {
    "Content-Type": "application/json", Origin: "https://pocketry.example", ...headers,
  }, body: JSON.stringify(data) });
}
function verify(overrides: object = {}) {
  fetchMock.mockResolvedValueOnce(Response.json({ success: true, hostname: "pocketry.example", action: "feedback", ...overrides }));
}
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe("private feedback", () => {
  it("exposes only the public site key and does not send email on GET", async () => {
    const response = await handleFeedback(new Request("https://pocketry.example/api/feedback"), env);
    expect(await response.json()).toEqual({ siteKey: "site" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(Object.keys(env))("fails closed without %s", async (key) => {
    const incomplete: FeedbackEnv = { ...env, [key]: undefined };
    expect((await handleFeedback(request(), incomplete)).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends text to the fixed inbox after verification, without needing a reply address", async () => {
    verify(); fetchMock.mockResolvedValueOnce(Response.json(accepted));
    const response = await handleFeedback(request(), env);
    expect(await response.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded" });
    expect(new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body)).get("response")).toBe("verified-token");
    const outgoing = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(outgoing).toEqual({ from: env.FEEDBACK_FROM, to: env.FEEDBACK_TO,
      subject: "[Pocketry Problem] Export stopped",
      text: "Problem: Export stopped\nReply email: Not provided\n\nI clicked export and nothing downloaded.",
    });
    expect(JSON.stringify(outgoing)).not.toContain("verified-token");
  });

  it("accepts a queued suggestion and puts the optional reply email in plain text", async () => {
    verify(); fetchMock.mockResolvedValueOnce(Response.json({ success: true, result: { delivered: [], queued: [env.FEEDBACK_TO], permanent_bounces: [] } }));
    expect((await handleFeedback(request({ ...submission, kind: "suggestion", replyEmail: "visitor@example.com" }), env)).status).toBe(200);
    const outgoing = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(outgoing.subject).toBe("[Pocketry Suggestion] Export stopped");
    expect(outgoing.text).toContain("visitor@example.com");
    expect(outgoing.to).toBe(env.FEEDBACK_TO);
  });

  it.each([{ success: false }, { hostname: "attacker.example" }, { action: "login" }])("rejects an invalid token result: %j", async (result) => {
    verify(result);
    expect((await handleFeedback(request(), env)).status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when verification is unavailable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("unavailable"));
    expect((await handleFeedback(request(), env)).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a request on an unapproved hostname before any external call", async () => {
    const alternate = new Request("https://preview.example/api/feedback", {
      method: "POST", body: JSON.stringify(submission),
      headers: { Origin: "https://preview.example", "Content-Type": "application/json" },
    });
    expect((await handleFeedback(alternate, env)).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an empty configured hostname list", async () => {
    expect((await handleFeedback(request(), { ...env, TURNSTILE_HOSTNAMES: " , " })).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes an explicit comma-separated hostname list", async () => {
    verify(); fetchMock.mockResolvedValueOnce(Response.json(accepted));
    expect((await handleFeedback(request(), { ...env, TURNSTILE_HOSTNAMES: " pocketry.example, WWW.POCKETRY.EXAMPLE " })).status).toBe(200);
  });

  it("does not accept another approved hostname's token for this request", async () => {
    verify({ hostname: "www.pocketry.example" });
    expect((await handleFeedback(request(), { ...env, TURNSTILE_HOSTNAMES: "pocketry.example,www.pocketry.example" })).status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a replay when Siteverify returns timeout-or-duplicate, without sending again", async () => {
    verify(); fetchMock.mockResolvedValueOnce(Response.json(accepted));
    expect((await handleFeedback(request(), env)).status).toBe(200);
    fetchMock.mockResolvedValueOnce(Response.json({ success: false, "error-codes": ["timeout-or-duplicate"] }));
    expect((await handleFeedback(request(), env)).status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    () => new Response("upstream unavailable", { status: 503 }),
    () => new Response("not JSON"),
    () => Response.json({ success: "true", hostname: "pocketry.example", action: "feedback" }),
  ])("fails closed for HTTP, JSON, and invalid success-type responses", async (response) => {
    fetchMock.mockResolvedValueOnce(response());
    expect((await handleFeedback(request(), env)).status).toBeGreaterThanOrEqual(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { subject: "  " }, { subject: "hello\r\nBcc: someone@example.com" },
    { message: "short" }, { message: "x".repeat(5001) }, { replyEmail: "invalid" },
    { website: "spam" }, { turnstileToken: "" }, { turnstileToken: "x".repeat(2049) }, { to: "attacker@example.com" },
  ])("rejects invalid or unexpected fields before calling external APIs: %j", async (override) => {
    expect((await handleFeedback(request({ ...submission, ...override }), env)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized streamed bodies even without Content-Length", async () => {
    const response = await handleFeedback(request({ ...submission, message: "💬".repeat(10_000) }), env);
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const malformed = new Request(request(), { body: "{" });
    expect((await handleFeedback(malformed, env)).status).toBe(400);
  });

  it("rejects cross-origin requests, non-JSON forms and unsupported methods", async () => {
    expect((await handleFeedback(request(submission, { Origin: "https://attacker.example" }), env)).status).toBe(403);
    expect((await handleFeedback(request(submission, { "Content-Type": "text/plain" }), env)).status).toBe(415);
    const response = await handleFeedback(new Request("https://pocketry.example/api/feedback", { method: "DELETE" }), env);
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, POST");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { success: false, errors: [{ message: "private provider details" }] },
    { success: true, result: { delivered: [], queued: [], permanent_bounces: [env.FEEDBACK_TO] } },
    { success: true, result: { delivered: ["someone-else@example.com"], queued: [], permanent_bounces: [] } },
  ])("does not claim success for failed or unconfirmed delivery: %j", async (result) => {
    verify(); fetchMock.mockResolvedValueOnce(Response.json(result));
    const response = await handleFeedback(request(), env);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private provider details");
  });

  it("handles email timeouts without exposing upstream details", async () => {
    verify(); fetchMock.mockRejectedValueOnce(new Error("private token"));
    const response = await handleFeedback(request(), env);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private token");
  });

  it("routes Pages and Workers feedback while leaving static assets available", async () => {
    const get = new Request("https://pocketry.example/api/feedback");
    const assets = vi.fn().mockResolvedValue(new Response("static app"));
    expect((await onRequest({ request: get, env })).status).toBe(200);
    expect((await worker.fetch(get, { ...env, ASSETS: { fetch: assets } })).status).toBe(200);
    expect(assets).not.toHaveBeenCalled();
    expect(await (await worker.fetch(new Request("https://pocketry.example/bin"), { ASSETS: { fetch: assets } })).text()).toBe("static app");
  });
});
