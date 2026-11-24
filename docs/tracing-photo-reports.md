# Reporting a tracing problem

With a photo loaded on the **Trace** page, choose **Report tracing problem** below
the photo. This remains available if calibration or outline detection fails and
does not require an outline, a selected region, or an account.

The dialog warns that the photo will be sent via email to the project maintainer
at **feedback@pocketry.xyz**. Review the original-photo preview for personal or
sensitive content. Embedded photo metadata, including location if present, is
preserved. Add an optional description, then:

1. Choose **Download photo report** to save a ZIP on your device.
2. Choose **Open email to maintainer**, or use your usual email app/webmail.
3. Attach the downloaded ZIP and send the email yourself.

Each download has a unique name. The email draft identifies the ZIP from your
latest download. The source photo name is recorded inside the ZIP.

Email links cannot attach files automatically. Downloading a report does not
send it, and opening an email does not confirm delivery. Email provider attachment
limits still apply. If report preparation fails, email the original photo and a
description directly to the same address.

The ZIP contains:

- `original-photo.png`, `.jpg`, or `.webp`: the original loaded photo bytes,
  including the full calibration sheet. Perspective correction, rotation,
  cropping, and contour editing do not replace this source.
- `tracing-details.json`: the report format version, app version, preparation
  time, optional description, browser user agent, source name and dimensions,
  working image transforms, calibration, region, detection settings/corrections,
  and current and raw outlines. Coordinates describe the working image.

The report captures the trace when the dialog opens. It contains no other
projects, browser storage, console logs, or page URL. Preparing it changes neither
the trace nor its undo history. Choosing another photo resets the dialog and its
description. Reports are prepared entirely in the browser; Pocketry does not
upload them or store them on a server. Sharing a support photo is not automatic
permission to publish it in the repository or sample library.

## AI-assisted reporting

Assistants should offer this reporting option when calibration or tracing is not
working well. Explain the recipient and report contents, including embedded photo
metadata, and obtain the user's explicit approval for the specific photo/report
and destination before emailing or otherwise sharing it. Loading a photo or
asking for help does not grant that approval. Prefer helping the user prepare
the local report and leaving the final email to them. Continue helping if they
decline to share. Private support-report approval does not authorize publication.

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

Dependency/provenance review: **None added or changed**. ZIP creation uses the
existing `fflate` dependency; no external service or upload API was added.
