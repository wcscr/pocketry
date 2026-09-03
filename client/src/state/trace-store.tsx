import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";

import {
  hasCalibrationEndpoints,
  type Calibration,
  type DraftCalibration,
} from "@shared/geometry/scale";
import type { Outline, Point, Rect, RingRef } from "@shared/geometry/types";

import type {
  PerspectiveProposal,
  PerspectiveQuad,
  PerspectiveSource,
} from "@/lib/calibrate/perspective";
import type { TemplatePaper } from "@/lib/calibrate/template";
import {
  combineImageRotations,
  fitImageWithin,
  nextImageRotation,
  rotateDraftCalibration,
  rotateImageCalibration,
  rotateImageOutline,
  rotateImagePoint,
  rotateImageRect,
  rotatedImageDimensions,
  type ImageDimensions,
  type ImageQuarterTurns,
  type ImageRotationDirection,
} from "@/lib/geometry/image-rotation";
import { DEFAULT_MARGIN_MM, type Margin } from "@/lib/image-processor";

/**
 * The tracing workspace's state.
 *
 * Everything the canvas and the controls panel share lives here, for two
 * reasons the previous design got wrong:
 *
 * 1. **The outline had two owners.** It lived in both the page and the preview
 *    component, and an effect in the preview reset the undo history whenever
 *    the incoming prop identity changed — which was every edit. Undo was
 *    therefore permanently disabled and redo never enabled. One owner fixes it.
 * 2. **Calibration was passed through the DOM.** The exporters read it back out
 *    of a `data-ruler-calibration` attribute with `document.querySelector`,
 *    which silently lost the scale whenever the overlay was unmounted — for
 *    instance while processing.
 */

/** Exactly one interaction mode is active at a time. */
export type TraceMode = "pan" | "region" | "edit" | "calibrate" | "perspective";

export type ExportFormat = "svg" | "dxf" | "dwg" | "stl";
export type CalibrationSource = "manual" | "sheet";

export interface TraceHistoryEntry {
  outline: Outline;
  /** Human-readable operation that produced this state. */
  label: string;
  /** Physical clearance paired with this exact contour state. */
  margin: Margin;
}

export interface TraceState {
  /** Data URL of the loaded image, or null. */
  imageUrl: string | null;
  /** Increments for every source choice, including choosing the same file again. */
  sourceRevision: number;
  fileName: string;
  /** Working-resolution image size; the coordinate space of everything below. */
  imageSize: { width: number; height: number };
  /** Clockwise quarter-turns applied to the decoded source image. */
  imageRotation: ImageQuarterTurns;

  /** Presentation rings, after simplification, smoothing and margin. */
  outline: Outline;
  /** Dense pre-simplification rings, so detail controls re-derive instantly. */
  rawOutline: Outline;
  /** Preview SVG, also what gets POSTed. */
  svg: string | null;
  /** Source for which automatic tracing has completed, even if no rings were found. */
  detectedImageUrl: string | null;
  /** Source for which the quiet, automatic marker pass has already been attempted. */
  autoCalibrationAttemptedImageUrl: string | null;
  selection: RingRef | null;

  history: { stack: TraceHistoryEntry[]; index: number };

  /** Bias on the automatic threshold; 128 is "trust the automatic level". */
  sensitivity: number;
  /** Ramer-Douglas-Peucker tolerance, source pixels. */
  tolerancePx: number;
  /** Taubin smoothing passes. */
  smoothing: number;
  margin: Margin;

  calibration: Calibration | null;
  /** An automatically detected sheet scale awaiting explicit acceptance. */
  pendingAutoCalibration: Calibration | null;
  /** How the accepted calibration was established. */
  calibrationSource: CalibrationSource | null;
  /** A calibration mid-placement: start point known, end point not yet. */
  draftCalibration: DraftCalibration | null;
  rulerLengthMm: number;

  /** Detected sheet geometry awaiting perspective-correction review. */
  pendingPerspective: PerspectiveProposal | null;
  /** Page corners placed manually in top-left clockwise order. */
  manualPerspectivePoints: Point[];
  /** Original source retained so a correction remains reversible. */
  perspectiveOriginalImageUrl: string | null;
  /** Orientation of the retained source before perspective correction. */
  perspectiveOriginalImageRotation: ImageQuarterTurns | null;
  /** How the current working image was rectified, or null for the original. */
  perspectiveCorrection: {
    source: PerspectiveSource;
    paper: TemplatePaper;
  } | null;

  region: Rect | null;
  mode: TraceMode;
  processing: boolean;

  exportFormat: ExportFormat;
  extrusionHeight: number;
}

const HISTORY_LIMIT = 50;

export const initialTraceState: TraceState = {
  imageUrl: null,
  sourceRevision: 0,
  fileName: "",
  imageSize: { width: 0, height: 0 },
  imageRotation: 0,
  outline: [],
  rawOutline: [],
  svg: null,
  detectedImageUrl: null,
  autoCalibrationAttemptedImageUrl: null,
  selection: null,
  history: {
    stack: [{ outline: [], label: "Start", margin: DEFAULT_MARGIN_MM }],
    index: 0,
  },
  sensitivity: 128,
  tolerancePx: 1.2,
  smoothing: 1,
  // The preference exists before calibration, but marginToPixels keeps it
  // physically inactive until the image has a valid scale.
  margin: DEFAULT_MARGIN_MM,
  calibration: null,
  pendingAutoCalibration: null,
  calibrationSource: null,
  draftCalibration: null,
  rulerLengthMm: 100,
  pendingPerspective: null,
  manualPerspectivePoints: [],
  perspectiveOriginalImageUrl: null,
  perspectiveOriginalImageRotation: null,
  perspectiveCorrection: null,
  region: null,
  mode: "pan",
  processing: false,
  exportFormat: "stl",
  extrusionHeight: 14,
};

export type TraceAction =
  | { type: "SOURCE_LOADED"; imageUrl: string; fileName: string }
  | { type: "SOURCE_READY"; imageSize: { width: number; height: number } }
  | { type: "SOURCE_CLEARED" }
  | {
      type: "ROTATE_SOURCE";
      direction: ImageRotationDirection;
      /** Decoded dimensions before the selected orientation and working cap. */
      naturalSize: ImageDimensions;
      maxSize: ImageDimensions;
    }
  | {
      type: "DETECTED";
      outline: Outline;
      rawOutline: Outline;
      svg: string;
      imageUrl: string | null;
      /** Region used by this asynchronous result, for stale-result rejection. */
      region: Rect | null;
    }
  | { type: "OUTLINE_REFINED"; outline: Outline }
  /** A committed edit: pushes onto the undo stack. */
  | { type: "OUTLINE_COMMITTED"; outline: Outline; label?: string }
  /** An offset of the current edited contour and its physical setting. */
  | { type: "MARGIN_COMMITTED"; outline: Outline; margin: Margin }
  /** A mid-drag update: previews without touching the committed history. */
  | { type: "OUTLINE_DRAGGING"; outline: Outline }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "JUMP_TO_HISTORY"; index: number }
  | { type: "SELECT_RING"; selection: RingRef | null }
  | { type: "SET_MODE"; mode: TraceMode }
  | { type: "SET_REGION"; region: Rect | null }
  /** A valid crop drag is complete; return to the normal pointer mode. */
  | { type: "REGION_COMMITTED" }
  | { type: "SET_PROCESSING"; processing: boolean }
  | { type: "SET_SENSITIVITY"; sensitivity: number }
  | { type: "SET_TOLERANCE"; tolerancePx: number }
  | { type: "SET_SMOOTHING"; smoothing: number }
  | { type: "SET_MARGIN"; margin: Margin }
  | { type: "SET_CALIBRATION"; calibration: Calibration | null }
  | {
      type: "AUTO_CALIBRATION_DETECTED";
      /** Source image used by this asynchronous result. */
      sourceImageUrl: string;
      calibration: Calibration;
      perspective?: PerspectiveProposal | null;
    }
  | { type: "ACCEPT_AUTO_CALIBRATION" }
  | { type: "AUTO_CALIBRATION_ATTEMPTED"; imageUrl: string }
  | { type: "AUTO_CALIBRATION_FAILED"; sourceImageUrl: string }
  | { type: "SET_DRAFT_CALIBRATION"; draftCalibration: DraftCalibration | null }
  | { type: "SET_RULER_LENGTH"; rulerLengthMm: number }
  | { type: "START_PERSPECTIVE_SELECTION" }
  | { type: "ADD_PERSPECTIVE_POINT"; point: Point }
  | { type: "SET_PERSPECTIVE_POINTS"; points: Point[] }
  | { type: "CANCEL_PERSPECTIVE_SELECTION" }
  | {
      type: "PERSPECTIVE_APPLIED";
      /** Source image that was corrected; rejects a late result after replacement. */
      sourceImageUrl: string;
      imageUrl: string;
      imageSize: { width: number; height: number };
      calibration: Calibration;
      source: PerspectiveSource;
      paper: TemplatePaper;
    }
  | { type: "RESTORE_PERSPECTIVE_SOURCE" }
  | { type: "SET_EXPORT_FORMAT"; exportFormat: ExportFormat }
  | { type: "SET_EXTRUSION_HEIGHT"; extrusionHeight: number };

function pushHistory(
  history: TraceState["history"],
  outline: Outline,
  label: string,
  margin: Margin,
): TraceState["history"] {
  // Anything redone-past is discarded, as in every undo stack.
  const stack = [
    ...history.stack.slice(0, history.index + 1),
    { outline, label, margin },
  ];
  const trimmed = stack.length > HISTORY_LIMIT ? stack.slice(-HISTORY_LIMIT) : stack;
  return { stack: trimmed, index: trimmed.length - 1 };
}

function rotatePerspectiveProposal(
  proposal: PerspectiveProposal,
  source: ImageDimensions,
  target: ImageDimensions,
  direction: ImageRotationDirection,
): PerspectiveProposal {
  let points = proposal.points.map((point) =>
    rotateImagePoint(point, source, target, direction),
  ) as PerspectiveQuad;
  // Manual proposals map array positions to TL/TR/BR/BL destination corners.
  // A visual quarter-turn changes which original corner is now top-left.
  if (proposal.source === "manual") {
    points = (direction === "clockwise"
      ? [points[3], points[0], points[1], points[2]]
      : [points[1], points[2], points[3], points[0]]) as PerspectiveQuad;
  }
  return {
    ...proposal,
    points,
    correspondences: proposal.correspondences
      ? {
          ...proposal.correspondences,
          source: proposal.correspondences.source.map((point) =>
            rotateImagePoint(point, source, target, direction),
          ),
        }
      : undefined,
  };
}

function rotateManualPerspectivePoints(
  points: Point[],
  source: ImageDimensions,
  target: ImageDimensions,
  direction: ImageRotationDirection,
): Point[] {
  const rotated = points.map((point) =>
    rotateImagePoint(point, source, target, direction),
  );
  if (rotated.length !== 4) return [];
  return direction === "clockwise"
    ? [rotated[3], rotated[0], rotated[1], rotated[2]]
    : [rotated[1], rotated[2], rotated[3], rotated[0]];
}

export function traceReducer(state: TraceState, action: TraceAction): TraceState {
  switch (action.type) {
    case "SOURCE_LOADED":
      // A new image invalidates the ruler, the crop, and every point. Without
      // this reset a stale calibration silently rescales every later export.
      return {
        ...initialTraceState,
        imageUrl: action.imageUrl,
        sourceRevision: state.sourceRevision + 1,
        fileName: action.fileName,
        // Settings are a user preference, not image data, so they carry over.
        sensitivity: state.sensitivity,
        tolerancePx: state.tolerancePx,
        smoothing: state.smoothing,
        exportFormat: state.exportFormat,
        extrusionHeight: state.extrusionHeight,
        rulerLengthMm: state.rulerLengthMm,
      };

    case "SOURCE_READY":
      return { ...state, imageSize: action.imageSize };

    case "ROTATE_SOURCE": {
      if (
        !state.imageUrl ||
        state.processing ||
        state.imageSize.width <= 0 ||
        state.imageSize.height <= 0
      ) {
        return state;
      }
      const imageRotation = nextImageRotation(
        state.imageRotation,
        action.direction,
      );
      const imageSize = fitImageWithin(
        rotatedImageDimensions(action.naturalSize, imageRotation),
        action.maxSize,
      );
      const rotateCalibration = (calibration: Calibration | null) =>
        calibration
          ? rotateImageCalibration(
              calibration,
              state.imageSize,
              imageSize,
              action.direction,
            )
          : null;
      const hasPartialPerspectiveSelection =
        state.manualPerspectivePoints.length > 0 &&
        state.manualPerspectivePoints.length < 4;

      return {
        ...state,
        imageSize,
        imageRotation,
        outline: rotateImageOutline(
          state.outline,
          state.imageSize,
          imageSize,
          action.direction,
        ),
        rawOutline: rotateImageOutline(
          state.rawOutline,
          state.imageSize,
          imageSize,
          action.direction,
        ),
        // This legacy detector preview is not consumed by the current UI.
        // Never retain pixel-space markup whose viewBox no longer matches.
        svg: null,
        history: {
          ...state.history,
          stack: state.history.stack.map((entry) => ({
            ...entry,
            outline: rotateImageOutline(
              entry.outline,
              state.imageSize,
              imageSize,
              action.direction,
            ),
          })),
        },
        calibration: rotateCalibration(state.calibration),
        pendingAutoCalibration: rotateCalibration(
          state.pendingAutoCalibration,
        ),
        draftCalibration: state.draftCalibration
          ? rotateDraftCalibration(
              state.draftCalibration,
              state.imageSize,
              imageSize,
              action.direction,
            )
          : null,
        region: state.region
          ? rotateImageRect(
              state.region,
              state.imageSize,
              imageSize,
              action.direction,
            )
          : null,
        pendingPerspective: state.pendingPerspective
          ? rotatePerspectiveProposal(
              state.pendingPerspective,
              state.imageSize,
              imageSize,
              action.direction,
            )
          : null,
        manualPerspectivePoints: rotateManualPerspectivePoints(
          state.manualPerspectivePoints,
          state.imageSize,
          imageSize,
          action.direction,
        ),
        mode:
          hasPartialPerspectiveSelection && state.mode === "perspective"
            ? "pan"
            : state.mode,
        // Marker detection is rotation-invariant, and any accepted/pending
        // geometry above has already been turned with the source.
        autoCalibrationAttemptedImageUrl:
          state.autoCalibrationAttemptedImageUrl,
      };
    }

    case "SOURCE_CLEARED":
      return {
        ...initialTraceState,
        sourceRevision: state.sourceRevision + 1,
        sensitivity: state.sensitivity,
      };

    case "DETECTED":
      // An older asynchronous detection may finish after a replacement image
      // has loaded or after its region was cleared/replaced. Never let that
      // stale result overwrite the current Trace session.
      if (action.imageUrl !== state.imageUrl) return state;
      if (
        action.region !== null &&
        (!state.region ||
          action.region.x !== state.region.x ||
          action.region.y !== state.region.y ||
          action.region.width !== state.region.width ||
          action.region.height !== state.region.height)
      ) {
        return state;
      }
      return {
        ...state,
        outline: action.outline,
        rawOutline: action.rawOutline,
        svg: action.svg,
        detectedImageUrl: action.imageUrl,
        selection: null,
        history: {
          stack: [
            {
              outline: action.outline,
              label: "Detected outline",
              margin: state.margin,
            },
          ],
          index: 0,
        },
      };

    case "OUTLINE_REFINED": {
      // Slider-driven re-derivation is not an undoable edit.
      // It still becomes the baseline for the next manual edit, otherwise an
      // undo after moving one node would silently revert all detection sliders.
      const stack = [...state.history.stack];
      stack[state.history.index] = {
        ...stack[state.history.index],
        outline: action.outline,
      };
      return {
        ...state,
        outline: action.outline,
        history: { ...state.history, stack },
      };
    }

    case "OUTLINE_COMMITTED": {
      const current = state.history.stack[state.history.index];
      if (current?.outline === action.outline) return state;
      return {
        ...state,
        outline: action.outline,
        history: pushHistory(
          state.history,
          action.outline,
          action.label ?? "Edit contour",
          state.margin,
        ),
      };
    }

    case "MARGIN_COMMITTED":
      if (state.margin === action.margin && state.outline === action.outline) {
        return state;
      }
      return {
        ...state,
        margin: action.margin,
        outline: action.outline,
        history: pushHistory(
          state.history,
          action.outline,
          `Set contour margin to ${action.margin ?? 0} mm`,
          action.margin,
        ),
      };

    case "OUTLINE_DRAGGING":
      return { ...state, outline: action.outline };

    case "UNDO": {
      if (state.history.index <= 0) return state;
      const index = state.history.index - 1;
      return {
        ...state,
        outline: state.history.stack[index].outline,
        margin: state.history.stack[index].margin,
        selection: null,
        history: { ...state.history, index },
      };
    }

    case "REDO": {
      if (state.history.index >= state.history.stack.length - 1) return state;
      const index = state.history.index + 1;
      return {
        ...state,
        outline: state.history.stack[index].outline,
        margin: state.history.stack[index].margin,
        selection: null,
        history: { ...state.history, index },
      };
    }

    case "JUMP_TO_HISTORY": {
      if (
        !Number.isInteger(action.index) ||
        action.index < 0 ||
        action.index >= state.history.stack.length ||
        action.index === state.history.index
      ) {
        return state;
      }
      return {
        ...state,
        outline: state.history.stack[action.index].outline,
        margin: state.history.stack[action.index].margin,
        selection: null,
        history: { ...state.history, index: action.index },
      };
    }

    case "SELECT_RING":
      return { ...state, selection: action.selection };

    case "SET_MODE": {
      // Leaving calibrate mode abandons a half-placed ruler. A complete pair
      // of endpoints remains visible while the reference length is confirmed.
      // Entering either manual measurement mode rejects an automatic proposal.
      const rejectsAutomatic =
        action.mode === "calibrate" || action.mode === "perspective";
      const startsCalibration =
        action.mode === "calibrate" && state.mode !== "calibrate";
      return {
        ...state,
        mode: action.mode,
        // Redrawing is a replacement, not a second ruler layered over the
        // accepted one. Invalidate both the old scale and any completed draft
        // when manual placement starts; repeat clicks on the active tool leave
        // the ruler currently being placed alone.
        calibration: startsCalibration ? null : state.calibration,
        calibrationSource: startsCalibration ? null : state.calibrationSource,
        // Choosing a manual tool is an explicit rejection of the automatic
        // candidate, including all of its canvas overlays.
        pendingAutoCalibration:
          rejectsAutomatic ? null : state.pendingAutoCalibration,
        pendingPerspective: rejectsAutomatic ? null : state.pendingPerspective,
        draftCalibration:
          startsCalibration
            ? null
            : action.mode === "calibrate" ||
                hasCalibrationEndpoints(state.draftCalibration)
              ? state.draftCalibration
              : null,
      };
    }

    case "SET_REGION":
      if (action.region !== null) return { ...state, region: action.region };
      // A contour is only meaningful for a chosen detection region. Clearing
      // that region removes both the visible result and its edit history.
      return {
        ...state,
        region: null,
        outline: [],
        rawOutline: [],
        svg: null,
        detectedImageUrl: null,
        selection: null,
        history: {
          stack: [{ outline: [], label: "Start", margin: state.margin }],
          index: 0,
        },
      };

    case "REGION_COMMITTED":
      return { ...state, mode: "pan" };

    case "SET_PROCESSING":
      return { ...state, processing: action.processing };

    case "SET_SENSITIVITY":
      return { ...state, sensitivity: action.sensitivity };

    case "SET_TOLERANCE":
      return { ...state, tolerancePx: action.tolerancePx };

    case "SET_SMOOTHING":
      return { ...state, smoothing: action.smoothing };

    case "SET_MARGIN":
      return { ...state, margin: action.margin };

    case "SET_CALIBRATION":
      return {
        ...state,
        calibration: action.calibration,
        pendingAutoCalibration: null,
        pendingPerspective: null,
        calibrationSource: action.calibration === null ? null : "manual",
        margin: state.margin ?? DEFAULT_MARGIN_MM,
        draftCalibration: null,
      };

    case "AUTO_CALIBRATION_DETECTED":
      return action.sourceImageUrl === state.imageUrl
        ? {
            ...state,
            calibration: null,
            pendingAutoCalibration: action.calibration,
            pendingPerspective: action.perspective ?? null,
            calibrationSource: null,
            margin: state.margin ?? DEFAULT_MARGIN_MM,
            draftCalibration: null,
            manualPerspectivePoints: [],
            mode: "pan",
          }
        : state;

    case "ACCEPT_AUTO_CALIBRATION":
      if (!state.pendingAutoCalibration) return state;
      return {
        ...state,
        calibration: state.pendingAutoCalibration,
        pendingAutoCalibration: null,
        pendingPerspective: null,
        calibrationSource: "sheet",
        margin: state.margin ?? DEFAULT_MARGIN_MM,
        draftCalibration: null,
      };

    case "AUTO_CALIBRATION_ATTEMPTED":
      return action.imageUrl === state.imageUrl
        ? { ...state, autoCalibrationAttemptedImageUrl: action.imageUrl }
        : state;

    case "AUTO_CALIBRATION_FAILED":
      // Only the automatic upload-time pass may hand off to the manual ruler.
      // Reject stale results and never interrupt a scale the user has already
      // placed or a sheet proposal that arrived first.
      return action.sourceImageUrl === state.imageUrl &&
        !state.calibration &&
        !state.pendingAutoCalibration
        ? { ...state, mode: "calibrate" }
        : state;

    case "SET_DRAFT_CALIBRATION":
      return { ...state, draftCalibration: action.draftCalibration };

    case "SET_RULER_LENGTH":
      return {
        ...state,
        rulerLengthMm: action.rulerLengthMm,
        // A completed manual ruler and its reference-length input describe the
        // same measurement. Keep them coupled so correcting the known length
        // immediately corrects mm/px without making the user redraw the line.
        // Sheet calibration has an independently detected physical scale, so
        // this preference must not overwrite it.
        calibration:
          state.calibrationSource === "manual" && state.calibration
            ? { ...state.calibration, lengthMm: action.rulerLengthMm }
            : state.calibration,
      };

    case "START_PERSPECTIVE_SELECTION":
      return {
        ...state,
        mode: "perspective",
        pendingAutoCalibration: null,
        pendingPerspective: null,
        manualPerspectivePoints: [],
        draftCalibration: null,
      };

    case "ADD_PERSPECTIVE_POINT": {
      if (state.manualPerspectivePoints.length >= 4) return state;
      const manualPerspectivePoints = [
        ...state.manualPerspectivePoints,
        action.point,
      ];
      return {
        ...state,
        manualPerspectivePoints,
        mode: manualPerspectivePoints.length === 4 ? "pan" : "perspective",
      };
    }

    case "SET_PERSPECTIVE_POINTS":
      return action.points.length === 4
        ? { ...state, manualPerspectivePoints: action.points }
        : state;

    case "CANCEL_PERSPECTIVE_SELECTION":
      return {
        ...state,
        mode: "pan",
        manualPerspectivePoints: [],
      };

    case "PERSPECTIVE_APPLIED":
      if (action.sourceImageUrl !== state.imageUrl) return state;
      return {
        ...initialTraceState,
        imageUrl: action.imageUrl,
        sourceRevision: state.sourceRevision + 1,
        fileName: state.fileName,
        imageSize: action.imageSize,
        autoCalibrationAttemptedImageUrl: action.imageUrl,
        sensitivity: state.sensitivity,
        tolerancePx: state.tolerancePx,
        smoothing: state.smoothing,
        margin: state.margin ?? DEFAULT_MARGIN_MM,
        calibration: action.calibration,
        calibrationSource: "sheet",
        rulerLengthMm: state.rulerLengthMm,
        perspectiveOriginalImageUrl:
          state.perspectiveOriginalImageUrl ?? state.imageUrl,
        perspectiveOriginalImageRotation:
          state.perspectiveOriginalImageRotation ?? state.imageRotation,
        perspectiveCorrection: { source: action.source, paper: action.paper },
        mode: "region",
        exportFormat: state.exportFormat,
        extrusionHeight: state.extrusionHeight,
      };

    case "RESTORE_PERSPECTIVE_SOURCE":
      if (!state.perspectiveOriginalImageUrl) return state;
      return {
        ...initialTraceState,
        imageUrl: state.perspectiveOriginalImageUrl,
        sourceRevision: state.sourceRevision + 1,
        fileName: state.fileName,
        // A corrected raster starts at rotation 0 even when its source was
        // already oriented. Carry any later turns back onto the raw source.
        imageRotation: combineImageRotations(
          state.perspectiveOriginalImageRotation ?? 0,
          state.imageRotation,
        ),
        // Do not immediately propose the same correction again. The explicit
        // Detect sheet action remains available if the user wants another try.
        autoCalibrationAttemptedImageUrl: state.perspectiveOriginalImageUrl,
        sensitivity: state.sensitivity,
        tolerancePx: state.tolerancePx,
        smoothing: state.smoothing,
        margin: state.margin,
        rulerLengthMm: state.rulerLengthMm,
        exportFormat: state.exportFormat,
        extrusionHeight: state.extrusionHeight,
      };

    case "SET_EXPORT_FORMAT":
      return { ...state, exportFormat: action.exportFormat };

    case "SET_EXTRUSION_HEIGHT":
      return { ...state, extrusionHeight: action.extrusionHeight };
  }
}

export interface TraceStore extends TraceState {
  dispatch: Dispatch<TraceAction>;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

const TraceContext = createContext<TraceStore | null>(null);

export function TraceProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(traceReducer, initialTraceState);

  const undo = useCallback(() => dispatch({ type: "UNDO" }), []);
  const redo = useCallback(() => dispatch({ type: "REDO" }), []);

  const value = useMemo<TraceStore>(
    () => ({
      ...state,
      dispatch,
      canUndo: state.history.index > 0,
      canRedo: state.history.index < state.history.stack.length - 1,
      undo,
      redo,
    }),
    [state, undo, redo],
  );

  return <TraceContext.Provider value={value}>{children}</TraceContext.Provider>;
}

export function useTrace(): TraceStore {
  const store = useContext(TraceContext);
  if (!store) throw new Error("useTrace must be used inside a TraceProvider");
  return store;
}
