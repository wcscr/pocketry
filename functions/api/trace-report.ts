import { handleTracePhotoReport } from "../../cloudflare/trace-photo-report";
import type { FeedbackEnv } from "../../cloudflare/feedback";

/** Cloudflare Pages file-based route: /api/trace-report. */
export function onRequest(context: { request: Request; env: FeedbackEnv }): Promise<Response> {
  return handleTracePhotoReport(context.request, context.env);
}
