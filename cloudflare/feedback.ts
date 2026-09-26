import { z } from "zod";
import { feedbackSchema } from "../shared/schema";

/** Runtime settings are server-only; only the public Turnstile site key is exposed. */
export interface FeedbackEnv {
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_HOSTNAMES?: string;
  FEEDBACK_FROM?: string;
  FEEDBACK_TO?: string;
  FEEDBACK_ACCOUNT_ID?: string;
  FEEDBACK_EMAIL_TOKEN?: string;
}

const settingsSchema = z.object({
  TURNSTILE_SITE_KEY: z.string().min(1),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  // Deployment-specific allowlist; never infer approved hosts from the request.
  TURNSTILE_HOSTNAMES: z.string()
    .transform((value) => value.split(",").map((hostname) => hostname.trim().toLowerCase()).filter(Boolean))
    .pipe(z.array(z.string().max(253).regex(/^[a-z0-9.-]+$/)).nonempty()),
  FEEDBACK_FROM: z.string().email(),
  FEEDBACK_TO: z.string().email(),
  FEEDBACK_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/i),
  FEEDBACK_EMAIL_TOKEN: z.string().min(1),
});
const verificationSchema = z.object({
  success: z.literal(true),
  hostname: z.string(),
  action: z.literal("feedback"),
});
const deliverySchema = z.object({
  success: z.literal(true),
  result: z.object({
    delivered: z.array(z.string()),
    queued: z.array(z.string()),
    permanent_bounces: z.array(z.string()),
  }),
});
const MAX_BODY_BYTES = 32 * 1024;

function json(status: number, body: object): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

/** Bound the streamed body, including requests without Content-Length. */
async function readBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get("Content-Length")) > MAX_BODY_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

/** Shared by Pages Functions and Workers Static Assets; no Express server needed. */
export async function handleFeedback(request: Request, env: FeedbackEnv): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    const response = json(405, { error: "Method not allowed." });
    response.headers.set("Allow", "GET, POST");
    return response;
  }
  const settings = settingsSchema.safeParse(env);
  if (!settings.success) return json(503, { error: "Private feedback is temporarily unavailable. Please try again later." });
  if (request.method === "GET") return json(200, { siteKey: settings.data.TURNSTILE_SITE_KEY });

  const url = new URL(request.url);
  if (!settings.data.TURNSTILE_HOSTNAMES.includes(url.hostname)) return json(403, { error: "Please send feedback from Pocketry." });
  if (request.headers.get("Origin") !== url.origin) return json(403, { error: "Please send feedback from Pocketry." });
  if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") {
    return json(415, { error: "Expected a JSON submission." });
  }

  let raw: unknown;
  try {
    const body = await readBody(request);
    if (body === null) return json(413, { error: "Your message is too large." });
    raw = JSON.parse(body);
  } catch {
    return json(400, { error: "Could not read your submission." });
  }
  const parsed = feedbackSchema.safeParse(raw);
  if (!parsed.success) return json(400, { error: "Check your summary, message, email address, and spam check." });
  const feedback = parsed.data;
  if (feedback.website) return json(400, { error: "Could not accept this submission." });

  const config = settings.data;
  try {
    const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: config.TURNSTILE_SECRET_KEY, response: feedback.turnstileToken }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!verification.ok) return json(503, { error: "The spam check is unavailable. Please try again." });
    const verified = verificationSchema.safeParse(await verification.json());
    if (!verified.success || !config.TURNSTILE_HOSTNAMES.includes(verified.data.hostname) || verified.data.hostname !== url.hostname) {
      return json(403, { error: "The spam check expired or failed. Please complete it again." });
    }
  } catch {
    return json(503, { error: "The spam check is unavailable. Please try again." });
  }

  // Keep the sender and recipient fixed in server settings. Visitor text is plain
  // text only, and their optional email is part of the body, never a mail header.
  const kind = feedback.kind === "problem" ? "Problem" : "Suggestion";
  try {
    const delivery = await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.FEEDBACK_ACCOUNT_ID}/email/sending/send`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${config.FEEDBACK_EMAIL_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: config.FEEDBACK_FROM,
        to: config.FEEDBACK_TO,
        subject: `[Pocketry ${kind}] ${feedback.subject}`,
        text: `${kind}: ${feedback.subject}\nReply email: ${feedback.replyEmail || "Not provided"}\n\n${feedback.message}`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = deliverySchema.safeParse(await delivery.json());
    if (!delivery.ok || !result.success ||
      result.data.result.permanent_bounces.includes(config.FEEDBACK_TO) ||
      ![...result.data.result.delivered, ...result.data.result.queued].includes(config.FEEDBACK_TO)) {
      return json(502, { error: "We could not confirm delivery. Your message is still here; please try again later." });
    }
    return json(200, { ok: true });
  } catch {
    // Never log visitor content, addresses, credentials, or upstream responses.
    return json(502, { error: "We could not confirm delivery. Your message is still here; please try again later." });
  }
}
