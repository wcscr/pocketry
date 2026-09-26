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

- **Pages (Pocketry's current deployment):** `wrangler.jsonc` sets
  `pages_build_output_dir` and the public runtime variables. `functions/api/feedback.ts`
  handles the endpoint. Vite copies
  `client/public/_routes.json` to `dist/public` so only feedback invokes a
  function; normal app requests remain static.
- **Optional Workers Static Assets:** `wrangler.worker.jsonc` uses
  `cloudflare/worker.ts` and runs the Worker first only for the feedback endpoint.
  Select it explicitly with `wrangler deploy --config wrangler.worker.jsonc`.
- Both adapters call `cloudflare/feedback.ts`. The existing Express image API
  is not deployed or needed for this feature. `npm run dev` alone does not
  emulate the Cloudflare endpoint; the form shows an unavailable message there.

## Production setup

The receiving address is `contact@pocketry.xyz`, which the site owner configured
to forward to their inbox. The same address is the fixed sender under the
onboarded `pocketry.xyz` domain. The Pages configuration supplies both addresses,
the account ID from the project's deployment record, the public Turnstile site
key, and the allowed hostname. Live forwarding and form-to-inbox delivery have
not yet been verified.
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
4. The non-secret **runtime** settings below are applied automatically from
   `wrangler.jsonc` when deploying. Add only the two encrypted secrets in the
   Cloudflare project; never use `VITE_*` variables for secrets.

   | Setting | Value |
   | --- | --- |
   | `TURNSTILE_SITE_KEY` | `0x4AAAAAAFEX5UTaSUHC-qpj` (public) |
   | `TURNSTILE_SECRET_KEY` | Existing widget's secret key (encrypted secret) |
   | `TURNSTILE_HOSTNAMES` | `pocketry.xyz` (comma-separated exact hostnames) |
   | `FEEDBACK_ACCOUNT_ID` | `83f2f573b101abdbbd8300b84c2cdbe9` |
   | `FEEDBACK_EMAIL_TOKEN` | Scoped Email Sending token |
   | `FEEDBACK_FROM` | `contact@pocketry.xyz` |
   | `FEEDBACK_TO` | `contact@pocketry.xyz`; verify this recipient with Cloudflare |

   In **Workers & Pages → Pocketry → Settings → Variables and Secrets**, select
   **Production** and add `TURNSTILE_SECRET_KEY` and `FEEDBACK_EMAIL_TOKEN` as
   encrypted secrets before deployment. The configuration file owns the other
   settings; edit those values in the file rather than the dashboard.
   Production hostnames must not contain `localhost` or `127.0.0.1`. Keep the
   server allowlist consistent with the widget's dashboard hostname list.

5. Deploy using the existing Pages Git integration (root `functions/` and
   build output `dist/public`). Keep GitHub CI disabled per `CLAUDE.md`; run
   checks locally. The root Wrangler file is a Pages configuration and must not
   contain Workers-only `main` or `assets` fields. A file without
   `pages_build_output_dir` does not apply runtime settings to Pages deployments.
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

## Preview setup and troubleshooting

Use the stable branch preview at
`https://codex-private-feedback.pocketry.pages.dev` for this feature.
`env.preview.vars` provides all five public settings and allows only that exact
preview hostname. Production keeps its separate `pocketry.xyz` allowlist.

1. In the Pages project's **Settings → Variables and Secrets**, select
   **Preview** and save `TURNSTILE_SECRET_KEY` and `FEEDBACK_EMAIL_TOKEN` as
   encrypted secrets. Settings saved for Production do not configure Preview.
2. In the existing Turnstile widget's **Settings → Hostname Management**, add
   `codex-private-feedback.pocketry.pages.dev`. Keep `pocketry.xyz` allowed.
3. Create a new preview deployment after changing secrets, then test using the
   stable branch URL above. The deployment-specific hash URL is not in the
   server allowlist. Do not add every `pages.dev` hostname or disable validation.

Check `GET /api/feedback` before trying the form. A JSON response with `siteKey`
means the settings have the expected shape; it does not validate secret values.
HTTP 503 means at least one required setting is missing or malformed. HTML means
the route did not reach the Pages Function. A widget error after configuration
loads can mean the preview hostname is missing from the widget's allowed list.

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

Implementation verification: `npm run check`, all 1,911 tests in 110 files,
and `npm run build` passed on Node 22.23.2. Both Cloudflare entry points also
bundled with esbuild's browser target. Tests cover mismatched hostnames/actions,
malformed Siteverify responses, simulated token replay rejection, and retrying
with a fresh token on the same widget. Browser inspection covered Help,
mobile-menu entry at 375 × 812, dialog scrolling, unavailable service feedback,
and draft preservation. External APIs were mocked in tests; real Turnstile
verification and inbox delivery remain deployment checks.

On September 26, 2026, the feature preview returned HTTP 503 JSON: the Function
was deployed, but its runtime settings were incomplete. The original root file
was a Workers configuration and Pages ignored its variables. The corrected
Pages configuration and separate preview settings address that deployment gap.

## References

- [Pages Functions routing](https://developers.cloudflare.com/pages/functions/routing/)
- [Pages Wrangler configuration and preview overrides](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)
- [Pages secrets](https://developers.cloudflare.com/pages/functions/bindings/#secrets)
- [Turnstile hostname management](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/)
- [Workers Static Assets routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- [Turnstile server verification](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Turnstile Spin existing-widget flow](https://developers.cloudflare.com/turnstile/spin/prompt.md)
- [Cloudflare Email Service REST API](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/)
- [Email domain setup](https://developers.cloudflare.com/email-service/get-started/send-emails/)
- [Email pricing](https://developers.cloudflare.com/email-service/platform/pricing/)

Checked September 24, 2026. Sending to verified destinations is currently free;
arbitrary-recipient sending requires a paid Workers plan. Pages/Workers request
quotas still apply. Recheck account availability and pricing before provisioning.
