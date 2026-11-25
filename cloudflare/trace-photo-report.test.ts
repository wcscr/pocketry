import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TRACE_REPORT_SEND_BODY_MAX_BYTES, TRACE_REPORT_SEND_PHOTO_MAX_BYTES } from "../shared/trace-photo-report-schema";
import { handleTracePhotoReport } from "./trace-photo-report";
import { onRequest } from "../functions/api/trace-report";

const env = { TURNSTILE_SECRET_KEY: "secret", TURNSTILE_HOSTNAMES: "pocketry.example",
  FEEDBACK_FROM: "feedback@example.com", FEEDBACK_TO: "inbox@example.com",
  FEEDBACK_ACCOUNT_ID: "a".repeat(32), FEEDBACK_EMAIL_TOKEN: "private-token" };
const photo = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const details = JSON.stringify({ reportSchemaVersion: 1, appVersion: "1.18.0", photo: { file: "original-photo.png" },
  trace: { outline: [], calibration: null }, description: "The outline skips the café logo." });
const submission = { photo: { type: "image/png", content: photo }, details, replyEmail: "", website: "" };
const fetchMock = vi.fn<typeof fetch>();
function request(data: object = submission, headers: Record<string, string> = {}) {
  return new Request("https://pocketry.example/api/trace-report", { method: "POST",
    headers: { Origin: "https://pocketry.example", "Content-Type": "application/json", "X-Pocketry-Turnstile": "verified-token", ...headers },
    body: JSON.stringify(data) });
}
function verified() { fetchMock.mockResolvedValueOnce(Response.json({ success: true, hostname: "pocketry.example", action: "feedback" })); }
const accepted = { success: true, result: { delivered: [env.FEEDBACK_TO], queued: [], permanent_bounces: [] } };
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

it("sends the photo and details to the fixed inbox only after a verified form submit", async () => {
  verified(); fetchMock.mockResolvedValueOnce(Response.json(accepted));
  expect(await (await onRequest({ request: request({ ...submission, replyEmail: "visitor@example.com" }), env })).json()).toEqual({ ok: true });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const outgoing = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
  expect(outgoing).toMatchObject({ from: env.FEEDBACK_FROM, to: env.FEEDBACK_TO,
    subject: "[Pocketry Trace] Photo report (1.18.0)", text: expect.stringContaining("visitor@example.com") });
  expect(outgoing.attachments).toEqual([
    { content: photo, filename: "original-photo.png", type: "image/png", disposition: "attachment" },
    { content: Buffer.from(details).toString("base64"), filename: "tracing-details.json", type: "application/json", disposition: "attachment" },
  ]);
  expect(JSON.stringify(outgoing)).not.toContain("verified-token");
});

it("accepts no reply address and queued delivery without claiming final arrival", async () => {
  verified(); fetchMock.mockResolvedValueOnce(Response.json({ success: true, result: { delivered: [], queued: [env.FEEDBACK_TO], permanent_bounces: [] } }));
  expect((await handleTracePhotoReport(request(), env)).status).toBe(200);
  expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).text).toContain("Reply email: Not provided");
});

it("labels the resized attachment in the email", async () => {
  const resized = JSON.stringify({ ...JSON.parse(details), photo: { file: "report-photo.png", attachmentSize: { width: 1, height: 1 } } });
  verified(); fetchMock.mockResolvedValueOnce(Response.json(accepted));
  expect((await handleTracePhotoReport(request({ ...submission, details: resized }), env)).status).toBe(200);
  const outgoing = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
  expect(outgoing.attachments[0].filename).toBe("report-photo.png");
  expect(outgoing.text).toContain("A resized copy of the photo");
});

it("accepts a photo attachment at the byte limit", async () => {
  const bytes = Buffer.alloc(TRACE_REPORT_SEND_PHOTO_MAX_BYTES);
  Buffer.from(photo, "base64").copy(bytes);
  const content = bytes.toString("base64");
  verified(); fetchMock.mockResolvedValueOnce(Response.json(accepted));

  const response = await handleTracePhotoReport(request({ ...submission, photo: { ...submission.photo, content } }), env);

  expect(response.status).toBe(200);
  const outgoing = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
  expect(outgoing.attachments[0].content === content).toBe(true);
});

it("rejects a photo one byte over the limit even when its Base64 length fits", async () => {
  const bytes = Buffer.alloc(TRACE_REPORT_SEND_PHOTO_MAX_BYTES + 1);
  Buffer.from(photo, "base64").copy(bytes);
  verified();

  const response = await handleTracePhotoReport(request({ ...submission,
    photo: { ...submission.photo, content: bytes.toString("base64") },
  }), env);

  expect(response.status).toBe(400);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each<{ headers: Record<string, string>; status: number }>([
  { headers: { Origin: "https://attacker.example" }, status: 403 },
  { headers: { "X-Pocketry-Turnstile": "" }, status: 400 },
  { headers: { "Content-Type": "text/plain" }, status: 415 },
])("rejects unauthorized requests before any external call", async ({ headers, status }) => {
  expect((await handleTracePhotoReport(request(submission, headers), env)).status).toBe(status);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("rejects a failed or cross-host spam check without reading and sending the photo", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ success: true, hostname: "other.example", action: "feedback" }));
  expect((await handleTracePhotoReport(request(), env)).status).toBe(403);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each([
  { ...submission, to: "attacker@example.com" },
  { ...submission, website: "spam" },
  { ...submission, replyEmail: "invalid" },
  { ...submission, photo: { ...submission.photo, type: "image/jpeg" } },
  { ...submission, photo: { ...submission.photo, content: "%%%%" } },
  { ...submission, details: JSON.stringify({ ...JSON.parse(details), photo: { file: "original-photo.jpg" } }) },
])("rejects malformed or unexpected content without sending mail", async (data) => {
  verified();
  expect((await handleTracePhotoReport(request(data), env)).status).toBe(400);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("bounds the request body and requires provider acceptance for the fixed inbox", async () => {
  verified();
  expect((await handleTracePhotoReport(request(submission, { "Content-Length": String(TRACE_REPORT_SEND_BODY_MAX_BYTES + 1) }), env)).status).toBe(413);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  verified(); fetchMock.mockResolvedValueOnce(Response.json({ success: true, result: { delivered: ["other@example.com"], queued: [], permanent_bounces: [] } }));
  expect((await handleTracePhotoReport(request(), env)).status).toBe(502);
});
