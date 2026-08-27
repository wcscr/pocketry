import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";

import type { Calibration, DraftCalibration } from "@shared/geometry/scale";
import type { Outline, Rect, RingRef } from "@shared/geometry/types";

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
export type TraceMode = "pan" | "region" | "edit" | "calibrate";

export type ExportFormat = "svg" | "dxf" | "dwg" | "stl";
export type CalibrationSource = "manual" | "sheet";

export interface TraceHistoryEntry {
  outline: Outline;
  /** Human-readable operation that produced this state. */
  label: string;
}

export interface TraceState {
  /** Data URL of the loaded image, or null. */
  imageUrl: string | null;
  /** Increments for every source choice, including choosing the same file again. */
  sourceRevision: number;
  fileName: string;
  /** Working-resolution image size; the coordinate space of everything below. */
  imageSize: { width: number; height: number };

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
  outline: [],
  rawOutline: [],
  svg: null,
  detectedImageUrl: null,
  autoCalibrationAttemptedImageUrl: null,
  selection: null,
  history: { stack: [{ outline: [], label: "Start" }], index: 0 },
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
  | { type: "AUTO_CALIBRATION_DETECTED"; calibration: Calibration }
  | { type: "ACCEPT_AUTO_CALIBRATION" }
  | { type: "AUTO_CALIBRATION_ATTEMPTED"; imageUrl: string }
  | { type: "SET_DRAFT_CALIBRATION"; draftCalibration: DraftCalibration | null }
  | { type: "SET_RULER_LENGTH"; rulerLengthMm: number }
  | { type: "SET_EXPORT_FORMAT"; exportFormat: ExportFormat }
  | { type: "SET_EXTRUSION_HEIGHT"; extrusionHeight: number };

function pushHistory(
  history: TraceState["history"],
  outline: Outline,
  label: string,
): TraceState["history"] {
  // Anything redone-past is discarded, as in every undo stack.
  const stack = [
    ...history.stack.slice(0, history.index + 1),
    { outline, label },
  ];
  const trimmed = stack.length > HISTORY_LIMIT ? stack.slice(-HISTORY_LIMIT) : stack;
  return { stack: trimmed, index: trimmed.length - 1 };
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
          stack: [{ outline: action.outline, label: "Detected outline" }],
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
        ),
      };
    }

    case "OUTLINE_DRAGGING":
      return { ...state, outline: action.outline };

    case "UNDO": {
      if (state.history.index <= 0) return state;
      const index = state.history.index - 1;
      return {
        ...state,
        outline: state.history.stack[index].outline,
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
        selection: null,
        history: { ...state.history, index: action.index },
      };
    }

    case "SELECT_RING":
      return { ...state, selection: action.selection };

    case "SET_MODE":
      // Leaving calibrate mode abandons a half-placed ruler.
      return {
        ...state,
        mode: action.mode,
        // Choosing the manual ruler is an explicit rejection of an automatic
        // candidate. Removing it here keeps every manual-entry surface (panel
        // button and canvas toolbar) from leaving the auto ruler overlaid.
        pendingAutoCalibration:
          action.mode === "calibrate" ? null : state.pendingAutoCalibration,
        draftCalibration: action.mode === "calibrate" ? state.draftCalibration : null,
      };

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
        history: { stack: [{ outline: [], label: "Start" }], index: 0 },
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
        calibrationSource: action.calibration === null ? null : "manual",
        margin: state.margin ?? DEFAULT_MARGIN_MM,
        draftCalibration: null,
      };

    case "AUTO_CALIBRATION_DETECTED":
      return {
        ...state,
        calibration: null,
        pendingAutoCalibration: action.calibration,
        calibrationSource: null,
        margin: state.margin ?? DEFAULT_MARGIN_MM,
        draftCalibration: null,
        mode: "pan",
      };

    case "ACCEPT_AUTO_CALIBRATION":
      if (!state.pendingAutoCalibration) return state;
      return {
        ...state,
        calibration: state.pendingAutoCalibration,
        pendingAutoCalibration: null,
        calibrationSource: "sheet",
        margin: state.margin ?? DEFAULT_MARGIN_MM,
        draftCalibration: null,
      };

    case "AUTO_CALIBRATION_ATTEMPTED":
      return action.imageUrl === state.imageUrl
        ? { ...state, autoCalibrationAttemptedImageUrl: action.imageUrl }
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
