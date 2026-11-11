# Outline evaluation helpers

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
node --import tsx scripts/evaluate-outline-cases.ts <cases-dir> <output-dir> [--boundary teed|color] [--outer-smoothing on|off] [--sheet-ink on|off]
```

`--outer-smoothing on` and `--sheet-ink on` apply the outward smoothing and the
removal of the sheet's printing to cases captured before they existed, as the
Trace page would; a run with any flag is not compared with the app's own
result.

The evaluator replays every case through `detectOutline`, checks that the
replay matches what the app produced, and, where `<name>.truth.json` exists,
reports boundary metrics in millimetres. A reference outline is
`{ "outline": Outline, "status": "draft" | "reviewed" }` in crop pixels.
