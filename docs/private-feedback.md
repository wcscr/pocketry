# Private feedback on Cloudflare Pages

Open [Send feedback](https://pocketry.xyz/feedback) directly, or choose **Send feedback**
from Help or the header feedback menu. In the shared form, the visitor chooses a
problem report or suggestion and enters a summary, message, and optional reply
email. No account is required. Leaving the reply address blank does not identify
the visitor to Pocketry. Cloudflare still processes normal request and Turnstile
metadata. Photos, projects, browser details, and URLs are never attached to the
submission. Draft text stays in memory after closing or a failed send, but a page
reload clears it.

## Free-plan design

Keep the app on Cloudflare Pages. The static app is served normally; `_routes.json`
invokes a Pages Function only for `/api/feedback`. That function validates the
form and a single-use Turnstile token, then uses Cloudflare Email Service's REST
API to send plain text to one **verified Email Routing destination address**.
The reports live in that inbox, with no application database or public issue.
Cloudflare Email Service currently permits sends to verified destinations on
Workers Free, even when the account only uses Email Routing. A public alias such
as `feedback@pocketry.xyz` is a routing address, not necessarily the verified
destination; send to the actual verified inbox address to stay within the free
exception. Arbitrary recipients require Workers Paid. `feedback@pocketry.xyz`
is the public address and fixed sender; its forwarding destination is configured
separately as a secret.

Pages Functions share Workers Free's 100,000 requests/day and 10 ms CPU limit.
Only feedback requests consume Function invocations. Turnstile Free includes
unlimited verifications and up to 10 hostnames per widget. No extra Worker,
database, or paid email provider is needed. Confirm current plan availability in
the account before enabling it; Email Sending remains a beta service.

## Production setup

1. In **Compute → Email Service → Email Routing → Destination Addresses**, find
   the inbox that receives mail forwarded from `feedback@pocketry.xyz`. Confirm
   that this **destination** is verified. If no suitable destination is verified,
   add one and complete its verification email. Keep its actual address private.
2. Create the `feedback@pocketry.xyz` routing address and confirm it forwards to
   that inbox. Confirm `pocketry.xyz` is onboarded for Email Sending. The fixed
   sender is `feedback@pocketry.xyz`. Create a dedicated Cloudflare API token for this
   account with **Email Sending: Edit**. Do not use a general deployment token.
3. Keep the existing Turnstile widget site key in `wrangler.jsonc`. Confirm its
   hostname list includes `pocketry.xyz`. Do not use Turnstile test keys in
   production.
4. Under **Workers & Pages → pocketry → Settings → Variables and Secrets**, set
   these three encrypted runtime secrets for **Production**:

   | Name | Value |
   | --- | --- |
   | `TURNSTILE_SECRET_KEY` | Secret of the existing Turnstile widget |
   | `FEEDBACK_EMAIL_TOKEN` | Dedicated Email Sending API token |
   | `FEEDBACK_TO` | Actual verified Email Routing destination address |

   `wrangler.jsonc` supplies the public runtime settings: the site key, exact
   allowed hostname, Cloudflare account ID, and fixed sender. Never use `VITE_*`
   variables for secrets. A missing setting makes the form report unavailable.
5. Deploy the reviewed Pages branch using the existing Pages Git integration.
   Keep GitHub CI disabled. The root `wrangler.jsonc` uses
   `pages_build_output_dir`; the `functions/api/feedback.ts` adapter handles the
   request. `npm run dev` alone does not emulate that Pages Function.
6. Open the deployed form with a fresh Turnstile token and send one clearly
   marked test report. Confirm the response and actual arrival in the verified
   inbox, including its sender, subject prefix, body, and optional reply address.
   Replay the same POST once and confirm it receives HTTP 403 and sends no second
   email. A queued API response alone does not prove final inbox delivery.

## Preview setup

The branch preview uses `codex-private-feedback.pocketry.pages.dev` as its exact
server hostname. Add that hostname to the **existing Turnstile widget's** allowed
hostnames. Set the same three encrypted secrets under the Pages project's
**Preview** environment; a separate verified test inbox is preferable for
`FEEDBACK_TO`. Production secrets do not populate Preview. Create a new preview
deployment after changing the settings and test at the stable branch URL. A
random deployment hash hostname is not in the server allowlist.

`GET /api/feedback` returns a public `siteKey` if the runtime settings are
present. HTTP 503 means a required setting is missing or malformed; HTML means
the request did not reach the Function. This GET check does not verify secret
values, Turnstile success, account entitlement, or mail delivery.

## Data handling and safeguards

The request accepts only same-origin JSON with a 32 KiB streamed body limit,
limited text fields, a honeypot, and a Turnstile token verified server-side for
its action and exact hostname. The sender and recipient are fixed in server
settings; user text never becomes a mail header or recipient. The Function does
not log report contents, email addresses, secrets, or upstream responses. The
form keeps its draft on failure and requires a fresh token for a retry. Cloudflare
and the destination mailbox provider process their normal metadata and retain
messages under their own settings. An ambiguous provider timeout can cause a
duplicate if the visitor retries; there is no durable deduplication store.

The app has no per-IP rate limiter or queue. Add a narrowly scoped Cloudflare
rate-limiting rule for `POST /api/feedback` if inbox volume warrants it and the
account's free-plan rule allowance permits it.

## Local verification

Run `npm run check`, `npm test`, `npm run test:workflows`, and `npm run build` on
Node 26, then `git diff --check`. The handler tests mock external Turnstile and
email APIs. For local Cloudflare runtime testing, copy `.dev.vars.example` to
`.dev.vars` and use a separately installed Wrangler with the built app and a
dedicated test inbox/widget. Never commit `.dev.vars`.

## References

- [Cloudflare Pages Functions routing](https://developers.cloudflare.com/pages/functions/routing/)
- [Pages Wrangler configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)
- [Pages Function pricing](https://developers.cloudflare.com/pages/functions/pricing/)
- [Workers Free limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Turnstile plans](https://developers.cloudflare.com/turnstile/plans/)
- [Turnstile server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Email Service pricing](https://developers.cloudflare.com/email-service/platform/pricing/)
- [Verified destination addresses](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/)
- [Email Sending REST API](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/)

Cloudflare documentation checked November 17, 2026. Recheck plan terms before
provisioning or release.
