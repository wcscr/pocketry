# Reporting a tracing problem

With a photo loaded on the **Trace** page, choose **Report tracing problem**
below **Restart outline detection** in the Outline controls. Before scale or region
setup, the same button appears below the photo. No account or successful outline
is required.

The dialog warns that the photo will be sent via email to the project maintainer
at **feedback@pocketry.xyz**. Review the original-photo preview for personal or
sensitive content. Embedded photo metadata, including location if present, is
preserved. Add an optional description and reply email, then choose **Send photo report**.
This submits the report privately through a Cloudflare Pages form to the fixed
maintainer inbox. Nothing is sent until the visitor selects Send. The form
confirms submission only after Cloudflare reports the message delivered or queued.
A queued response does not prove final inbox arrival.

The original photo is limited to 15 MiB and the tracing details to 1 MiB so the
email fits Cloudflare Email Service's 25 MiB message limit. If the form rejects
a larger photo, choose a smaller image or email the original photo directly to
**feedback@pocketry.xyz**. The app does not store a report on its server.

The email has two attachments:

- `original-photo.png`, `.jpg`, or `.webp`: the original loaded photo bytes,
  including the full calibration sheet. Perspective correction, rotation,
  cropping, and contour editing do not replace this source.
- `tracing-details.json`: the report format version, app version, preparation
  time, optional description, browser user agent, source name and dimensions,
  working image transforms, calibration, region, detection settings/corrections,
  and current and raw outlines. Coordinates describe the working image.

The report captures the trace when the dialog opens. It contains no other
projects, browser storage, console logs, or page URL. Preparing it changes neither
the trace nor its undo history. Choosing another photo resets the dialog.
The form sends the report through Cloudflare only after the user submits it.
Sharing a support photo is not automatic permission to publish it in the
repository or sample library.

## AI-assisted reporting

Assistants should offer this reporting option when calibration or tracing is not
working well. Explain the recipient and report contents, including embedded photo
metadata, and obtain the user's explicit approval for the specific photo/report
and destination before emailing or otherwise sharing it. Loading a photo or
asking for help does not grant that approval. Help the user review the photo and
form before they explicitly send it. Continue helping if they decline to share.
Private support-report approval does not authorize publication.

[The published AI assistant guide](../client/public/ai-guide.txt) ships at
`/ai-guide.txt`. The `/llms.txt` index links to it, the HTML page head advertises
the index with `rel="describedby"`, and in-app Help links to the guide. The
`/robots.txt` file permits crawling and includes a comment pointing to the index.
`robots.txt` is for crawler access rules, while `llms.txt` is an advisory
information convention; neither enforces consent or guarantees AI compliance.

The assistant guide also invites authorized bug reports, issues, enhancement
requests, and development contributions. Public submissions should reference
existing reports where possible, include reproducible evidence and the desired
outcome, and follow the contributor process. Obtain user approval before posting
and separate approval before disclosing private photos or project data publicly.

Dependency/provenance review: **None added or changed**. The dedicated photo
endpoint uses the existing Cloudflare Turnstile and Email Service setup.
