import { strToU8, zipSync } from "fflate";
import { version } from "../../../package.json";
import type { TraceState } from "@/state/trace-store";
import { inspectPhotoDimensions } from "./photo-dimensions";
import { TRACE_REPORT_SEND_DETAILS_MAX_BYTES, TRACE_REPORT_SEND_PHOTO_MAX_BYTES, TRACE_REPORT_SEND_PHOTO_MAX_MIB,
  tracePhotoSubmissionSchema, type TracePhotoSubmission } from "@shared/trace-photo-report-schema";

export const TRACE_REPORT_EMAIL = "feedback@pocketry.xyz";
export const TRACE_REPORT_NOTE_LIMIT = 2000;
// Match the existing recovery limit, including photos from older app versions.
const MAX_PHOTO_BYTES = 45_000_000;

/** Use the retained source even after perspective correction or photo rotation. */
export function traceReportPhoto(trace: TraceState): string | null {
  return trace.perspectiveOriginalImageUrl ?? trace.imageUrl;
}

/** Include only this Trace photo and settings, never other projects or logs. */
function prepareTracePhotoReport(trace: TraceState, note: string, userAgent: string, now: Date,
  maxPhotoBytes = MAX_PHOTO_BYTES) {
  const photo = traceReportPhoto(trace);
  if (!photo) throw new Error("Choose a photo before reporting a tracing problem.");
  const comma = photo.indexOf(",");
  const mime = /^data:image\/(png|jpeg|webp);base64$/i.exec(photo.slice(0, comma));
  if (!mime || comma < 0) {
    throw new Error("The original photo could not be included. Choose the photo again and retry.");
  }
  if (photo.length - comma - 1 > Math.ceil(maxPhotoBytes / 3) * 4) {
    throw new Error(maxPhotoBytes === TRACE_REPORT_SEND_PHOTO_MAX_BYTES
      ? `This photo is larger than ${TRACE_REPORT_SEND_PHOTO_MAX_MIB} MiB. Choose a smaller photo or email the maintainer directly.`
      : "The original photo is too large to include.");
  }
  const binary = atob(photo.slice(comma + 1));
  if (binary.length > maxPhotoBytes) throw new Error("The original photo is too large to include.");
  const photoBytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const originalSize = inspectPhotoDimensions(photoBytes);
  const extension = mime[1].toLowerCase() === "jpeg" ? "jpg" : mime[1].toLowerCase();
  const photoName = `original-photo.${extension}`;
  const report = {
    reportSchemaVersion: 1,
    appVersion: version,
    createdAt: now.toISOString(),
    description: note.trim().slice(0, TRACE_REPORT_NOTE_LIMIT),
    userAgent,
    photo: { file: photoName, name: trace.fileName, size: originalSize,
      rotation: trace.perspectiveOriginalImageRotation ?? trace.imageRotation },
    // Coordinates below describe the working image, not the original photo.
    trace: {
      imageSize: trace.imageSize,
      imageRotation: trace.imageRotation,
      imageAlignment: trace.imageAlignment,
      perspectiveCorrection: trace.perspectiveCorrection,
      pendingPerspective: trace.pendingPerspective,
      calibration: trace.calibration,
      calibrationSource: trace.calibrationSource,
      pendingAutoCalibration: trace.pendingAutoCalibration,
      pendingPaperCalibration: trace.pendingPaperCalibration,
      pendingCalibrationSource: trace.pendingCalibrationSource,
      pendingAidRequiresPerspective: trace.pendingAidRequiresPerspective,
      draftCalibration: trace.draftCalibration,
      manualPerspectivePoints: trace.manualPerspectivePoints,
      manualPerspectivePaper: trace.manualPerspectivePaper,
      region: trace.region,
      boundaryMethod: trace.boundaryMethod,
      sensitivity: trace.sensitivity,
      includeInteriorHoles: trace.includeInteriorHoles,
      tolerancePx: trace.tolerancePx,
      smoothing: trace.smoothing,
      margin: trace.margin,
      editableCurves: trace.editableCurves,
      detectionHints: trace.detectionHints,
      estimatedEdgeRegions: trace.estimatedEdgeRegions,
      outline: trace.outline,
      rawOutline: trace.rawOutline,
      curves: trace.curves,
      detectionComplete: trace.detectedImageUrl === trace.imageUrl,
      referencesAttempted: trace.autoCalibrationAttemptedImageUrl === trace.imageUrl,
      processing: trace.processing,
    },
  };
  return { photoBytes, photoName, photoType: `image/${mime[1].toLowerCase()}` as TracePhotoSubmission["photo"]["type"],
    photoContent: photo.slice(comma + 1), details: JSON.stringify(report, null, 2) };
}

/** Prepare the original photo and Trace data for the dedicated private form. */
export function createTracePhotoSubmission(trace: TraceState, note: string, replyEmail: string,
  userAgent: string, now = new Date()): TracePhotoSubmission {
  const report = prepareTracePhotoReport(trace, note, userAgent, now, TRACE_REPORT_SEND_PHOTO_MAX_BYTES);
  if (new TextEncoder().encode(report.details).length > TRACE_REPORT_SEND_DETAILS_MAX_BYTES) {
    throw new Error("This trace has too much detail to email. Simplify the outline and retry.");
  }
  return tracePhotoSubmissionSchema.parse({ photo: { type: report.photoType, content: report.photoContent },
    details: report.details, replyEmail: replyEmail.trim(), website: "" });
}

/** Build a local archive for manual recovery or sharing. */
export function createTracePhotoReport(trace: TraceState, note: string, userAgent: string,
  now = new Date()): { bytes: Uint8Array; fileName: string } {
  const report = prepareTracePhotoReport(trace, note, userAgent, now);
  // Give each download its own name so the email points to the exact archive.
  // getRandomValues also works on self-hosted editors served over plain HTTP.
  const reportId = Array.from(crypto.getRandomValues(new Uint8Array(12)),
    byte => byte.toString(16).padStart(2, "0")).join("");
  return {
    fileName: `pocketry-trace-report-${reportId}.zip`,
    bytes: zipSync({
      [report.photoName]: [report.photoBytes, { level: 0 }],
      "tracing-details.json": strToU8(report.details),
    }),
  };
}

/** Email clients cannot attach downloads through mailto; make the manual step explicit. */
export function traceReportEmailHref(fileName: string): string {
  const subject = `Pocketry ${version}: tracing problem`;
  const body = `Please see my attached photo report for the tracing problem.\n\nAttach the downloaded file before sending: ${fileName}\n\nThe ZIP includes my original photo, tracing settings, and problem description.`;
  return `mailto:${TRACE_REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
