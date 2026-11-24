import { strFromU8, unzipSync } from "fflate";
import { expect, it } from "vitest";
import { initialTraceState } from "@/state/trace-store";
import { createTracePhotoReport, traceReportEmailHref, traceReportPhoto, TRACE_REPORT_NOTE_LIMIT } from "./trace-photo-report";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const now = new Date("2026-11-24T15:00:00Z");

it("preserves original bytes after perspective correction and reports only this trace", () => {
  const trace = { ...initialTraceState, imageUrl: "data:image/png;base64,corrected", perspectiveOriginalImageUrl: png,
    perspectiveOriginalImageRotation: 1 as const, imageRotation: 2 as const, fileName: "../../My tool",
    imageSize: { width: 800, height: 600 },
    calibration: { startX: 10, startY: 20, endX: 110, endY: 20, lengthMm: 50 },
    region: { x: 30, y: 40, width: 50, height: 60 }, sensitivity: 97,
    outline: [{ outer: [{ x: 30, y: 40 }, { x: 80, y: 40 }, { x: 80, y: 100 }], holes: [] }],
    detectionHints: [{ kind: "tool" as const, points: [{ x: 50, y: 60 }], radius: 4 }],
    otherProject: "private project", location: "https://example.test/?secret=token" };
  const before = JSON.stringify(trace);
  const result = createTracePhotoReport(trace, "  The tip is missing.  ", "test browser", now);
  expect(result.fileName).toBe("pocketry-trace-report-My-tool.zip");
  const files = unzipSync(result.bytes);
  expect(Object.keys(files).sort()).toEqual(["original-photo.png", "tracing-details.json"]);
  expect(files["original-photo.png"]).toEqual(Uint8Array.from(atob(png.split(",")[1]), char => char.charCodeAt(0)));
  const details = JSON.parse(strFromU8(files["tracing-details.json"]));
  expect(details).toMatchObject({ reportSchemaVersion: 1, createdAt: now.toISOString(),
    description: "The tip is missing.", userAgent: "test browser",
    photo: { file: "original-photo.png", name: "../../My tool", size: { width: 1, height: 1 }, rotation: 1 },
    trace: { imageSize: trace.imageSize, imageRotation: 2, calibration: trace.calibration,
      region: trace.region, sensitivity: 97, outline: trace.outline, detectionHints: trace.detectionHints } });
  expect(strFromU8(files["tracing-details.json"])).not.toMatch(/data:image|corrected|secret=token|private project|otherProject/);
  expect(JSON.stringify(trace)).toBe(before);
  expect(traceReportPhoto(trace)).toBe(png);
});

it("works before calibration or detection succeeds, without a region or outline", () => {
  const trace = { ...initialTraceState, imageUrl: png, fileName: "" };
  const result = createTracePhotoReport(trace, "", "browser", now);
  const files = unzipSync(result.bytes);
  expect(result.fileName).toBe("pocketry-trace-report-photo.zip");
  const report = JSON.parse(strFromU8(files["tracing-details.json"]));
  expect(report.trace).toMatchObject({ calibration: null, region: null, outline: [], detectionComplete: false });
  expect(report.photo.rotation).toBe(0);
  expect(report.appVersion).toMatch(/^\d+\.\d+\.\d+$/);
});

it("bounds the optional description", () => {
  const result = createTracePhotoReport({ ...initialTraceState, imageUrl: png }, "x".repeat(TRACE_REPORT_NOTE_LIMIT + 100), "browser", now);
  expect(JSON.parse(strFromU8(unzipSync(result.bytes)["tracing-details.json"])).description).toHaveLength(TRACE_REPORT_NOTE_LIMIT);
});

it.each([null, "https://example.test/photo.png", "data:image/svg+xml;base64,PHN2Zy8+", "data:image/png;base64,broken", "data:image/png;base64,%%%"])(
  "refuses missing, remote, unsupported or corrupt photo data: %s", imageUrl => {
    expect(() => createTracePhotoReport({ ...initialTraceState, imageUrl }, "", "browser", now)).toThrow();
  });

it("opens an addressed draft with an encoded subject and manual attachment reminder", () => {
  const href = traceReportEmailHref("photo & tool.zip");
  expect(href.startsWith("mailto:feedback@pocketry.xyz?")).toBe(true);
  const params = new URLSearchParams(href.split("?")[1]);
  expect(params.get("subject")).toMatch(/Pocketry .*: tracing problem/);
  expect(params.get("body")).toContain("Attach the downloaded file before sending: photo & tool.zip");
  expect(params.has("attachment")).toBe(false);
  expect(params.has("attach")).toBe(false);
});
