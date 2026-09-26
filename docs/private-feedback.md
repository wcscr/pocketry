# Private feedback on Cloudflare

Pocketry's Help dialog offers **Report a Problem** and **Make a Suggestion**.
Both are also in the mobile More options menu. Visitors enter a summary, a
message, and an optional reply email. No signup is required. The form sends
only those fields and a spam-check token when the visitor chooses **Send
privately**. It never attaches photos, projects, browser details, or URLs.
Drafts remain in memory on failure or close, but do not survive a page reload.

## Architecture

The React app remains statically served. `GET /api/feedback` returns the public
Turnstile site key only when all server settings are present. `POST` validates
the request, verifies Turnstile server-side (including hostname and action),
and sends plain-text email through Cloudflare Email Service's REST API. There
is no feedback database or public issue creation. The configured recipient's
mailbox is the inbox and determines message retention.

- **Pages:** `functions/api/feedback.ts` handles the endpoint. Vite copies
  `client/public/_routes.json` to `dist/public` so only feedback invokes a
  function; normal app requests remain static.
- **Workers Static Assets:** `wrangler.jsonc` uses `cloudflare/worker.ts` and
  runs the Worker first only for the feedback endpoint. Other paths use assets.
- Both adapters call `cloudflare/feedback.ts`. The existing Express image API
  is not deployed or needed for this feature. `npm run dev` alone does not
  emulate the Cloudflare endpoint; the form shows an unavailable message there.

## Production setup

The receiving address is `contact@pocketry.xyz`, which the site owner configured
to forward to their inbox. This is recorded in the Workers configuration and
local settings example. For Pages, set `FEEDBACK_TO=contact@pocketry.xyz` in the
project's runtime variables as well; the Workers configuration does not configure
Pages. Live forwarding and form-to-inbox delivery have not yet been verified.
The forwarding address provides the receiving side; the sending service and
Turnstile settings below are still required.

1. Configure a sender domain in Cloudflare Email Service. The domain must use
   Cloudflare DNS. Verify the intended feedback inbox as a destination address
   in your account. Confirm Email Sending is available in the account before
   enabling the feature; the current sending API is documented as beta.
2. Create an API token scoped to this account with **Email Sending: Edit**.
   Use a dedicated token rather than a general Cloudflare deployment token.
3. Use the existing Turnstile widget with public site key
   `0x4AAAAAAFEX5UTaSUHC-qpj`, configured for `pocketry.xyz`. Do not create a
   replacement widget or change its pre-clearance settings. Preview deployments
   need their own allowed hostname and settings; avoid allowing arbitrary
   preview hosts to send to the production inbox.
4. Add the following **runtime** settings in the Cloudflare project. The
   token and secret key must be encrypted secrets, never `VITE_*` variables.

   | Setting | Value |
   | --- | --- |
   | `TURNSTILE_SITE_KEY` | `0x4AAAAAAFEX5UTaSUHC-qpj` (public) |
   | `TURNSTILE_SECRET_KEY` | Existing widget's secret key (encrypted secret) |
   | `TURNSTILE_HOSTNAMES` | `pocketry.xyz` (comma-separated exact hostnames) |
   | `FEEDBACK_ACCOUNT_ID` | 32-character Cloudflare account ID |
   | `FEEDBACK_EMAIL_TOKEN` | Scoped Email Sending token |
   | `FEEDBACK_FROM` | Fixed sender address in the configured sender domain |
   | `FEEDBACK_TO` | `contact@pocketry.xyz`; verify this recipient with Cloudflare |

   In **Workers & Pages → Pocketry → Settings → Variables and Secrets**, select
   **Production** and add the settings before deployment. The Workers config
   supplies the public site key, hostname allowlist, and recipient; a Pages
   project needs those same three values entered in its runtime settings.
   Production hostnames must not contain `localhost` or `127.0.0.1`. Keep the
   server allowlist consistent with the widget's dashboard hostname list.

5. Deploy using the existing Pages Git integration (root `functions/` and
   build output `dist/public`) or the Workers configuration. Keep GitHub CI
   disabled per `CLAUDE.md`; run checks locally. The root Wrangler file is a
   Workers configuration, not a Pages configuration; do not use it as a Pages
   configuration file or add `pages_build_output_dir` to it.
6. Submit one clearly marked test with a fresh real Turnstile token from the
   deployed site and confirm the email
   arrives. Verify the sender, recipient, problem/suggestion prefix, optional
   reply address in the message body, and that replying manually is possible.
   Replay that same POST once and confirm HTTP 403 with no second email sent.
   Local tests and the presence of a secret binding do not prove that its value
   matches the widget, live verification succeeds, or inbox delivery works.

The owner reported saving `TURNSTILE_SECRET_KEY` through Cloudflare's dashboard.
The secret was not retrieved into the repository or chat. The existing-widget
Spin flow requires an approved external Wrangler installation and a confirmed
secret destination for automatic retrieval; use the dashboard's normal secret
management when those prerequisites are unavailable. Destination validation
remains pending until a deployed request succeeds and replay is rejected.

Turnstile loads only while the feedback form is open. If adding a Content
Security Policy, permit the documented Turnstile script/frame origins.
Consider an additional Cloudflare rate-limit rule on POST `/api/feedback`
for inbox-volume control. The handler enforces a 32 KiB streamed request cap,
field limits, same-origin JSON requests, a honeypot, and single-use Turnstile
tokens. There is no application-level per-IP rate limiter or durable queue.

Success means Cloudflare reports the configured recipient as delivered or
queued. A rejection, bounce, malformed response, timeout, or missing runtime
setting never produces a success message. The form retains its text and requires
a fresh token on retry by resetting its specific widget ID. An ambiguous email timeout can result in a duplicate
message if the visitor retries; there is no persistent deduplication store.
Application logs intentionally exclude feedback contents and upstream responses.
Cloudflare and the destination mail provider still process normal request and
email metadata.

## Local verification

Run `npm run check`, `npm test`, and `npm run build`. Handler tests mock only
the external Turnstile and email APIs. UI tests cover success, failed delivery,
unavailable configuration, explicit submission, and draft preservation.
For manual local runtime testing, copy `.dev.vars.example` to `.dev.vars` and
use a separately installed Wrangler with the built app. Real credentials can
send real email; use a dedicated test inbox and widget. Turnstile dummy keys
are for test environments only and must never be used in production.

Implementation verification: `npm run check`, all 1,907 tests in 110 files,
and `npm run build` passed on Node 22.23.2. Both Cloudflare entry points also
bundled with esbuild's browser target. Tests cover mismatched hostnames/actions,
malformed Siteverify responses, simulated token replay rejection, and retrying
with a fresh token on the same widget. Browser inspection covered Help,
mobile-menu entry at 375 × 812, dialog scrolling, unavailable service feedback,
and draft preservation. External APIs were mocked in tests; real Turnstile
verification and inbox delivery remain deployment checks.

On September 26, 2026, the live `GET https://pocketry.xyz/api/feedback` still
returned HTML rather than JSON, so the feedback backend was not yet deployed.

## References

- [Pages Functions routing](https://developers.cloudflare.com/pages/functions/routing/)
- [Workers Static Assets routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- [Turnstile server verification](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Turnstile Spin existing-widget flow](https://developers.cloudflare.com/turnstile/spin/prompt.md)
- [Cloudflare Email Service REST API](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/)
- [Email domain setup](https://developers.cloudflare.com/email-service/get-started/send-emails/)
- [Email pricing](https://developers.cloudflare.com/email-service/platform/pricing/)

Checked September 24, 2026. Sending to verified destinations is currently free;
arbitrary-recipient sending requires a paid Workers plan. Pages/Workers request
quotas still apply. Recheck account availability and pricing before provisioning.
