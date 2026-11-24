import { z } from "zod";
import { tracePhotoSubmissionSchema, TRACE_REPORT_SEND_BODY_MAX_BYTES,
  TRACE_REPORT_SEND_DETAILS_MAX_BYTES, TRACE_REPORT_SEND_PHOTO_MAX_BYTES } from "../shared/trace-photo-report-schema";
import type { FeedbackEnv } from "./feedback";

const settingsSchema = z.object({
  TURNSTILE_SECRET_KEY: z.string().min(1),
  TURNSTILE_HOSTNAMES: z.string().transform(value => value.split(",").map(host => host.trim().toLowerCase()).filter(Boolean))
    .pipe(z.array(z.string().max(253).regex(/^[a-z0-9.-]+$/)).nonempty()),
  FEEDBACK_FROM: z.string().email(), FEEDBACK_TO: z.string().email(),
  FEEDBACK_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/i), FEEDBACK_EMAIL_TOKEN: z.string().min(1),
});
const verificationSchema = z.object({ success: z.literal(true), hostname: z.string(), action: z.literal("feedback") });
const deliverySchema = z.object({ success: z.literal(true), result: z.object({ delivered: z.array(z.string()),
  queued: z.array(z.string()), permanent_bounces: z.array(z.string()) }) });
const detailsSchema = z.object({ reportSchemaVersion: z.literal(1), appVersion: z.string().max(32).regex(/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/),
  photo: z.object({ file: z.enum(["original-photo.png", "original-photo.jpg", "original-photo.webp"]) }),
  trace: z.object({}).passthrough() }).passthrough();

function json(status: number, body: object): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
async function readBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get("Content-Length")) > TRACE_REPORT_SEND_BODY_MAX_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return body + decoder.decode();
      size += value.byteLength;
      if (size > TRACE_REPORT_SEND_BODY_MAX_BYTES) { await reader.cancel(); return null; }
      body += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}
function validPhoto(type: string, content: string): boolean {
  if (content.length % 4 !== 0) return false;
  const padding = content.endsWith("==") ? 2 : content.endsWith("=") ? 1 : 0;
  const byteCount = content.length / 4 * 3 - padding;
  if (!byteCount || byteCount > TRACE_REPORT_SEND_PHOTO_MAX_BYTES) return false;
  // Search for invalid characters without a repeated regex group. A grouped
  // match can exhaust the regex engine's stack on large attachments.
  const unpadded = padding ? content.slice(0, -padding) : content;
  if (/[^A-Za-z0-9+/]/.test(unpadded)) return false;
  // Decode only the signature. Keeping another 15 MiB copy in a Worker risks
  // exhausting its memory while JSON is being prepared for Email Service.
  const bytes = atob(content.slice(0, 48));
  if (type === "image/png") return bytes.startsWith("\x89PNG\r\n\x1a\n");
  if (type === "image/jpeg") return bytes.charCodeAt(0) === 0xff && bytes.charCodeAt(1) === 0xd8 && bytes.charCodeAt(2) === 0xff;
  return bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP";
}
function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let content = "";
  for (let offset = 0; offset < bytes.length; offset += 12_288) {
    content += btoa(String.fromCharCode(...bytes.subarray(offset, offset + 12_288)));
  }
  return content;
}

/** Send only after the visitor submits the Trace form and passes Turnstile. */
export async function handleTracePhotoReport(request: Request, env: FeedbackEnv): Promise<Response> {
  if (request.method !== "POST") {
    const response = json(405, { error: "Method not allowed." });
    response.headers.set("Allow", "POST");
    return response;
  }
  const settings = settingsSchema.safeParse(env);
  if (!settings.success) return json(503, { error: "Photo reporting is temporarily unavailable. Please try again later." });
  const config = settings.data;
  const url = new URL(request.url);
  if (!config.TURNSTILE_HOSTNAMES.includes(url.hostname) || request.headers.get("Origin") !== url.origin) {
    return json(403, { error: "Please send this report from Pocketry." });
  }
  if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") {
    return json(415, { error: "Expected a JSON submission." });
  }
  const token = request.headers.get("X-Pocketry-Turnstile") ?? "";
  if (!token || token.length > 2048) return json(400, { error: "Complete the spam check before sending." });
  try {
    const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: config.TURNSTILE_SECRET_KEY, response: token }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!verification.ok) return json(503, { error: "The spam check is unavailable. Please try again." });
    const verified = verificationSchema.safeParse(await verification.json());
    if (!verified.success || verified.data.hostname !== url.hostname) {
      return json(403, { error: "The spam check expired or failed. Please complete it again." });
    }
  } catch { return json(503, { error: "The spam check is unavailable. Please try again." }); }

  let raw: unknown;
  try {
    const body = await readBody(request);
    if (body === null) return json(413, { error: "This photo report is too large to send." });
    raw = JSON.parse(body);
  } catch { return json(400, { error: "Could not read the photo report." }); }
  const parsed = tracePhotoSubmissionSchema.safeParse(raw);
  if (!parsed.success || parsed.data.website) return json(400, { error: "Check the photo report and email address." });
  const report = parsed.data;
  if (new TextEncoder().encode(report.details).length > TRACE_REPORT_SEND_DETAILS_MAX_BYTES ||
      !validPhoto(report.photo.type, report.photo.content)) {
    return json(400, { error: "The original photo or tracing details could not be accepted." });
  }
  let details: z.infer<typeof detailsSchema>;
  try { details = detailsSchema.parse(JSON.parse(report.details)); }
  catch { return json(400, { error: "The tracing details could not be accepted." }); }
  const suffix = report.photo.type === "image/jpeg" ? "jpg" : report.photo.type.split("/")[1];
  if (details.photo.file !== `original-photo.${suffix}`) return json(400, { error: "The photo and tracing details do not match." });
  try {
    const delivery = await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.FEEDBACK_ACCOUNT_ID}/email/sending/send`, {
      method: "POST", headers: { Authorization: `Bearer ${config.FEEDBACK_EMAIL_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: config.FEEDBACK_FROM, to: config.FEEDBACK_TO,
        subject: `[Pocketry Trace] Photo report (${details.appVersion})`,
        text: `Trace photo report\nReply email: ${report.replyEmail || "Not provided"}\n\nThe original photo and tracing details are attached.`,
        attachments: [
          { content: report.photo.content, filename: details.photo.file, type: report.photo.type, disposition: "attachment" },
          { content: encodeBase64(report.details), filename: "tracing-details.json", type: "application/json", disposition: "attachment" },
        ],
      }), signal: AbortSignal.timeout(30_000),
    });
    const result = deliverySchema.safeParse(await delivery.json());
    if (!delivery.ok || !result.success || result.data.result.permanent_bounces.includes(config.FEEDBACK_TO) ||
        ![...result.data.result.delivered, ...result.data.result.queued].includes(config.FEEDBACK_TO)) {
      return json(502, { error: "We could not confirm delivery. Your report is still here; please try again later." });
    }
    return json(200, { ok: true });
  } catch {
    return json(502, { error: "We could not confirm delivery. Your report is still here; please try again later." });
  }
}
