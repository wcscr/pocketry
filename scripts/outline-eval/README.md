# Outline evaluation helpers

**The replay tools below are diagnostic only.** Current photo tests must load the original calibration-sheet photograph, accept the available automatic calibration/perspective action, draw the region, and choose settings through the rendered UI in order (defaults first). No crop, cached calibration, injected settings or saved outline can substitute for that workflow. Record original hashes, ordered actions, selected regions and actual settings. See [CLAUDE.md](../../CLAUDE.md#photo-outline-regression-testing) and the [released-default comparison](../../docs/outline-detection-1.9-to-1.10.md).

Local, development-only tools for measuring photo-outline detection on what the
app really feeds its detector. Nothing here is imported by the application, and
photos and captured cases stay on the maintainer's machine. See
[the evaluation notes](../../docs/outline-evaluation.md) for the method and
metrics.

## Capture cases through the app

1. Copy the photos to an ignored folder the development server can serve:

   ```
   node scripts/outline-eval/stage-photos.mjs <photo-library> client/public/_eval-photos <mapping.json>
   ```

   Keep that folder out of commits and delete it afterwards: a production build
   copies everything under `client/public`. Do not symlink a folder from
   `~/Downloads`; file watching on it can block the server.
2. Start the receiver (loopback only) and the development server:

   ```
   node scripts/outline-eval/capture-receiver.mjs <cases-dir>
   PORT=5226 npm run dev
   ```

3. In the page, run `capture-hooks.js` in the console before loading a photo.
4. For each tool: load the photo, accept **Correct perspective & use scale**,
   draw a region closely around the tool, then
   `await pocketryCapture.save("<name>", { title: "…" })`.

Each case is `<name>.rgba` (the exact pixels sent to the detection worker),
`<name>.json` (options, the app's own result, region, calibration) and
`<name>.working.png` (the calibrated photo).

## Evaluate

```
node --import tsx scripts/evaluate-outline-cases.ts <cases-dir> <output-dir> [--boundary teed|color] [--outer-smoothing on|off] [--sheet-ink on|off] [--hints prompts.json]
```

`--outer-smoothing on` and `--sheet-ink on` apply the outward smoothing and the
removal of the sheet's printing to cases captured before they existed, as the
Trace page would; a run with any flag is not compared with the app's own
result.

The evaluator replays every case through `detectOutline`, checks that the
replay matches what the app produced, and, where `<name>.truth.json` exists,
reports boundary metrics in millimetres. A reference outline is
`{ "outline": Outline, "status": "draft" | "reviewed" }` in crop pixels.

Replay checks require both complete boundaries to agree within 0.05 crop pixels;
P95 is informational. Final app replay uses the recorded `frameTransform`, never
a fitted contour bounding box. Legacy captures without that mapping report final
app replay as unavailable. Empty/unmeasurable outputs count as missing-material
failures when a reference is present.

For separate assisted runs, `--hints` accepts a JSON object mapping case names to
arrays of `{ kind: "tool" | "paper", points: [{ x, y }], radius }` in captured
input pixels. Only named cases run; failed final mark checks are reported. Keep
these results separate from unassisted comparisons.

## Release comparison

The [1.9 → 1.10 report](../../docs/outline-detection-1.9-to-1.10.md) uses the
36 named files in the maintainer's `ReferenceVerification/photos` folder (31
unique original JPEGs), with frozen regions and SHA-256 hashes in
[`capture-plan.json`](../../client/public/reports/outline-1.9-to-1.10/capture-plan.json).
Original files are kept locally; the published report contains display derivatives.

Check out `4f6dc95b` (1.9.0) and `f6fbccc0` (1.10.0) separately, install each
lockfile with Node 22 / `npm ci` (the runtime for those historical commits, not
current main, which requires Node 26), and start their development servers on separate
loopback ports. From the checkout containing these helpers, use an existing local
Playwright installation with Chrome available:

```sh
node scripts/outline-eval/compare-releases.mjs \
  --photos /path/to/ReferenceVerification/photos \
  --plan client/public/reports/outline-1.9-to-1.10/capture-plan.json \
  --url http://127.0.0.1:5191 --version 1.9.0 --commit 4f6dc95b \
  --out /path/to/evidence/v1.9 --playwright /path/to/playwright/index.mjs
```

Repeat with the other server, `--version 1.10.0 --commit f6fbccc0`, and
`--out /path/to/evidence/v1.10`. Each case starts with a new browser context,
loads the original through the file input, accepts automatic calibration,
and draws the region with pointer input. Read-only observations capture the
outputs; no app settings or calibration are injected. `--only s15` selects a
case and `--resume yes` retains completed captures. An incomplete capture is
recorded as a failure and cannot be published by the renderer.

To rebuild the portable HTML, JSON and Markdown gallery with local Pillow:

```sh
python3 scripts/outline-eval/render-release-report.py /path/to/evidence /path/to/repository
```

The renderer checks all 36 paired source hashes, corrected-photo hashes,
calibrations, dimensions and regions before using the recorded geometry. It
also verifies the captured version against each immutable Git snapshot.
Captures stay outside `client/public`; only compressed presentation images and
sanitized result data belong in the report directory. Review every paired
image and update `review.json` when regenerating; classifications are visual
judgments, not automatically computed accuracy scores.
