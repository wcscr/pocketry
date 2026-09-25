import { handleFeedback, type FeedbackEnv } from "./feedback";

interface Env extends FeedbackEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

/** Optional Workers deployment of the same static app and feedback endpoint. */
export default {
  fetch(request: Request, env: Env): Promise<Response> {
    if (/^\/api\/feedback\/?$/.test(new URL(request.url).pathname)) return handleFeedback(request, env);
    return env.ASSETS.fetch(request);
  },
};
