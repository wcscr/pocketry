import { handleFeedback, type FeedbackEnv } from "../../cloudflare/feedback";

/** Cloudflare Pages file-based route: /api/feedback. */
export function onRequest(context: { request: Request; env: FeedbackEnv }): Promise<Response> {
  return handleFeedback(context.request, context.env);
}
