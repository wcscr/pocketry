# Pocketry Library implementation plan

Planning baseline: September 20, 2026; Pocketry checkout `437c058`, project schema v19. Architecture revised to Cloudflare D1 following the cost/bootstrap discussion. This document plans the work; it does not provision services, publish designs, or implement the feature.

## 1. Product and launch decisions

Build **Pocketry Library**, a curated community for editable Pocketry bin designs. It is a separate application and repository, presented through a **Discover** workspace inside Pocketry and through public, searchable design pages. Start with 3–5 designs selected by Will. A small, useful collection is sufficient to launch; do not delay for dozens of listings.

The main workflow is: find a design for a tool or storage need, assess its dimensions and fit evidence, open an independent local copy, customize it, and export it through Pocketry. Browsing, importing into Pocketry, downloading the editable project, and using the editor remain available without an account. Accounts enable submissions, ratings, comments, fit reports, and favorites.

Confirmed decisions:

- No login or account creation is required to browse/search published designs, read print details and approved community feedback, view public images, download a project, or import it into Pocketry. Editing, saving to local My projects, and exporting that copy also remain anonymous. This applies to both integrated Discover and direct public links; any future change requires a separate product decision.
- Start with curated community submissions: every new design and public revision requires moderator approval.
- Require an editable `.pocketry.json` project for every listing. Launch attachments are raster images; printable exports are generated in Pocketry. Standalone STL/3MF uploads are a later feature.
- Seed the catalog with a few of Will's designs, attributed to Will or the creator name he selects.
- Keep local editing and personal project storage independent of the online service. Upload happens only through an explicit publishing action.
- Use Cloudflare D1 for community data, Workers for the API/public pages, and R2 for project/image objects. Target free-tier operation for the pilot, with a measured path to the $5/month Workers paid plan if CPU or usage requires it. Remove the previous Render/Supabase/SMTP stack.
- Leave the new catalog's **software license undecided**. Do not implicitly apply Pocketry's AGPL to the new repository, select a proprietary license, or publish the catalog source while that decision is pending. Pocketry changes retain its existing license.
- Launch with **all monetization absent**: no affiliate links, ads, sponsored placements, shopping interface, checkout, paid files, subscriptions, or creator payouts. Preserve product identities and documented extension points so a later monetization module can be deployed disabled and switched on deliberately.

Success means a visitor can find one of the seed designs, understand what it fits, open and edit it without losing existing work, and generate a printable export. A contributor can submit a design and receive a moderation decision. Community feedback must identify which design revision it describes.

## 2. Architecture and ownership

Use two repositories. `pocketry` continues to own the editor, project format, geometry, local persistence, and its native Discover integration. A proposed `pocketry-library` repository owns the catalog website, API, accounts, moderation, database migrations, upload handling, product compatibility records, and operating runbooks. GitHub stores source and reviewed development fixtures; production metadata lives in D1 and project/image bytes in R2.

| Layer | Planned implementation | Reason |
| --- | --- | --- |
| Pocketry editor | Existing React/Vite application, with lazy-loaded Discover views | Preserve current performance, offline-capable editing, and UI conventions |
| Catalog website and API | TypeScript + Hono on one Cloudflare Worker; static JS/CSS via Workers Static Assets | Small HTTP service and lightweight public HTML, with no always-on Node server |
| Database | Cloudflare D1, SQLite schema, Drizzle for typed access, Wrangler SQL migrations | Managed community metadata and search; no database server subscription |
| Files | Private R2 Standard bucket, separated into incoming and approved object prefixes | Keep large JSON files/photos out of D1 |
| Identity | Better Auth with its Drizzle SQLite adapter; Google and GitHub social sign-in as the proposed default | Store accounts/sessions in D1; avoid passwords and outbound login email |
| Public routing | Catalog Worker owns `/discover` and `/discover/*` on the Pocketry origin | Same-origin cookies/API, no extra proxy or paid app host |
| Search | D1 FTS5 plus indexed normalized brand/model identifiers | Small-catalog relevance without a search subscription |
| Notifications | In-app only at launch | No SMTP service or email delivery jobs |
| Recovery | D1 Time Travel plus encrypted SQL/object exports to operator-controlled storage | Low-cost recovery, including a copy outside the Cloudflare account |

Deploy the catalog Worker directly on the `/discover` route namespace, including its static assets, auth callbacks, and API. Preserve the existing editor deployment for all other routes. Route matching must include the exact `/discover` path and its descendants without swallowing unrelated prefixes. Disable or restrict alternate production hostnames to prevent alternate-origin authentication or bypass paths. Local development uses a same-origin development proxy. The catalog uses the Workers runtime; Node.js 22 remains the local build/tooling runtime. [Hono on Workers](https://hono.dev/docs/getting-started/cloudflare-workers), [Cloudflare routing](https://developers.cloudflare.com/workers/configuration/routing/routes/).

Public browse/detail HTML uses small Hono JSX/templates and progressively enhanced interactions, with metadata queries shared with the JSON API. Use static assets for scripts/styles and cache anonymous public responses for at most 60 seconds. Do not run Next.js/React server rendering, geometry generation, or image codecs in the request path. Measure CPU on the real Worker, including authentication and maximum accepted JSON payloads, before selecting Free versus Paid. Cached responses that still invoke a Worker are still Worker requests; free static-asset delivery does not make all dynamic routes free.

Within an already-open Pocketry SPA, client-side `/discover` navigation renders Pocketry-owned React views against the catalog API. A direct request or page refresh at the same URL renders the catalog's server-rendered page. These are independently authored views sharing a documented data contract, not a runtime-loaded application or iframe. Their content, URLs, and primary actions must pass parity tests. This deliberately adds a second presentation layer to preserve both the editor session and public-page discovery.

Do not import or copy AGPL editor components, validators, geometry, or schema implementation into the license-undecided catalog. Use HTTP/JSON contracts, independently authored catalog UI and intake validation, and Pocketry's own validation experience described below. This is an engineering separation, not a conclusion about legal independence. Any proposed code sharing requires a specific compatibility decision first; do not claim that a separate repository automatically resolves licensing.

Keep a versioned OpenAPI document in the catalog repository. Pocketry consumes checked-in generated API types/client code only after the contract's redistribution terms are explicitly approved; until then, use a small independently authored typed HTTP adapter. Catalog code never becomes an editor runtime dependency. Pin production dependencies and record their licenses/provenance in each repository.

## 3. User experience

### Discover and public listing pages

- Add **Discover** beside Trace and Bin. Keep browser-local saved projects labeled **My projects** where needed to distinguish them from the public library.
- Launch with a curated featured row and a compact grid. Hide empty categories, empty review summaries, and unused filter groups. Show “No ratings yet” rather than a fabricated zero-star score.
- Support text search, exact brand/model matching, category, physical width/depth/height, grid pitch, filament material, and fit-evidence filters. Material filtering searches the creator's approved published print setups. Store and display both physical dimensions and selected-pitch grid units; a half-pitch `4 × 4` bin must not be confused with a full-pitch `4 × 4` bin.
- Default browse ordering is manually featured designs followed by newest publications. With a search query, prioritize exact brand/model matches, then text relevance. Launch without a popularity or paid-ranking algorithm.
- Cards show cover image, title, creator, dimensions, and fit-evidence summary. The detail page adds a photo gallery, description, tool models, required material/hardware specifications, structured print setups and notes, revision history, license, attribution, and reviews/comments. Optional manufacturer/source references identify compatibility or provenance; there are no purchase buttons, retailer recommendations, or shopping sections.
- Primary action: **Open in Pocketry**. Secondary: **Download editable project**. Explain that printable STL/3MF exports are available after opening. Do not label a raster screenshot as an interactive 3D preview.
- Use `/discover/designs/{designId}/{slug}` as the canonical design URL; IDs are authoritative and outdated slugs redirect. Add collection and creator pages, sitemap entries, canonical tags, page titles, and social preview images. Drafts, account pages, and moderation pages are excluded from indexing.
- Public pages must contain useful listing content without JavaScript. Inside the editor, load Discover code only when requested. Browsing does not load OpenCV or start geometry work.

### Accounts and community actions

Prompt for sign-in only when the visitor chooses an account-dependent action: submit/upload a design, write a rating/comment/fit report, save a catalog favorite, report content through the account workflow, or manage an account. Never put a signup modal or authentication redirect in the browse → inspect → Open in Pocketry → edit/export flow. Catalog favorites are account-backed; local My projects is independent of them. Session discovery runs independently and must not delay public content or imports; missing/expired sessions and an unavailable identity provider leave the anonymous workflow usable.

Proposed launch default: **Google and GitHub sign-in**, with no passwords, email codes, or outbound email service. D1 is the database, not an identity provider. Use Better Auth's maintained provider/session implementation with the Drizzle SQLite adapter, and prove D1/Worker compatibility in milestone A. Provider selection is a product preference; this default applies unless Will chooses another option. Public profile fields are handle, display name, optional bio, and published designs; email remains private. Request identity-only provider scopes, never repository access. [Better Auth Hono integration](https://better-auth.com/docs/integrations/hono), [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), [Drizzle D1 driver](https://orm.drizzle.team/docs/sqlite/connect-cloudflare-d1).

Start login in a user-initiated popup/new tab so the editor remains mounted. On callback, signal only completion to the opener with strict source/origin checks; never pass tokens in messages. The original tab then reads `/session`. Provide a visible retry/new-tab link if the popup is blocked. Do not automatically navigate an unsaved editor away. Identity is keyed by provider plus stable provider subject; disable automatic email-based account linking. An authenticated user can explicitly link a second provider after reauthentication. Social login does not imply approval to publish without moderation.

- Ratings: integers 1–5, one current rating per user/design, carrying the revision evaluated. Users can edit/delete their own rating and cannot rate their own design. Show count and mean; distinguish ratings of older revisions. A new revision does not inherit a claim of confirmed fit.
- Comments: plain text, up to 2,000 characters, with one reply level. Authors can edit/delete their own comments; edited comments show an edited marker. Record the revision being viewed when posted. No HTML, embedded media, direct messages, or automatic remote previews.
- Fit reports: revision, exact tool model where applicable, `fits / too tight / too loose / other issue`, a structured actual print setup, optional notes, and optional photo. A submitter's claim is labeled **Creator reports fit**. Other users' reports are labeled **Community fit reports**, with outcomes/counts visible. Neither is described as independently certified.
- Favorites: private user/design bookmarks. No public follower graph in v1.
- Reports: a signed-in user can report spam, abuse, ownership concerns, misleading compatibility, or unsafe/malformed content. Moderators can hide content, suspend accounts, and resolve reports with an audit record. Ratings are not removed merely because they are negative.
- Start with pre-moderation of public comments, fit reports/photos, and revisions. Trusted-member bypass is deferred. Show pending feedback privately to its author. The moderation dashboard has one queue with filters rather than separate disconnected tools.
- In-app notifications cover moderation decisions and replies. Email notifications are deferred; no marketing enrollment is inferred from signup.

### Filament and print details

Treat this as a first-class v1 feature, not one large “print notes” textbox. A revision can include multiple named setups, such as “PLA, 0.4 mm nozzle” and “PETG, 0.6 mm nozzle.” Distinguish **Suggested settings**, **Creator's actual print**, and **Community member's actual print**. A successful print or fit claim refers to the actual setup and design revision used; suggestions are never displayed as tested evidence.

| Group | Structured fields |
| --- | --- |
| Filament | Manufacturer/brand, product line/name, base material (PLA, PETG, ABS, ASA, TPU, PA, PC, other), variant/additives, color name and optional swatch, filament diameter, optional spool/lot notes |
| Multiple materials | One or more filament entries, each with its printed role/part or material slot; support body/floor/other combinations rather than a single global filament field |
| Printer and nozzle | Manufacturer/model, relevant printer modification notes, nozzle diameter and material, build-plate surface |
| Slicer | Application, version, named preset/profile, optional adaptive-layer-height indicator |
| Geometry-related settings | Layer height, first-layer height, wall/perimeter count, top and bottom shell settings with explicit layer-count or millimeter units, infill percentage and pattern |
| Temperatures | Per-filament nozzle temperature, bed temperature, optional chamber temperature; optional separate first-layer values |
| Other useful settings | Outer-wall and infill speeds, cooling percentage, supports enabled/type, brim/raft choice, print orientation, dimensional/hole compensation with explicit units |
| Results and notes | Actual or estimated print duration and filament mass, print date for actual prints, drying/post-processing notes, fit/finish observations, associated print photo |

Use progressive disclosure: initially show material, printer, nozzle diameter, layer height, walls, and infill, with **More print details** for the rest. Optional unknown values remain blank/unknown, never invented zeroes or defaults. Selecting “PLA” does not infer brand, temperature, or fit. Require a setup label and suggested/actual classification; other fields are optional so incomplete historical prints can still be documented honestly. Require an explicit material entry or “Not recorded” for actual-print reports.

Store structured units (millimeters, degrees Celsius, millimeters/second, percent, grams, minutes), validate types/ranges, and render consistent labels. Preserve freeform notes alongside the fields. Support a custom value for unlisted brands, materials, infill patterns, and printers. Distinguish estimates from measurements. Do not silently convert shell layer counts to thickness when adaptive layer height makes that inaccurate.

Use a versioned `PrintSetup` schema within the catalog for revision setups and fit-report setups. An actual report may start by copying a suggested setup, but the author must confirm/edit it and the report stores a snapshot, not a mutable reference. Later profile edits must not change the settings recorded for an earlier successful print. Editing creator-published setups follows normal revision moderation; editing community setups follows feedback moderation. Printer/filament details describe printing conditions and do not change the editable bin geometry or automatically alter a user's slicer.

V1 supports viewing, comparing, and copying the human-readable settings summary. Importing slicer profiles, executable G-code, printer configuration archives, and ready-to-print machine jobs is deferred. A filament product name is descriptive compatibility/print information, with no shopping or affiliate behavior in the initial release.

## 4. Pocketry integration and data preservation

The relevant existing entrypoints are `client/src/pages/bin-designer.tsx`, `client/src/lib/project/persist.ts`, and `shared/gridfinity/project.ts`. Their current behavior needs extension rather than replacement: imports already parse/migrate documents and flush named projects, but unnamed drafts and multi-key IndexedDB updates need explicit handling for catalog imports.

### Navigation and session lifetime

Keep TraceProvider and ShapeLibraryProvider above routing. Preserve the live Bin workspace across internal Discover visits using a persistent workspace host: mount Bin after its first visit, hide it when inactive, and pause rendering/geometry work while hidden. Return to the same selection, camera, history, and in-memory draft. Do not rely on an asynchronous unmount cleanup to protect the latest edit.

Navigation from the native Discover views uses the SPA router. The server-rendered catalog's Open action navigates to `/bin?catalogDesign={id}&catalogRevision={id}`. An explicit reload continues to use Pocketry's existing persistence guarantees; the feature does not claim that unsaved Trace photos survive browser restarts.

### Open as a local copy

1. Resolve an approved revision using IDs against the configured catalog origin. Never fetch an arbitrary project URL from a query parameter.
2. Fetch the bounded snapshot and verify its SHA-256 against revision metadata. Parse/migrate it with Pocketry's existing parser and run normal layout/material validation in a cancellable worker. A newer unsupported schema produces an update/download explanation without altering the current project.
3. Present the title, creator, revision, license, and validation warnings before opening. Do not automatically replace a project merely because a deep link exists.
4. Cancel pending autosaves and save the outgoing committed state while it still owns its project identity. Save an unnamed draft into My projects under a unique recovery name. Failure leaves the existing in-memory project open and offers an editable download.
5. In one IndexedDB read/write transaction, preserve the outgoing project, create a new named catalog copy, update the working document, and set the new active ID. Refactor only this multi-record transition behind the persistence module; retain existing database/store names and serialization of local mutations. Enforce a local revision token so another tab cannot silently overwrite work; a detected conflict requires reload or saving a separate copy.
6. Hydrate the new copy with a fresh editing-history baseline, remap incoming shape IDs to avoid collisions with the live trace/library, retain queued trace tools separately, and remove the import query parameters after success. Catalog import must not automatically insert queued tools into the downloaded design.

For repeat imports, offer **Open existing local copy** or **Create another copy**; never refresh a modified local copy from the network automatically. The catalog revision remains immutable regardless of local edits.

### Attribution and project schema

Bump ProjectDoc from v19 to v20, or the next available version at implementation time, to add optional catalog attribution records: source URL, design/revision IDs, author display attribution, and content-license identifier. Keep these fields outside geometry/history snapshots. Preserve them through save, duplicate, project export/import, and whole-library backup/restore. Old documents migrate with no attribution field. Unsupported future documents retain current fail-safe preservation behavior.

Local attribution is descriptive, never an authorization token. On publication the catalog resolves any parent revision against its own records; claimed authorship or ownership from an uploaded JSON file grants no privilege. Attribution survives remixes, including the ancestor chain. Metadata does not grant redistribution rights beyond the selected content license.

### Publish a deliberate snapshot

Add **Publish to library** in Bin's project actions. It opens the native submission flow without leaving the editor and captures the committed design at that moment. Build a separate public snapshot serializer; do not alter personal backup semantics.

The public snapshot contains current geometry/settings and required attribution. Omit undo/redo stacks and shapes referenced only by deleted/history states or queued tools. Exclude source photos, local library IDs, camera/selection state, and personal draft names unless the user explicitly supplies the public title. Show exactly what will be uploaded before the user submits. Selecting gallery photos is a separate action.

## 5. Publication, revisions, and validation

The state machine is `draft → pending_review → published` or `changes_requested/rejected`. A published design has a stable identity and points to an approved immutable revision. Editing geometry, descriptive content, gallery, compatibility, license, or creator print setups/notes creates a new draft revision; the last approved revision remains public until its replacement is approved. Community feedback is moderated independently.

Submission steps: select/snapshot a project; validate and preview it in Pocketry; supply title/category/description; specify tool models and one or more print setups, or explicitly state that print settings have not been recorded; select photos; select a content license and confirm upload rights; submit. A generic organizer need not claim compatibility with a named product. Contributors can save private drafts and see actionable rejection reasons.

The catalog does not bundle Pocketry's AGPL engine while its own license is undecided. Validation therefore has explicit responsibilities:

- **Server intake:** independently implemented bounds and JSON-envelope validation, allowed schema version, finite numeric values, collection sizes, unique shape IDs, reference integrity, and hash calculation. This is a safety/format check, not proof of printable geometry.
- **Author preview:** Pocketry's actual parser, migration, layout checks, and export path. Author-provided success flags are advisory and never sufficient for publication.
- **Moderator verification:** open the exact pending revision in a dedicated Pocketry `/catalog-review` tab, identified by draft/revision IDs and authorized through the API. This is an isolated, read-only workspace with its own in-memory providers: no normal Bin autosave, IndexedDB writes, queued-tool consumption, or access to the user's current project. Merely opening another normal Bin tab would not provide isolation because tabs share browser storage. Pocketry performs its normal validation and a real mesh/export build, with resource/time limits. The moderator examines the preview, supplied fit evidence, metadata, and attribution, then records acceptance tied to the snapshot hash and Pocketry build version.
- **Approval:** the server requires moderator authorization and a verification record for the exact current hash. Editing a pending snapshot invalidates verification. Server-side schema checks still run; a normal contributor cannot forge a moderator record. This is a curated human-reviewed publication model, not independent server certification of geometry or physical fit.

Do not fetch arbitrary external URLs, execute uploaded code, or unpack model archives during intake. Generate dimensions from verified project data; discrepancies with submitted metadata block approval. If full automatic server geometry verification becomes necessary later, design and review its deployment/licensing explicitly.

Initial configurable intake limits: 2 MiB normalized project JSON; nesting depth 32; 128 shapes; 256 placements; 20,000 total outline vertices and 5,000 per shape; 100,000 vertices after accounting for repeated placements; eight gallery images of at most 5 MiB/24 megapixels each. Bound browser-side validation/build work in a disposable Web Worker with a 30-second timeout and cancellation. This is distinct from Cloudflare's request CPU budget. Reject oversize submissions with actionable messages; do not silently simplify geometry. Check every selected seed and worst-case payload against these caps and the real Worker CPU limit before launch. If legitimate seed files require higher caps, measure the cost and adjust the deployment tier/caps explicitly.

Keep expensive image processing out of the Cloudflare request path. The author browser downsizes/orients photos before upload. Incoming images remain private and untrusted even if the client says they were sanitized. During curated review, the moderator browser decodes and re-encodes approved images into bounded JPEG/PNG derivatives (maximum 1,600 px long edge and 1 MiB), dropping metadata. Only the moderator-only finalization endpoint can mark these derivatives publishable; verify type, size, dimensions, immutable key, and hash at that boundary. Serve approved derivatives with explicit raster content type and `nosniff`. Raw submissions are never served as public assets and expire within 24 hours after finalization. No SVG/HTML/GIF upload in v1. Require one cover render or photo, but require a real print photo only for a photographed-fit claim. This manual processing step is an intentional bootstrap tradeoff, not an assertion that client sanitization alone is trustworthy.

Upload processing is idempotent: reserve a server-generated object key and bytes against an account/pilot quota; stream a bounded authenticated upload through the Worker into private R2; enforce the actual byte limit rather than trusting `Content-Length`; verify object metadata and hash before accepting completion. Single-use reservations prevent overwriting an approved object. Record readiness only after moderator finalization. R2 and D1 do not share a transaction: write/verify immutable objects first, then atomically publish their metadata in D1. Failed operations leave private orphan objects for delayed cleanup, not partially public designs. Retry by reservation/idempotency key. Expire abandoned reservations and collect unreferenced objects after a grace period.

## 6. Data model and API contract

Use SQL migrations tracked in the catalog repository. Prefer relational fields for search, ownership, and moderation; store the immutable project as an object plus checksum, not as repeated large JSON values in listing rows.

| Entity | Key contents and invariants |
| --- | --- |
| Identity / profiles / roles | Library-managed users, provider accounts, sessions, verification challenges and moderator passkeys; unique public handle, display name, private account state; roles cannot be self-assigned |
| Designs | Stable ID, owner, slug, visibility, current published revision, creation/publication dates |
| Design revisions | Design ID, revision number, state, title/description, category/tags, project schema/build versions, project asset/hash, derived dimensions, print setup records/notes, license, parent revision, gallery ordering |
| Print setups | Versioned structured filament/printer/slicer/settings data, suggested/actual classification, label, author, and immutable revision or fit-report ownership; child filament entries support multiple materials |
| Assets | Owner, purpose, private object key, checksum, size/type, processing state; attached to a revision or feedback record |
| Products / design products | Brand, exact model/variant, optional manufacturer identifier; many products per design; relationship indicates stored tool or required supply |
| Ratings | Unique user/design, revision evaluated, score, moderation visibility |
| Comments / fit reports | Author, design/revision, bounded content, parent comment where applicable, outcome, actual print setup snapshot for fit reports, optional image, moderation state |
| Favorites / collections | Private bookmarks; curator-owned public ordered collections |
| Reports / moderation actions | Target, reason, outcome, actor, timestamps, snapshot hash where relevant; audit trail |
| Verification records | Revision/hash, authorized moderator, Pocketry build, automated diagnostics, review outcome; invalidated by changed content |
| Notifications / maintenance | Recipient/action links, deduplication keys, upload reservations, quota counters, and resumable cleanup cursors |
| Daily metrics | Aggregated listing views, successful editor opens, snapshot downloads, and contribution/moderation counts; no private project contents |

Canonical API prefix: `/discover/api/v1`. Public responses include explicit contract version, stable IDs, revision IDs, schema version, and checksums where appropriate. Cursor pagination defaults to 24, capped at 100. Search queries are capped at 120 characters. Errors contain a stable code, safe user-facing message, and request ID; never internal SQL or credentials.

Revision read/create/update payloads include `printSetups: PrintSetup[]`; fit-report payloads include one actual `printSetup` snapshot. These values are validated and moderated with their owning record. Do not introduce a separate mutable profile service whose edits could change historical print reports. Print settings stay in catalog metadata; Pocketry project attribution links back to the exact revision containing them.

| API group | Required operations |
| --- | --- |
| Public discovery (no session required) | `GET /designs`, `GET /designs/{id}`, `GET /designs/{id}/revisions`, `GET /designs/{id}/feedback`, `GET /revisions/{id}/project`, `GET /collections`, `GET /creators/{handle}`; published records and approved feedback only |
| Identity | `GET /session`; private profile/export/deletion operations. Better Auth owns social login, callback, linking, passkey and signout routes separately at `/discover/api/auth/*` |
| Submissions | `POST /designs`, `POST /designs/{id}/revisions`, `PATCH /revisions/{id}`, `POST /revisions/{id}/submit`, owner withdrawal/unpublish operations |
| Uploads | `POST /uploads`, bounded `PUT /uploads/{id}/blob`, `POST /uploads/{id}/complete`, status and cancellation; moderator-only processed-image finalization |
| Community | Own rating `PUT/DELETE`, comments/replies `POST/PATCH/DELETE`, fit reports `POST/PATCH/DELETE`, favorites `PUT/DELETE`, reports `POST` |
| Moderation | Queue reads; verification-record creation; revision/feedback approve, request changes, reject, hide; account suspension; audited compatibility-record editing |
| Media | Status-checked processed-asset delivery; published images need no session, private assets require owner/moderator authorization |

Public revision/project endpoints return only published, currently accessible records. Draft reads require ownership or moderator access. Use optimistic revision tokens for edits; stale writes return conflict rather than overwrite. Require idempotency keys for create, submit, upload completion, approval, and notifications. Keep the auth library's protocol routes outside the versioned product API; configure its base path explicitly instead of reimplementing OAuth endpoints.

Mount public read routes outside required-auth middleware. Published project delivery from private R2 checks publication state, not whether the caller is signed in; private storage does not imply account-gated downloads. A missing or expired session must not turn a public read into a login redirect or an unauthorized response. Apply anonymous rate limits without requiring an account to perform ordinary browsing/imports. Keep owner/moderator data on separately authorized paths.

Use D1 transactional `batch()` operations, bound parameters, foreign keys, and uniqueness constraints for state transitions, quotas, votes, and bookmarks. Do not assume interactive ORM transactions or PostgreSQL locking/functions are available. A conditional update affecting zero rows is not a SQL error: dependent audit/notification writes must be conditional on the same successful transition, or a constraint/trigger must abort the whole batch. Return conflict on a stale revision, and prove concurrent approval/quota behavior against D1. Never implement a quota as an unlocked read followed by a write. [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/).

Index owner/state/date, publication order, exact normalized brand/model, material, and relevant dimensions. FTS5 contains approved public text only and is updated with publication/removal; escape its query grammar as well as binding SQL parameters. Keep exact-model matching separate so punctuation in model numbers is preserved. Start with one primary D1 database per environment and no read replicas. Measure rows scanned/written and query count per request, including auth, rather than treating returned rows as the read cost. Search is rebuildable from canonical records; its export implications are covered below.

API v1 supports the launch project schema; it reports supported schema versions so an older client can explain incompatibility. New Pocketry format versions require a compatibility fixture and coordinated catalog intake support before publication is enabled for that version. Contract changes are additive within v1; a breaking shape gets a new API major version.

## 7. Identity, access, moderation, and content rights

The catalog Worker is the browser-facing backend. An opaque session cookie is Secure, HttpOnly, host-only and scoped to `/discover`; the browser receives a minimal session profile, not provider tokens. Better Auth manages sessions in D1. Request only identity scopes, discard unneeded provider tokens, and protect any required retained tokens server-side. Use SameSite cookies plus Origin/CSRF checks for mutations. Check current account/role state on every sensitive operation rather than trusting a cached role. Do not cache authenticated responses or pages containing session data in shared caches. No application credentials in project files, client bundles, logs, or analytics; redact OAuth callback parameters.

Authorization lives in the Worker and its database access layer: D1 does not supply the previously proposed PostgreSQL row-level security model. Every query explicitly constrains visibility, ownership, and allowed transitions using the server-authenticated actor. Public IDs are not access credentials. Only the Worker receives D1/R2 bindings; browsers receive no Cloudflare management token, database binding, or general SQL endpoint. Keep operator credentials confined to deployment/maintenance. Test the real queries as well as HTTP handlers so an alternate endpoint cannot bypass ownership checks.

Start with one administrator (Will) bootstrapped through an operator command and explicit moderator assignment. Require a recent passkey verification for moderator/admin writes, using Better Auth's maintained passkey implementation with user verification required. Bind the verified user/session and a short freshness window server-side; ordinary social login alone does not satisfy this check. Protect enrollment/removal and recovery with administrator approval or the audited operator recovery command. Prove this integration in milestone A. Moderators inspect drafts needed for their role; log privileged actions and test ordinary-user requests against every privileged endpoint. [Better Auth passkeys](https://www.better-auth.com/docs/plugins/passkey).

Initial database-enforced community quotas: five submitted revisions, twenty comments/replies, five fit reports, and ten reports per account per day; at most five unreviewed design revisions per account. Reserve uploaded bytes atomically against per-account and whole-pilot caps. Validate Turnstile server-side on signup/submission where supported by the flow; apply bounded rate limits to login and expensive anonymous endpoints using facilities available on the selected plan. Do not assume a paid WAF subscription. Challenges cannot replace account quotas or stop all abusive reads. Return retry guidance rather than silent failures; exemptions are explicit and audited.

Keep public project files in private storage and deliver through status-aware endpoints. Images may be cached for at most 60 seconds; unpublishing/hiding content triggers cache invalidation, with the residual cache window documented. Avoid long-lived public object URLs that bypass moderation state. Already-downloaded content cannot be recalled.

Separate content licensing from software licensing. Offer CC BY 4.0, CC BY-SA 4.0, and CC0 for newly contributed designs, with an explicit selection/confirmation at submission. Recommend CC BY 4.0 for original seed designs, but do not apply it without the owner's choice. Record source attribution and parent revision; preserve ShareAlike requirements on applicable remixes. Exclude non-derivative licenses because customization/remixing is a core feature. An upload-rights statement covers the project and supplied photos; it does not assert ownership of the physical tool or brand. Explain the selected license in plain language with its official terms. [CC BY](https://creativecommons.org/licenses/by/4.0/), [CC BY-SA](https://creativecommons.org/licenses/by-sa/4.0/).

Before opening public submissions, prepare Terms, Privacy, Community Guidelines, and a copyright/reporting contact. Explain public reuse licenses, moderation, and data retention. V1 guidelines exclude affiliate/promotional links and sponsored submissions; permitted source/license/manufacturer references must serve attribution or compatibility. Have the operator approve the policies; do not present implementation choices as legal advice. Account deletion removes authentication/personal profile data and unpublishes that user's designs by default; preserve only documented, access-restricted records required for operational/legal purposes. Provide a user-data export and a manual reviewed deletion workflow at launch. Published reuse licenses and third-party downloads are not represented as revocable through account deletion.

## 8. Measure usefulness now; enable monetization later

V1 contains no revenue integrations, affiliate tags, shopping panels, sponsorship records, ad SDKs, payment dependencies, commercial redirects, or monetization administration screens. Monetization is not a launch milestone. It must not affect design approval, search ordering, ratings, or which tools qualify for the library.

Build only foundations that are useful without monetization: stable product/design IDs, exact compatibility records, structured hardware/material requirements and print setups, curator collections, immutable revisions, and aggregate usage measurement. Keep these independent of any future retailer, affiliate program, advertiser, or payment provider. Do not create unused offer/payment tables now. A later filament-to-product mapping must preserve the original recorded brand/product/variant text and never silently substitute a different material.

Record first-party aggregate events for design views, successful local opens, editable downloads, submitted/published designs, and fit reports. A successful open is recorded after durable local import, not merely a button click. Metrics delivery is best-effort and can never block editing/import. Deduplicate obvious retries/bots; do not imply anonymous counts are unique people. Do not send local project geometry, source photos, raw search strings, or persistent cross-site identifiers into analytics. Keep security logs separate with a short retention period.

The initial operator dashboard answers: which designs get opened, which searches have no results, how long submissions wait, whether people contribute useful designs/fit reports, and which revisions have fit problems. Record zero-result counts without retaining raw queries; use explicit optional feedback to collect missing-tool requests. Evaluate library quality and use before proposing monetization. No automatic activation at a design-count or traffic threshold.

When Will decides the collection merits monetization, make a separate release:

1. Select the first channel, likely relevant product/supply links, and check applicable content rights, program terms, and disclosure requirements. Ads, sponsorship, and payments remain separate decisions.
2. Add a dedicated `product_offers` module keyed by existing product IDs, with retailer, region, approved URL, disclosure, and active state. Keep program identifiers, tracking logic, and any later prices out of project documents and compatibility metadata.
3. Deploy the module with server-controlled `monetization.enabled=false` and separate channel flags such as `affiliateLinks.enabled=false`. Missing configuration is disabled. Apply flags in API/SSR responses and native editor views, so a disabled channel produces no markup, tracking requests, redirect access, or third-party scripts.
4. Add moderator-managed offers, HTTPS destination allowlists, and redirects by stored offer ID. Do not accept arbitrary redirect destinations or enable user-controlled affiliate IDs. Keep all organic ranking and fit evidence independent of commercial relationships.
5. Add nearby plain-language disclosure and appropriate link attributes; review regional behavior and update policies. FTC guidance calls for clear, conspicuous affiliate disclosure near recommendations. [FTC endorsement guidance](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking).
6. Test disabled/enabled behavior, cache invalidation, rollback, destination integrity, and measurement. Preview internally, then enable only the approved channel/listings. A kill switch removes the channel without redeploying Pocketry or interrupting library access.

“Switch on later” means this documented additive module and activation path, not building a hidden shopping system into v1 or promising a complete revenue feature from a flag alone. Initial data/contracts require no redesign when that module is added. Payments, paid content, creator payouts, and ads require their own future design/release.

## 9. Seed-content preparation

Create an admin-only seed importer in the catalog repository. Input is a local manifest plus explicitly selected project/photo files. The manifest contains a stable seed key, title, creator, description, category, exact tool model(s), structured print setups/notes, fit-evidence statement, selected license/attribution, gallery paths/alt text, and optional manufacturer/source references. Local paths are never published.

1. Select 3–5 of Will's designs. Existing fixtures and README photos are possible references, not automatic permission to publish a listing or infer its fit.
2. Open each through the current Pocketry parser and verify size, pockets, depths, materials, and exports. Produce the public snapshot with history and unrelated shapes removed.
3. Choose a cover image and, where available, an actual printed-bin/tool photo. Capture the actual filament brand/product/material/color, printer/nozzle, slicer, layer height, walls, infill, temperatures, and other known settings. Record missing historical settings as unknown; suggested settings go in a separate profile. Mark unknown physical-fit status honestly.
4. Confirm each design's title, creator attribution, tool model, and content license. Record needed material/hardware specifications without retailer or affiliate links.
5. Run the importer in dry-run mode first. It validates every record and reports missing files/metadata without writing. The write mode creates private drafts using stable seed keys; reruns update the intended draft or create a new revision without duplicates.
6. Review/publish through the same moderation path used for later contributors. Verify every public page, editable download, local import, and printable export on desktop and phone.

A seed is complete only when its editable file works, its listing metadata matches, its rights are selected, and its fit claims match supplied evidence. No artificial accounts, ratings, comments, or community-fit claims are created to populate the interface.

## 10. Operations, deployment, and cost envelope

Maintain isolated development, staging, and production D1 databases, R2 buckets, secrets, and provider callbacks. Use Wrangler/Miniflare locally and the Workers Vitest integration for CI. Verify runtime-sensitive behavior again on an isolated deployed staging Worker. Staging contains fixtures or expressly approved seeds, never production account data. Preview deployments cannot bind production resources.

Deploy schema changes additively, then the backward-compatible API, then catalog pages and Pocketry integration. Keep `/discover` routing and submissions independently switchable. Monetization flags belong to the later optional module described above. A catalog outage leaves the editor functional and shows a retry state in Discover. Rollback first disables writes and/or restores a compatible Worker version and routing configuration; do not destructively downgrade a populated database. Keep published project bytes and checksums unchanged across upgrades.

Use a small scheduled maintenance handler for expired upload reservations, orphan objects, sessions, and old counters. Persist a cursor and retry state; process bounded batches and resume on the next invocation. Image finalization happens during browser-based moderation, so v1 needs no image server, media queue, email jobs, or always-on runner. Do not rely on work continuing after an HTTP response. If even a bounded maintenance task exceeds the chosen runtime allowance, run it as an operator command during the pilot or use the measured paid-tier budget.

Use D1 Time Travel for recent database recovery: the current retention window is seven days on Free and thirty days on Paid. It does not back up R2 objects or protect against losing access to the Cloudflare account. Supply an operator backup command that exports SQL and all referenced project/image objects with checksums into an encrypted, dated bundle outside that account. Run it after each publication session, before migrations, and at least weekly during the pilot. Target at most seven days of data loss after an account-level failure and restoration within one working day; prove both in staging. Retain four weekly bundles and document deletion handling. Shorter recovery targets require an automated independent backup destination and its own cost decision. [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

D1's standard SQL exporter currently cannot export a database containing virtual tables, including FTS5. The pilot backup command therefore enters a brief catalog maintenance window, pauses catalog writes, drops only the rebuildable search index, exports canonical tables, and recreates/backfills search in a recovery-safe finalization step. Ordinary Pocketry editing remains available. Test recovery from an interrupted export/rebuild; never drop canonical data to make a backup. Capture an object manifest while writes are paused, protect those immutable objects from cleanup until copying finishes, and verify every checksum. Reapply subsequent takedown/deletion records and invalidate sessions before exposing a restored database. [D1 export limitations](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

Add lightweight API/database health checks, failed-cleanup and backup-age visibility, provider error/usage monitoring, and a weekly review of pending moderation. Logs redact auth tokens/codes, request bodies containing designs, and email addresses. Keep runbooks for suspension, takedowns, bad revisions, quota exhaustion, OAuth failure, credential rotation, restore, and rollback. Operator time for moderation and backups is part of the experiment's cost even if the hosting bill is zero.

Current published allowances, checked September 20, 2026; usage is shared with other projects in the same account where applicable:

| Component | Free pilot allowance / constraint | Upgrade consideration |
| --- | --- | --- |
| D1 | 5 million rows read/day, 100,000 rows written/day, 5 GB total account storage; **500 MB maximum per database** on Free | Query/index efficiency matters; exceeding daily Free quotas produces errors until reset |
| Workers | 100,000 requests/day and 10 ms CPU per invocation on Free; static asset requests are free | Paid starts at $5/month with included usage, then metered overages; auth/validation CPU may justify it before traffic does |
| R2 Standard | 10 GB-month storage, 1 million Class A and 10 million Class B operations/month; no egress charge | Storage and operations beyond allowances are billed; private delivery also invokes the Worker |
| Auth, search, notifications | Library-managed social login, D1 search, in-app notifications | No separate hosted auth, search, or SMTP subscription planned |
| Staging and independent backup | Small staging resources within available allowances; operator-controlled existing backup storage | Additional storage, domain charges, taxes and operator labor are outside the hosting estimate |

The target is **$0/month incremental hosting during a small pilot**, with **$5/month plus any metered usage** as the first practical fallback. Neither is a guaranteed bill or a hard cap. Check account headroom and billing terms before provisioning; enabling R2 is a separate billing consideration even when Workers/D1 stay free. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

Start with a 2 GB application cap on catalog-owned R2 bytes and a 100 MB per-account cap, counting incoming and approved objects. Clean up replaced raw images and abandoned uploads promptly. Track account-level storage and operations, D1 database size/read/write usage, and Worker request/CPU usage; notify the operator at 60% and 80% of the relevant allowance. Application limits and alerts reduce risk but do not impose a Cloudflare-wide spending ceiling. Do not automatically enable a paid plan. When budget or quota is exhausted, disable submissions first, show an honest catalog availability state, and keep local editing/export usable.

Review the pilot six to eight weeks after sharing it with likely contributors. Proposed evidence for further investment: several independent contributors, repeated successful design opens, useful actual-print reports, a manageable moderation queue, and costs Will is willing to sustain. Count visits/opens as events, not unique people. A quiet library without distribution does not prove lack of demand. Demand evidence can justify continued hosting; it does not establish that future ads or affiliate links will pay for it.

## 11. Implementation sequence and handoff units

Each row is a milestone with one or more focused PRs. It is not authorization to merge, provision paid accounts, publish the repository, or publish a user's designs. Software-license selection remains explicitly deferred; independent implementation can proceed, but code-sharing and catalog-source publication must respect that decision.

| Milestone | Concrete deliverables | Exit condition |
| --- | --- | --- |
| A. Contracts and architecture proof | API v1; minimal private Hono/Worker scaffold; local D1/R2; direct same-origin route proof; Better Auth/Drizzle social login and moderator passkey spike; native Discover stub; session-preserving navigation; license-boundary notes | Deep links, assets, callback/cookie paths, logout, linking, moderator verification and D1 adapter failure handling work locally/in staging; editor draft survives; measured auth and maximum-payload CPU establish Free versus Paid feasibility |
| B. Catalog foundation | D1 migrations/indexes/conditional batches, Worker authorization, drafts/revisions/assets, bounded streaming uploads, moderator image finalization, cleanup handler, audit log, seed importer, backup/search-rebuild command | Two-user isolation, concurrent quota/approval and retry tests pass; seed dry run succeeds; anonymous clients cannot read drafts or mutate state; canonical data and files restore successfully |
| C. Curated reading and editing | Server-rendered browse/detail pages, native Pocketry browse/detail views, structured print-setup display, search/filtering, public snapshot serializer, schema attribution migration, transactional local imports | All 3–5 seed designs open as independent copies; known actual print settings are visible; prior named/unnamed work survives; local export and reload work; public-page/native-view parity passes |
| D. Publication and moderation | Native publish form with structured filament/print-setup editor, standalone project-file intake, dedicated Pocketry moderator review, revision state machine, review queue and decisions | A non-admin submits; moderator verifies exact bytes and publishes; suggested and actual settings stay distinct; changed pending bytes invalidate approval; old published revision stays available until replacement approval |
| E. Community | Profiles, ratings, comments/replies, fit reports/photos, favorites, reports, in-app notifications, account export/deletion workflow | Ownership, quota, moderation, revision labeling, suspension, and aggregate-count tests pass; no contributor can self-approve |
| F. Operational readiness | Aggregate usefulness metrics, policies, independent backup/restore drill, quota/cost alerts, rollback drill, responsive/accessibility QA; verify no monetization dependencies or UI | Social login works outside developer test allowlists; CPU and usage fit the approved plan; restoration and catalog failure leave editor workflows usable; public pages/network activity contain no monetization |
| G. Seeded launch | Final approved seed metadata/photos/licenses; staging review; production deploy; seed publication; submission flag enabled after smoke tests | Every launch gate below passes on the actual production route and selected seeds |

Dependency order is A → B → C → D → E → F → G. After C, use development fixtures for an internal reading/import preview. After D, privately invite a few contributors to test submission and print details; public seeds still follow approval and operational gates. Ratings/comments are not complete until E. This allows early feedback before the full community launch without silently removing the agreed features. Tie implementation tasks to exit conditions rather than treating a scaffold or passing unit tests as a finished launch.

## 12. Test plan and launch gates

### Required automated coverage

- **Anonymous access:** with a fresh browser profile and no account/cookies, browse/search, view images/print settings/approved feedback, follow a direct design link, download, import into Pocketry, save locally, edit and export. Repeat with an expired session and failed session/provider requests; assert no login modal/redirect and no dependency on successful session discovery. Private drafts remain inaccessible.
- **Project compatibility:** all supported legacy migrations; v20 attribution through save/export/import/backup; unknown future versions; malformed/truncated JSON; absent or duplicate shape references; invalid numeric values; public snapshot excludes history, deleted shapes, queued tools, and source images while preserving the visible design.
- **Local preservation:** named and unnamed draft imports; storage quota errors; autosave completing during import; duplicate names; repeat imports; back/forward; two tabs; schema/hash mismatch; cancellation; network failure; queued trace tools; rapid Bin/Trace/Discover navigation. Simulate a failure between logical persistence steps to prove transaction rollback.
- **Print details:** multiple setups per revision, multiple filaments per setup, custom/unknown values, units/ranges, actual versus suggested labels, estimates versus measured results, adaptive-layer shell units, snapshot stability after source-profile edits, material search, and settings round trips through API/seed import. Profile metadata must not mutate project geometry or imply physical-fit validation.
- **Community/data access:** anonymous versus owner versus other user versus moderator; every direct HTTP route and underlying owner/visibility query; hidden/deleted assets; stale roles/suspended users; self-rating; duplicate votes; feedback awaiting moderation; rating revision labels; auditability; unauthorized role assignment; moderator passkey freshness and recovery.
- **Publication:** interrupted/oversized streaming uploads, false MIME/size, excessive image pixels/JSON complexity, browser validation timeout, Worker CPU limits, stale edit tokens, forged author validation, changed hash after verification, simultaneous approvals, idempotent retry, partial asset failure, unpublish/cache expiry. Raw incoming images must never be publicly served.
- **D1 concurrency:** conditional batches, zero-row conflicts, rollback after SQL errors, duplicate idempotency keys, concurrent quota reservations, consistent audit/notification records, publication/search consistency, auth adapter retries and partial failures. Verify indexed query plans and measured read/write counts.
- **Web behavior:** OAuth state/PKCE where supported by the provider, exact redirect allowlists, account linking, popup source/origin checks, expired sessions/logout, CSRF, safe text, private-cache exclusion, old slugs, sitemap exclusions, public HTML without JavaScript, exact Worker route matching, native/public page parity, catalog outage, and absence of monetization scripts/UI.
- **Seed and operations:** seed importer dry-run/idempotency, independent SQL/object backups, interrupted FTS export/rebuild, checksums after restore, bounded cleanup retries, rollback compatibility, simulated quota exhaustion, metrics failure not blocking imports.

Pocketry implementation changes must pass `npm run check`, `npm test`, `npm run build`, and `git diff --check`. The catalog has equivalent type, unit, database-integration, build, and isolated Playwright gates. Exercise real D1/R2 bindings under Wrangler/Miniflare and repeat deployment-sensitive cases in staging; mocked authorization or plain SQLite alone is insufficient. Measure actual deployed Worker CPU, including OAuth callbacks, session reads, image header/hash checks, maximum JSON intake, and cleanup. Run browser checks against both the SPA and direct public entry, using an isolated headless browser and temporary accounts/storage, never the user's active desktop browser.

### Manual acceptance and initial performance targets

- Test the full browse → inspect → open → edit → export flow at 390 px mobile and desktop widths, including keyboard navigation, focus restoration, accessible labels, and readable fit/license text.
- Verify every seed in the actual UI and a slicer. A successful mesh/slicer check is not physical fit proof; only the supplied physical evidence supports the displayed fit claim.
- On a defined mobile-throttling profile, target first useful public listing content within 2.5 seconds. Target warm API p95 below 500 ms on a generated 10,000-listing staging dataset. Record device/profile/dataset with results; these are acceptance targets, not existing measurements.
- Confirm no catalog bundle/network request is required for basic Trace/Bin startup when Discover is unused, and no background geometry build continues just because Bin is hidden.
- Confirm public draft access fails, removals disappear within the documented cache window, independent backup restore succeeds, external Google/GitHub accounts can sign in, and catalog downtime does not prevent local editing/export.

### Launch gate checklist

- [ ] 3–5 owner-selected seed designs approved with explicit content licenses and accurate fit statements.
- [ ] Known filament/print settings are captured for each seed, with unknown values and suggested versus actual setups clearly distinguished.
- [ ] Public, account, contributor, and moderator workflows pass on staging and the production hostname.
- [ ] A visitor with no account can browse, download, import, edit, save locally, and export every published seed through both Discover and direct public links, without a login prompt.
- [ ] Current work survives all catalog import/navigation failure tests.
- [ ] Terms/privacy/community guidance and reporting contact are published; software-license state is accurately represented.
- [ ] Production social login and moderator passkeys, independent backup/restore, monitoring, moderation ownership, and rollback are verified.
- [ ] CPU measurements and account-wide usage fit the selected plan; upload caps, quota failure behavior, and any approved spending are documented.
- [ ] No affiliate links, shopping interface, sponsored placements, ads, payment flows, or monetization network calls are present.
- [ ] No placeholder community activity, unsupported physical-fit badge, or hidden automatic upload remains.

## 13. Deliberately deferred work and remaining launch inputs

Defer all monetization, email-code login/email notifications, unattended server media processing, arbitrary STL/3MF uploads, slicer-profile/G-code imports, hosted mesh generation, an interactive catalog 3D viewer, cloud synchronization/private project hosting, reusable standalone tool outlines, social feeds/following, chat, automatic publishing, live retailer pricing, and recommendation algorithms. The initial data model supports future revisions/products/collections without implementing those products now. The future monetization module and its activation/kill-switch behavior are specified in section 8.

Inputs needed during implementation are the selected 3–5 project files/photos and metadata, creator attribution and per-design licenses, the Cloudflare account/DNS and available quota, OAuth application credentials and provider choice, an independent encrypted-backup destination, any approved paid-tier budget, operator/moderator identity, and final public policy text. These do not prevent implementing/testing with clearly marked fixtures and local resources. The catalog software license remains intentionally undecided; no task should silently resolve it.

The first implementation task is milestone A: prove the separate service can share the public origin and integrate with Pocketry without losing editor state. The first end-to-end product slice is one private seed draft → moderator review → public detail page → independent local copy → printable export.
