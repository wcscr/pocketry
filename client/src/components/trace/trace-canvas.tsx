import { outlineToPathData } from "@/lib/export/svg";
import { CorrectButton, EdgeBrushGuide, CorrectionPanButton, CorrectionTools, type CorrectionTool } from "./correction-tools";
import { closesAddLoop, type DetectionHint } from "@shared/geometry/detection-hints";
import { findBrushJoin, redrawAttachments, redrawEdgeOptions } from "@shared/geometry/redraw-edge";
import { ContourMenuProvider, useContourContextMenu } from "./contour-context-menu";
import { contextMenuPoint, usesNativeEditingMenu } from "@/components/ui/pointer-context-menu";
import { pointInRing } from "@shared/geometry/rings";
import {
  Crop,
  Ellipsis,
  Hand,
  Loader2,
  Maximize2,
  MousePointer2,
  Redo2,
  Ruler,
  Scaling,
  Spline,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useCallback,
  useId,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  calibrationFromDraft,
  hasCalibrationEndpoints,
  mmPerPixel,
} from "@shared/geometry/scale";
import { OUTER_RING, type Outline, type Point, type Rect, type RingRef } from "@shared/geometry/types";

import {
  CanvasViewport,
  useCanvasViewportSize,
} from "@/components/canvas/canvas-viewport";
import { useIsMobile } from "@/hooks/use-mobile";
import { useRulerInputFraming } from "./use-ruler-input-framing";
import { useMobileContourEditor } from "@/hooks/use-mobile-contour-editor";
import { useContourPointFocus } from "@/hooks/use-contour-point-focus";
import { ContourMagnifier } from "@/components/canvas/contour-magnifier";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CanvasToolbar } from "@/components/layout/canvas-toolbar";
import { createPortal } from "react-dom";
import { useTraceInspector } from "./trace-inspector-context";
import { OutlinePointPanel, type OutlinePointTool } from "./outline-point-panel";
import { useCurveEditor } from "@/components/canvas/use-curve-editor";
import { useCurveFitting } from "@/components/canvas/use-curve-fitting";
import { usePointSelection } from "@/components/canvas/use-point-selection";
import { CURVE_TOLERANCE_MM, curvesFromOutline, sampleCurves, type CurveOutline } from "@shared/geometry/curves";
import { outlineCleanupUnavailable } from "./outline-cleanup";
import { EditHistoryMenu } from "@/components/history/edit-history-menu";
import { useViewportTransform } from "@/hooks/use-viewport-transform";
import { canHandleCanvasShortcut } from "@/lib/canvas-keyboard";
import { nearestEdge, nearestVertex } from "@/lib/geometry/hit-test";
import { getRing, iterateRings, outlineBounds, sameRingRef, setRing } from "@/lib/geometry/outline";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { hasPendingManualCalibration, useTrace, type TraceMode } from "@/state/trace-store";

import { TraceScene } from "./trace-scene";

/** Grab radius in *screen* pixels; divided by scale at use. */
const PICK_RADIUS_PX = 10;

interface EdgeReview {
  source: CurveOutline;
  options: CurveOutline[];
  side: number;
  fill?: DetectionHint;
  previewFill: boolean;
}

function insideRect(point: Point, rect: Rect): boolean {
  return point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.width && point.y <= rect.y + rect.height;
}

export interface TraceCanvasProps {
  /** Reuse the phone action tray while editing so the photo keeps its available height. */
  mobileEditDock?: HTMLDivElement | null;
  outlineCleanupRequest?: { id: number; sourceRevision: number };
  /** Incremented by the persistent review notice to focus the estimated area. */
  estimatedEdgeFocusRequest?: number;
  onReprocess: (region?: Rect) => void;
  onCorrection?: (hints: DetectionHint[]) => void;
  /** Rendered when no image is loaded. */
  emptyState?: React.ReactNode;
}

/**
 * The tracing canvas.
 *
 * `CanvasViewport` owns the box and measures it; the stage inside reads that
 * measurement from context. The split exists because the measurement has to be
 * published by a provider *above* whatever consumes it, and it is what lets the
 * same viewport host a three.js scene later without changing.
 *
 * Measurement is by `ResizeObserver`, so the canvas also refits when the
 * controls panel is dragged — a window resize listener would miss that
 * entirely, which is the concrete reason the old canvas ignored most of the
 * working area.
 */
export function TraceCanvas(props: TraceCanvasProps): JSX.Element {
  const menu = useContourContextMenu();
  const inspector = useTraceInspector();
  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  if (!menu) return <ContourMenuProvider><TraceCanvas {...props} /></ContourMenuProvider>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <CanvasViewport><TraceStage {...props} editHost={props.mobileEditDock ?? inspector?.outlineEditor ?? dock} /></CanvasViewport>
      </div>
      <div ref={setDock} className="max-h-[45%] shrink-0 overflow-y-auto overscroll-contain border-t bg-background empty:hidden" />
    </div>
  );
}

function TraceStage({ editHost, onReprocess, onCorrection, emptyState, estimatedEdgeFocusRequest = 0, outlineCleanupRequest }: TraceCanvasProps & { editHost: HTMLDivElement | null }): JSX.Element {
  const openContourMenu = useContourContextMenu();
  const store = useTrace();
  const detectedReview = store.detectedOutlineReview;
  const detectedPreview = detectedReview.preview;
  const [correctionTool, setCorrectionTool] = useState<CorrectionTool>("points");
  const previousCorrectionTool = useRef<CorrectionTool>("points");
  const correcting = store.mode === "correct";
  const manualEdits = !!store.history.stack[store.history.index]?.hasManualEdits;
  const pointUnavailable = !store.outline.length ? "Add an area to find outline points."
    : store.curves && (store.margin ?? 0) !== 0 ? "Set trace margin to zero to select curve points." : undefined;
  const brushUnavailable = manualEdits ? "Undo manual edits to run photo detection again." : undefined;
  const edgeUnavailable = store.outline.length
    ? store.curves && (store.margin ?? 0) !== 0 ? "Set trace margin to zero to redraw this edge." : undefined
    : brushUnavailable;
  const defaultCorrectionTool = !pointUnavailable ? "points" : !edgeUnavailable ? "tool" : "pan";
  const toolUnavailable = correctionTool === "points" ? pointUnavailable
    : correctionTool === "tool" ? edgeUnavailable : correctionTool === "paper" ? brushUnavailable : undefined;
  const correctionMode = correcting ? (toolUnavailable ? defaultCorrectionTool : correctionTool) : null;
  const correctingPoints = correctionMode === "points";
  const correctionBrush = correctionMode === "tool" || correctionMode === "paper" ? correctionMode : null;
  const correctionStroke = useRef<DetectionHint | null>(null);
  const submittedStroke = useRef<DetectionHint | null>(null);
  const correctionPointer = useRef<number | null>(null);
  const [brushWidth, setBrushWidth] = useState(24);
  const [edgeMessage, setEdgeMessage] = useState("");
  const [strokePreview, setStrokePreview] = useState<DetectionHint | null>(null);
  const [edgeReview, setEdgeReview] = useState<EdgeReview | null>(null);
  const [brushPoint, setBrushPoint] = useState<Point | null>(null);
  const cancelStroke = () => { setEdgeReview(null); setEdgeMessage(""); correctionStroke.current = null; correctionPointer.current = null; setStrokePreview(null); setBrushPoint(null); };
  const finishCorrection = () => {
    cancelStroke();
    submittedStroke.current = null;
    if (correcting) store.dispatch({ type: "SET_MODE", mode: "pan" });
  };
  const correctionUnavailable = store.processing ? "Wait for detection to finish."
    : store.pendingAutoCalibration || hasPendingManualCalibration(store) || store.mode === "perspective" ? "Finish calibration before correcting detection." : undefined;
  const previousFrame = useRef({ sourceRevision: store.sourceRevision, region: store.region });
  useEffect(() => {
    const previous = previousFrame.current;
    previousFrame.current = { sourceRevision: store.sourceRevision, region: store.region };
    if (correcting && (previous.sourceRevision !== store.sourceRevision || previous.region !== store.region || !store.region || detectedReview.showing)) finishCorrection();
    else cancelStroke();
  }, [correcting, store.sourceRevision, store.region, detectedReview.showing]);
  useEffect(() => { if (store.processing) cancelStroke(); }, [store.processing]);
  useEffect(cancelStroke, [store.history]);
  useEffect(() => {
    if (!correctionMode) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !canHandleCanvasShortcut(event)) return;
      event.preventDefault(); event.stopPropagation();
      if (edgeReview) cancelStroke();
      else finishCorrection();
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, [correctionMode, edgeReview]);
  const isMobile = useIsMobile();
  const sceneId = useId();
  const {
    imageUrl,
    imageSize,
    imageRotation,
    outline,
    selection,
    region,
    calibration,
    calibrationSource,
    pendingAutoCalibration,
    draftCalibration,
    rulerLengthMm,
    pendingPerspective,
    manualPerspectivePoints,
    mode,
    processing,
    dispatch,
    canUndo,
    canRedo,
    history,
    undo,
    redo,
  } = store;
  // Detected sheet geometry is useful while the user reviews it, but becomes
  // visual noise once accepted and the region tool takes over. A manually
  // placed ruler remains visible so its handles and label stay editable.
  const replacingRuler = hasPendingManualCalibration(store);
  const displayedCalibration =
    pendingAutoCalibration ?? (!replacingRuler && calibrationSource === "manual" ? calibration : null);
  const perspectiveOverlayPoints =
    manualPerspectivePoints.length > 0
      ? manualPerspectivePoints
      : (pendingPerspective?.points ?? []);
  const rulerEditable =
    !pendingAutoCalibration && (
      (!replacingRuler && calibrationSource === "manual" && calibration !== null) ||
      (mode !== "calibrate" && hasCalibrationEndpoints(draftCalibration))
    );
  const measurementMmPerPx = mmPerPixel(calibration);
  const imageCrop = store.perspectiveCorrection?.showFullPhoto ? null : store.perspectiveCorrection?.paperBounds ?? null;

  const handleRulerLengthCommit = useCallback(
    (lengthMm: number) => {
      dispatch({ type: "SET_RULER_LENGTH", rulerLengthMm: lengthMm });
      const completed = calibrationFromDraft(draftCalibration, lengthMm);
      if (completed) {
        dispatch({ type: "SET_CALIBRATION", calibration: completed });
      }
    },
    [dispatch, draftCalibration],
  );

  const containerSize = useCanvasViewportSize();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const sceneRef = useRef<SVGGElement | null>(null);

  // The hand tool supports one-finger pan and pinch without editing geometry.
  // Modifier drags remain available alongside the other drawing tools.
  const viewport = useViewportTransform({
    contentWidth: imageSize.width,
    contentHeight: imageSize.height,
    containerWidth: containerSize.width,
    containerHeight: containerSize.height,
    // Fit the whole photo between the touch toolbars on compact canvases.
    padding: containerSize.width < 768 ? Math.min(64, containerSize.width / 5, containerSize.height / 5) : 24,
    panEnabled: mode === "navigate" || correctionMode === "pan",
  });
  const brushRadius = brushWidth / (2 * viewport.transform.scale);
  useRulerInputFraming(isMobile, draftCalibration ?? calibration, containerSize, viewport);

  const { fit, fitToRect } = viewport;
  const fitVisiblePhoto = useCallback(() => imageCrop ? fitToRect(imageCrop) : fit(), [imageCrop, fit, fitToRect]);
  const viewportReady = containerSize.width > 0 && containerSize.height > 0;
  useEffect(() => { if (viewportReady) fitVisiblePhoto(); }, [fitVisiblePhoto, viewportReady, imageSize.width, imageSize.height]);
  const lastEstimatedFocus = useRef(estimatedEdgeFocusRequest);
  useEffect(() => {
    if (lastEstimatedFocus.current === estimatedEdgeFocusRequest || !viewportReady) return;
    lastEstimatedFocus.current = estimatedEdgeFocusRequest;
    const bounds = outlineBounds(store.estimatedEdgeRegions.map(outer => ({ outer, holes: [] })));
    if (bounds) {
      const padding = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.3;
      fitToRect({ x: bounds.minX - padding, y: bounds.minY - padding,
        width: bounds.maxX - bounds.minX + 2 * padding, height: bounds.maxY - bounds.minY + 2 * padding });
    }
  }, [estimatedEdgeFocusRequest, store.estimatedEdgeRegions, viewportReady, fitToRect]);


  // Mirrors the hook's space tracking so the cursor can promise a pan before
  // the drag starts.
  const [shiftHeld, setShiftHeld] = useState(false);
  const [rulerPointer, setRulerPointer] = useState<Point | null>(null);
  const [measurement, setMeasurement] = useState<{
    start: Point;
    end: Point | null;
  } | null>(null);
  const [measurementPointer, setMeasurementPointer] =
    useState<Point | null>(null);
  const [perspectivePointer, setPerspectivePointer] = useState<Point | null>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") setShiftHeld(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") setShiftHeld(false);
    };
    const onBlur = () => setShiftHeld(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    if (
      mode !== "calibrate" ||
      draftCalibration?.startX === undefined ||
      draftCalibration.startY === undefined
    ) {
      setRulerPointer(null);
    }
  }, [mode, draftCalibration?.startX, draftCalibration?.startY]);

  useEffect(() => {
    if (mode !== "perspective" || manualPerspectivePoints.length >= 4) {
      setPerspectivePointer(null);
    }
  }, [mode, manualPerspectivePoints.length]);

  useEffect(() => {
    // Measurements are temporary inspection marks. They never become scale
    // state and cannot leak into another tool's canvas overlay.
    if (mode !== "measure") {
      setMeasurement(null);
      setMeasurementPointer(null);
    }
  }, [mode]);

  useEffect(() => {
    viewport.attachWheel(svgRef.current);
    return () => viewport.attachWheel(null);
  }, [viewport]);

  /**
   * Screen → image coordinates.
   *
   * `getScreenCTM()` on the transformed group already composes the viewport
   * transform and any ancestor transform, so inverting it is exact. The code
   * this replaces subtracted a bounding rect and divided by the scale, silently
   * ignoring the translation.
   */
  const toImage = useCallback((clientX: number, clientY: number): Point | null => {
    const svg = svgRef.current;
    const scene = sceneRef.current;
    if (!svg || !scene) return null;

    const ctm = scene.getScreenCTM();
    // Null for a detached or display:none node.
    if (!ctm) return null;

    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }, []);

  const pickRadius = PICK_RADIUS_PX / Math.max(viewport.transform.scale, 1e-6);
  const cleanupSource = useMemo(() => store.curves ?? curvesFromOutline(outline), [store.curves, outline]);
  const review = edgeReview?.source === cleanupSource && correctionMode === "tool" && !processing ? edgeReview : null;
  const reviewedCurves = review && !review.previewFill ? review.options[review.side] : null;
  const reviewOutline = useMemo(() => reviewedCurves && sampleCurves(reviewedCurves,
    CURVE_TOLERANCE_MM / (mmPerPixel(calibration) ?? .1)), [reviewedCurves, calibration]);
  const visibleStroke = review?.previewFill ? review.fill : strokePreview;
  const edgePreview = outline.length && strokePreview?.kind === "tool" && !strokePreview.fill ? strokePreview : null;
  const joins = useMemo(() => edgePreview ? redrawAttachments(cleanupSource, edgePreview.points, viewport.transform.scale, edgePreview.radius) : undefined,
    [edgePreview, cleanupSource, viewport.transform.scale]);
  const brushStart = edgePreview?.points[0] ?? (!review && correctionMode === "tool" && !strokePreview ? brushPoint : null);
  const startJoin = useMemo(() => brushStart ? findBrushJoin(cleanupSource, brushStart, brushRadius) : undefined,
    [cleanupSource, brushStart, brushRadius]);
  const cleanupAvailable = !detectedReview.showing && !outlineCleanupUnavailable(store) && !hasPendingManualCalibration(store) && !store.pendingAutoCalibration;
  // Existing native curves remain authoritative after Undo or draft recovery,
  // even when the preference for future detections is point mode.
  const cleanupUsesCurves = store.editableCurves || !!store.curves;
  const cleanupEntry = store.history.stack[store.history.index];
  const acceptedAdd = submittedStroke.current?.kind === "tool" && submittedStroke.current === store.detectionHints.at(-1);
  const addFeedback = useMemo(() => {
    if (!acceptedAdd) return undefined;
    const previous = history.stack[history.index - 1]?.outline;
    return previous && JSON.stringify(previous) === JSON.stringify(outline)
      ? "This area was already included in the pocket." : "Your mark is included in the pocket.";
  }, [acceptedAdd, history, outline]);
  const appliedSimplification = useMemo(() => cleanupEntry?.autoSimplification &&
    (cleanupEntry.outline === outline || JSON.stringify(cleanupEntry.outline) === JSON.stringify(outline))
    ? cleanupEntry.autoSimplification : undefined, [cleanupEntry, outline]);
  const cleanup = useCurveFitting({ source: cleanupSource, ringRef: { shapeIndex: 0, ringIndex: -1 },
    editableCurves: cleanupUsesCurves,
    appliedSimplification,
    enabled: cleanupAvailable && (mode === "pan" || mode === "navigate"), contextKey: String(store.sourceRevision),
    allowOutlineSimplification: cleanupAvailable,
    scale: viewport.transform.scale, toCanvas: p => p,
    unitsPerUnit: mmPerPixel(calibration) ?? 1, unit: mmPerPixel(calibration) ? "mm" : "px",
    onCommit: (curves, label, autoSimplification) => cleanupUsesCurves ? dispatch({ type: "CURVES_COMMITTED", curves, label, autoSimplification }) : dispatch({ type: "OUTLINE_COMMITTED",
      outline: curves.map(s => ({ outer: s.outer.map(a => a.point), holes: s.holes.map(r => r.map(a => a.point)) })), label, autoSimplification }),
  });
  useEffect(() => {
    // Only a new user request starts work. Later source changes dismiss the
    // preview through the fitting hook; they must never restart it implicitly.
    if (outlineCleanupRequest && outlineCleanupRequest.sourceRevision === store.sourceRevision && cleanupAvailable && (mode === "pan" || mode === "navigate")) {
      finishCorrection();
      cleanup.start("reconstruct");
    }
  }, [outlineCleanupRequest]);
  const editingOutline = (mode === "edit" || mode === "remove") && outline.length > 0;
  const finishOutlineEdit = () => dispatch({ type: "SET_MODE", mode: "pan" });
  const curveEditor = useCurveEditor({
    preferPointTools: true,
    allowCurves: store.editableCurves || !!store.curves,
    outline, curves: store.curves, enabled: editingOutline,
    contextKey: String(store.sourceRevision), scale: viewport.transform.scale,
    viewport: viewport.handlers, panRequested: viewport.isSpaceHeld,
    tolerance: CURVE_TOLERANCE_MM / (mmPerPixel(calibration) ?? 0.1), fromClient: toImage,
    fitUnitsPerUnit: mmPerPixel(calibration) ?? 1, fitUnit: mmPerPixel(calibration) ? "mm" : "px",
    startDisabled: (store.margin ?? 0) !== 0,
    startHint: "Set trace margin to zero before editing curves. Use Bin clearance to adjust fit.",
    onFrameRepair: points => {
      const bounds = outlineBounds([{ outer: points, holes: [] }]);
      const width = containerSize.width, height = containerSize.height;
      if (!bounds || width <= 80 || height <= 160) return;
      // The edit dock sits outside the measured canvas. Frame both repair endpoints.
      const padding = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 10) * .5;
      fitToRect({ x: bounds.minX - padding, y: bounds.minY - padding,
        width: bounds.maxX - bounds.minX + 2 * padding, height: bounds.maxY - bounds.minY + 2 * padding });
    },
    onDone: finishOutlineEdit,
    onCommit: (curves, label) => store.editableCurves || store.curves ? dispatch({ type: "CURVES_COMMITTED", curves, label }) : dispatch({ type: "OUTLINE_COMMITTED",
      outline: curves.map(s => ({ outer: s.outer.map(a => a.point), holes: s.holes.map(r => r.map(a => a.point)) })), label }),
  });
  const pointSelection = usePointSelection({ source: cleanupSource,
    enabled: (!curveEditor.active && mode === "edit" || correctingPoints && !processing) && outline.length > 0,
    pointPicking: correctingPoints,
    contextKey: `${store.sourceRevision}:${correcting}`, scale: viewport.transform.scale, fromClient: toImage, toCanvas: p => p,
    viewport: viewport.handlers, panRequested: viewport.isSpaceHeld,
    onCommit: (next, label) => store.curves ? curveEditor.commit(next, label)
      : dispatch({ type: "OUTLINE_COMMITTED", label,
        outline: next.map(s => ({ outer: s.outer.map(a => a.point), holes: s.holes.map(r => r.map(a => a.point)) })) }),
    onSmoothSection: correcting ? undefined : curveEditor.fitSection,
    onRepairSection: correcting ? undefined : curveEditor.repairSection,
    repairDisabledReason: store.editableCurves && (store.margin ?? 0) !== 0 ? "Set trace margin to zero to repair with editable curves. Use Bin clearance to adjust fit." : undefined,
    onBlankClick: () => { desktopPoint.clear(); },
    onPinchStart: () => {
      mobileEditor.cancel();
      const drag = dragRef.current; dragRef.current = null;
      if (drag?.kind === "vertex" && drag.moved) dispatch({ type: "OUTLINE_DRAGGING", outline: drag.originalOutline });
      desktopPoint.clear();
    },
  });
  const desktopPoint = useContourPointFocus({
    outline,
    enabled: !curveEditor.active && !isMobile && selection !== null && mode === "edit" && !pointSelection.selectMode,
    contextKey: `${store.sourceRevision}:${imageRotation}`,
  });
  useEffect(() => {
    if (desktopPoint.selectedPoint && !sameRingRef(desktopPoint.selectedPoint.ref, selection)) desktopPoint.clear();
  }, [selection, desktopPoint.selectedPoint]);
  const deleteFocusedPoint = () => {
    const point = desktopPoint.selectedPoint;
    const ring = point && getRing(outline, point.ref);
    if (!point || !ring || !desktopPoint.canDelete) return;
    dispatch({ type: "OUTLINE_COMMITTED", outline: setRing(outline, point.ref,
      ring.filter((_, index) => index !== point.index)), label: "Remove contour node" });
    desktopPoint.clear();
  };

  // What the current drag is doing, if anything.
  const dragRef = useRef<
    | { kind: "region"; origin: Point; previousRegion: Rect | null }
    | { kind: "vertex"; ref: RingRef; index: number; origin: Point; moved: boolean; originalOutline: Outline }
    | { kind: "ruler"; end: "start" | "end" }
    | { kind: "perspective"; index: number }
    | null
  >(null);

  // A candidate selection click: armed on pointer down, disarmed
  // by movement, executed on pointer up. The threshold separates a click from
  // the start of a (failed) drag.
  const clickRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const CLICK_SLOP_PX = 4;
  const canSelectRegion = measurementMmPerPx !== null && !pendingAutoCalibration && !replacingRuler;
  const [pendingRegion, setPendingRegion] = useState<Rect | null>(null);
  useEffect(() => setPendingRegion(null), [store.sourceRevision, outline]);
  const commitRegion = (next: Rect) => {
    setPendingRegion(null);
    dispatch({ type: "SET_REGION", region: next });
    dispatch({ type: "REGION_COMMITTED" });
    onReprocess(next);
    viewport.fitToRect(next);
  };

  useEffect(() => {
    const cancelRegion = (event: KeyboardEvent) => {
      const drag = dragRef.current;
      if (event.key !== "Escape" || drag?.kind !== "region" || !canHandleCanvasShortcut(event)) return;
      event.preventDefault();
      dragRef.current = null;
      dispatch({ type: "REGION_PREVIEW", region: drag.previousRegion });
    };
    window.addEventListener("keydown", cancelRegion);
    return () => window.removeEventListener("keydown", cancelRegion);
  }, [dispatch]);

  useEffect(() => {
    // Pointer previews and active drags belong to the previous image frame;
    // committed geometry is rotated atomically by the store.
    dragRef.current = null;
    clickRef.current = null;
    setRulerPointer(null);
    setMeasurement(null);
    setMeasurementPointer(null);
    setPerspectivePointer(null);
  }, [imageRotation, store.sourceRevision]);

  /**
   * The vertex currently under the cursor, on the selected ring. Feedback
   * before commitment: the scene enlarges and fills this handle, and the
   * cursor switches to "move" — so a click that would *miss* the handle (and
   * therefore add a point) is visible as a miss before the button goes down.
   */
  const [hoveredVertexIndex, setHoveredVertexIndex] = useState<number | null>(null);

  const updateHover = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const editable =
      selection !== null && mode === "edit" && !viewport.isPanning;
    let next: number | null = null;
    if (editable) {
      const image = toImage(event.clientX, event.clientY);
      const hit = image ? nearestVertex(outline, image, pickRadius, selection) : null;
      next = hit && sameRingRef(hit.ref, selection) ? hit.index : null;
    }
    setHoveredVertexIndex((previous) => (previous === next ? previous : next));
  };

  /**
   * Click editing while a contour is selected. Returns true when consumed.
   *
   * - a click on an existing vertex is a no-op (that spot is a grab and
   *   right-click-remove target);
   * - a click beside a *different* contour switches the selection to it,
   *   mirroring the contour list in Tool Detection;
   * - a click near an edge inserts a point; empty space keeps the contour
   *   selected so an accidental click does not hide every edit handle.
   */
  const handleContourClick = (image: Point): boolean => {
    if (!selection) return false;

    const vertex = nearestVertex(outline, image, pickRadius, selection);
    if (vertex) {
      desktopPoint.select(vertex.ref, vertex.index, getRing(outline, vertex.ref)![vertex.index]);
      return true;
    }

    const edge = nearestEdge(outline, image, pickRadius, selection);
    const other = nearestEdge(outline, image, pickRadius * 4);
    if (other && !sameRingRef(other.ref, selection) && (!edge || other.distance < edge.distance)) {
      desktopPoint.clear();
      dispatch({ type: "SELECT_RING", selection: other.ref });
      return true;
    }

    if (!edge) {
      desktopPoint.clear();
      return true;
    }
    const ring = getRing(outline, edge.ref);
    if (!ring) return true;
    const next = [...ring];
    next.splice(edge.insertIndex, 0, image);
    desktopPoint.select(edge.ref, edge.insertIndex, image);
    dispatch({
      type: "OUTLINE_COMMITTED",
      outline: setRing(outline, edge.ref, next),
      label: "Add contour node",
    });
    return true;
  };

  const mobileEditing = !curveEditor.active && isMobile && mode === "edit" && !pointSelection.selectMode;
  // Compact layouts delete a focused point explicitly, so a resize must end the desktop eraser.
  useEffect(() => {
    if (isMobile && mode === "remove") dispatch({ type: "SET_MODE", mode: "edit" });
  }, [isMobile, mode, dispatch]);
  const editorPoints = curveEditor.basicPoints ?? pointSelection;
  const pointTool: OutlinePointTool = mode === "remove" ? "erase" : editorPoints.selectMode ? "select" : "edit";
  const editingRing = curveEditor.basicPoints ? curveEditor.ringRef : selection;
  const contourLabel = editingRing && (outline.length > 1 || editingRing.ringIndex !== OUTER_RING)
    ? `Contour ${editingRing.shapeIndex + 1}${editingRing.ringIndex === OUTER_RING ? "" : ` · Hole ${editingRing.ringIndex + 1}`}` : undefined;
  const changePointTool = (tool: OutlinePointTool) => {
    if (tool === pointTool) return;
    editorPoints.clear();
    editorPoints.setSelectMode(tool === "select");
    dispatch({ type: "SET_MODE", mode: tool === "erase" ? "remove" : "edit" });
  };
  const focusContour = () => {
    const ring = selection && getRing(outline, selection);
    const bounds = outlineBounds(ring ? [{ outer: ring, holes: [] }] : outline);
    if (bounds) viewport.fitToRect({ x: bounds.minX, y: bounds.minY,
      width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY });
  };
  const mobileEditor = useMobileContourEditor({
    enabled: mobileEditing, outline,
    preferredRing: selection,
    selectionKey: store.sourceRevision,
    toLocal: point => toImage(point.x, point.y),
    getScreenProjection: () => {
      const matrix = sceneRef.current?.getScreenCTM();
      return point => matrix ? { x: matrix.a * point.x + matrix.c * point.y + matrix.e,
        y: matrix.b * point.x + matrix.d * point.y + matrix.f } : point;
    },
    viewport: viewport.handlers,
    onSelect: ref => dispatch({ type: "SELECT_RING", selection: ref }),
    onPreview: next => dispatch({ type: "OUTLINE_DRAGGING", outline: next }),
    onCancel: original => dispatch({ type: "OUTLINE_DRAGGING", outline: original }),
    onCommit: (next, label) => dispatch({ type: "OUTLINE_COMMITTED", outline: next, label }),
  });
  const focusedPoint = isMobile ? mobileEditor.selectedPoint : desktopPoint.selectedPoint;
  const deletePointAction = pointTool === "edit" && editorPoints.selection.length <= 1 && (curveEditor.basicPoints ? curveEditor.deleteAnchor : focusedPoint &&
    <Button size="sm" variant="outline" disabled={isMobile ? !mobileEditor.canRemove : !desktopPoint.canDelete}
      onClick={isMobile ? mobileEditor.removeSelected : deleteFocusedPoint}>Delete point</Button>);
  const magnifiedPoint = isMobile ? mobileEditor.activePoint : desktopPoint.activePoint;

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (detectedReview.showing || review) {
      viewport.handlers.onPointerDown(event, { pan: true });
      return;
    }
    if (correcting && (correctionMode === "pan" || viewport.isSpaceHeld || correctionBrush && event.shiftKey || event.button === 1)) {
      viewport.handlers.onPointerDown(event, { pan: true }); return;
    }
    if (correctingPoints) {
      if (!pointSelection.down(event)) viewport.handlers.onPointerDown(event, { pan: false });
      return;
    }
    if (correctionBrush && event.button === 0) {
      if (correctionUnavailable || correctionStroke.current) return;
      const p = brushPosition(event);
      if (!p) return;
      const hint: DetectionHint = { kind: correctionBrush, points: [p], radius: brushRadius };
      submittedStroke.current = null; setEdgeMessage(""); setBrushPoint(p);
      correctionPointer.current = event.pointerId;
      correctionStroke.current = hint; setStrokePreview(hint);
      event.currentTarget.setPointerCapture(event.pointerId); return;
    }
    if (editingOutline && viewport.isSpaceHeld && !curveEditor.active) {
      viewport.handlers.onPointerDown(event, { pan: true });
      return;
    }
    if (pointSelection.down(event)) return;
    if (curveEditor.down(event)) return;
    if (mobileEditor.down(event)) return;
    if (isMobile && mode === "pan") {
      viewport.handlers.onPointerDown(event, { pan: true });
      return;
    }
    if (mode === "navigate") {
      viewport.handlers.onPointerDown(event);
      return;
    }
    const image = toImage(event.clientX, event.clientY);
    if (!image) return;
    const pointerPickRadius = event.pointerType === "touch"
      ? 22 / viewport.transform.scale
      : pickRadius;
    if (mode === "remove" && event.button === 0) {
      if (!selection || !getRing(outline, selection)) return;
      const vertex = nearestVertex(outline, image, pointerPickRadius, selection);
      if (vertex) {
        const ring = getRing(outline, vertex.ref);
        if (ring && ring.length > 3) {
          desktopPoint.clear();
          dispatch({ type: "OUTLINE_COMMITTED", outline: setRing(outline, vertex.ref,
            ring.filter((_, index) => index !== vertex.index)), label: "Remove contour node" });
        }
      }
      return;
    }

    if (manualPerspectivePoints.length > 0) {
      const target = event.target as Element;
      const handle = target
        .closest?.("[data-perspective-handle]")
        ?.getAttribute("data-perspective-handle");
      const index = handle === null ? Number.NaN : Number(handle);
      if (Number.isInteger(index) && index >= 0 && index < 4) {
        dragRef.current = { kind: "perspective", index };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }

    // Ruler handles stay draggable except while the page-corner tool owns the
    // pointer; its markers may legitimately overlap the scale ruler.
    if (
      event.button === 0 &&
      displayedCalibration &&
      rulerEditable &&
      mode !== "perspective"
    ) {
      const target = event.target as Element;
      const handle = target
        .closest?.("[data-ruler-handle]")
        ?.getAttribute("data-ruler-handle");
      if (handle === "start" || handle === "end") {
        dragRef.current = { kind: "ruler", end: handle };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }

    if (mode === "perspective" && event.button === 0) {
      dispatch({
        type: "ADD_PERSPECTIVE_POINT",
        point: clampPointToImage(image, imageSize),
      });
      return;
    }

    if (mode === "region" && event.button === 0) {
      if (!canSelectRegion) return;
      const origin = imageCrop ? {
        x: Math.max(imageCrop.x, Math.min(imageCrop.x + imageCrop.width, image.x)),
        y: Math.max(imageCrop.y, Math.min(imageCrop.y + imageCrop.height, image.y)),
      } : image;
      dragRef.current = { kind: "region", origin, previousRegion: region };
      dispatch({
        type: "REGION_PREVIEW",
        region: { x: origin.x, y: origin.y, width: 0, height: 0 },
      });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (mode === "calibrate" && event.button === 0) {
      if (
        draftCalibration?.startX === undefined ||
        draftCalibration.startY === undefined
      ) {
        dispatch({
          type: "SET_DRAFT_CALIBRATION",
          draftCalibration: { startX: image.x, startY: image.y },
        });
      } else {
        dispatch({
          type: "SET_DRAFT_CALIBRATION",
          draftCalibration: {
            startX: draftCalibration.startX,
            startY: draftCalibration.startY,
            endX: image.x,
            endY: image.y,
          },
        });
        // Endpoint placement alone is not a scale. Keep the dashed ruler as a
        // draft until the user explicitly confirms its real reference length.
        dispatch({ type: "SET_MODE", mode: "pan" });
      }
      return;
    }

    if (
      mode === "measure" &&
      event.button === 0 &&
      measurementMmPerPx !== null
    ) {
      const point = clampPointToImage(image, imageSize);
      setMeasurement((current) =>
        !current || current.end
          ? { start: point, end: null }
          : { start: current.start, end: point },
      );
      setMeasurementPointer(null);
      return;
    }

    if (mode === "edit" && event.button === 0 && !event.shiftKey) {
      const vertex = nearestVertex(outline, image, pointerPickRadius, selection);
      if (vertex) {
        dragRef.current = { kind: "vertex", ref: vertex.ref, index: vertex.index,
          origin: { x: event.clientX, y: event.clientY }, moved: false, originalOutline: outline };
        desktopPoint.select(vertex.ref, vertex.index, getRing(outline, vertex.ref)![vertex.index], true);
        dispatch({ type: "SELECT_RING", selection: vertex.ref });
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }

      // With a selection, clicks edit the selected contour directly.
      if (handleContourClick(image)) return;

      // No selection yet: clicking an outline inserts a point there…
      const edge = nearestEdge(outline, image, pickRadius);
      if (edge) {
        const ring = getRing(outline, edge.ref);
        if (ring) {
          const next = [...ring];
          next.splice(edge.insertIndex, 0, image);
          desktopPoint.select(edge.ref, edge.insertIndex, image);
          dispatch({
            type: "OUTLINE_COMMITTED",
            outline: setRing(outline, edge.ref, next),
            label: "Add contour node",
          });
          dispatch({ type: "SELECT_RING", selection: edge.ref });
        }
        return;
      }

      // …and clicking empty space selects whichever ring is nearest, if any.
      const near = nearestEdge(outline, image, pickRadius * 4);
      dispatch({ type: "SELECT_RING", selection: near?.ref ?? null });
      return;
    }

    // Select never changes geometry, even when the click hits a vertex.
    if (
      mode === "pan" &&
      event.button === 0 &&
      !event.shiftKey &&
      !viewport.isSpaceHeld
    ) {
      clickRef.current = { clientX: event.clientX, clientY: event.clientY };
    }

    viewport.handlers.onPointerDown(event);
  };

  // Direct edge edits can reach any part of the photo. Evidence for photo detection belongs to the region.
  const drawingEdge = correctionBrush === "tool" && outline.length > 0;
  const brushPosition = (event: ReactPointerEvent<SVGSVGElement>) => {
    const point = toImage(event.clientX, event.clientY);
    const bounds = drawingEdge ? { x: 0, y: 0, ...imageSize } : region;
    return point && bounds && insideRect(point, bounds) ? point : null;
  };
  const extendStroke = (hint: DetectionHint, p: Point | null, minDistance: number): DetectionHint | null => {
    if (!p) {
      cancelStroke();
      setEdgeMessage(drawingEdge ? "Stroke canceled at the photo boundary. Keep the stroke on the photo."
        : "Stroke canceled at the detection box. Keep the mark inside the box.");
      return null;
    }
    const last = hint.points[hint.points.length - 1], distance = Math.hypot(p.x - last.x, p.y - last.y);
    if (!distance || distance < minDistance) return hint;
    if (hint.points.length >= 4096) {
      cancelStroke(); setEdgeMessage("Stroke too long. Trace a shorter section.");
      return null;
    }
    const next: DetectionHint = { kind: hint.kind, radius: hint.radius, points: [...hint.points, p] };
    if (!manualEdits && closesAddLoop(next, viewport.transform.scale) && region && next.points.every(q => insideRect(q, region))) next.fill = true;
    return next;
  };
  const submitMark = (hint: DetectionHint) => {
    setEdgeReview(null);
    submittedStroke.current = hint;
    onCorrection?.([...store.detectionHints, hint]);
  };
  const applyReview = () => {
    if (!review) return;
    if (review.previewFill && review.fill) { submitMark(review.fill); return; }
    const next = review.options[review.side], label = "Redraw outline edge";
    if (store.curves) dispatch({ type: "CURVES_COMMITTED", curves: next, label });
    else dispatch({ type: "OUTLINE_COMMITTED", label, outline: next.map(shape => ({
      outer: shape.outer.map(a => a.point), holes: shape.holes.map(ring => ring.map(a => a.point)),
    })) });
    cancelStroke();
  };
  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const brush = correctionBrush ? brushPosition(event) : null;
    if (correctionBrush && !review) setBrushPoint(brush);
    const hint = correctionStroke.current;
    if (hint) {
      if (event.pointerId !== correctionPointer.current) return;
      const spacing = hint.kind === "tool" && outline.length ? Math.min(hint.radius / 2, 1.5 / viewport.transform.scale) : hint.radius / 2;
      const next = extendStroke(hint, brush, spacing);
      correctionStroke.current = next; setStrokePreview(next);
      return;
    }
    if (pointSelection.move(event)) return;
    if (correcting) { viewport.handlers.onPointerMove(event); return; }
    if (curveEditor.move(event)) return;
    if (mobileEditor.move(event)) return;
    // Any real movement turns a candidate click into not-a-click.
    const click = clickRef.current;
    if (
      click &&
      Math.hypot(event.clientX - click.clientX, event.clientY - click.clientY) >
        CLICK_SLOP_PX
    ) {
      clickRef.current = null;
    }

    const drag = dragRef.current;
    if (!drag) {
      if (mode === "perspective" && manualPerspectivePoints.length < 4) {
        const image = toImage(event.clientX, event.clientY);
        setPerspectivePointer(
          image ? clampPointToImage(image, imageSize) : null,
        );
        return;
      }
      if (
        mode === "calibrate" &&
        !viewport.isPanning &&
        draftCalibration?.startX !== undefined &&
        draftCalibration.startY !== undefined
      ) {
        const image = toImage(event.clientX, event.clientY);
        if (image) {
          // Hover coordinates are canvas-local preview state, not a committed
          // second endpoint. Publishing them to the shared store would make
          // the controls mistake ordinary pointer movement for the second click.
          setRulerPointer(image);
        }
        return;
      }
      if (mode === "measure" && measurement && !measurement.end) {
        const image = toImage(event.clientX, event.clientY);
        setMeasurementPointer(
          image ? clampPointToImage(image, imageSize) : null,
        );
        return;
      }
      updateHover(event);
      viewport.handlers.onPointerMove(event);
      return;
    }

    const image = toImage(event.clientX, event.clientY);
    if (!image) return;

    if (drag.kind === "region") {
      dispatch({
        type: "REGION_PREVIEW",
        region: rectFromPoints(drag.origin, image, imageCrop ?? imageSize),
      });
      return;
    }

    if (drag.kind === "ruler" && displayedCalibration) {
      const point = clampPointToImage(image, imageSize);
      dispatch({
        type: "SET_CALIBRATION",
        calibration:
          drag.end === "start"
            ? { ...displayedCalibration, startX: point.x, startY: point.y }
            : { ...displayedCalibration, endX: point.x, endY: point.y },
      });
      return;
    }

    if (drag.kind === "perspective") {
      const points = [...manualPerspectivePoints];
      points[drag.index] = clampPointToImage(image, imageSize);
      dispatch({ type: "SET_PERSPECTIVE_POINTS", points });
      return;
    }

    if (drag.kind === "vertex") {
      // Stationary pointer events and click jitter only focus the handle.
      if (!drag.moved && Math.hypot(event.clientX - drag.origin.x, event.clientY - drag.origin.y) <= CLICK_SLOP_PX) return;
      drag.moved = true;
      const ring = getRing(outline, drag.ref);
      if (!ring) return;
      const next = [...ring];
      next[drag.index] = image;
      desktopPoint.move(image);
      // Preview only. Pointer-up commits the final outline once, preserving
      // the pre-drag snapshot as the state Undo must restore.
      dispatch({
        type: "OUTLINE_DRAGGING",
        outline: setRing(outline, drag.ref, next),
      });
    }
  };

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const hint = correctionStroke.current;
    if (hint) {
      if (event.pointerId !== correctionPointer.current) return;
      correctionStroke.current = null; correctionPointer.current = null; setStrokePreview(null);
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      if (event.type === "pointerup") {
        // Pointer-up can land back at the start without a final pointer-move (especially on touch).
        const completed = extendStroke(hint, brushPosition(event), 0);
        if (!completed) return;
        if (!drawingEdge) { submitMark(completed); return; }
        try {
          const options = redrawEdgeOptions(cleanupSource, completed.points, viewport.transform.scale, completed.radius);
          setEdgeReview({ source: cleanupSource, options, side: 0,
            fill: completed.fill ? completed : undefined, previewFill: !!completed.fill });
        } catch (error) {
          if (completed.fill) submitMark(completed);
          else setEdgeMessage(error instanceof Error ? error.message : "Try tracing a shorter section.");
        }
      }
      return;
    }
    if (pointSelection.end(event)) return;
    if (correcting) { viewport.handlers.onPointerUp(event); return; }
    if (curveEditor.end(event)) return;
    if (mobileEditor.end(event)) return;
    desktopPoint.finish();
    const drag = dragRef.current;
    dragRef.current = null;

    const click = clickRef.current;
    clickRef.current = null;

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!drag) {
      // A click that survived without becoming a pan selects or deselects.
      if (click && event.type !== "pointercancel" && event.button === 0) {
        const image = toImage(event.clientX, event.clientY);
        if (image) dispatch({ type: "SELECT_RING", selection: nearestEdge(outline, image, pickRadius)?.ref ?? null });
      }
      viewport.handlers.onPointerUp(event);
      return;
    }

    if (drag.kind === "region") {
      // A stray click should not commit a degenerate crop.
      if (event.type !== "pointercancel" && region && region.width > 5 && region.height > 5) {
        if (history.stack[history.index]?.hasManualEdits) {
          setPendingRegion(region);
          dispatch({ type: "REGION_PREVIEW", region: drag.previousRegion });
        } else commitRegion(region);
      } else {
        dispatch({ type: "REGION_PREVIEW", region: drag.previousRegion });
      }
      return;
    }

    if (drag.kind === "vertex" && event.type === "pointercancel") {
      dispatch({ type: "OUTLINE_DRAGGING", outline: drag.originalOutline });
      desktopPoint.clear();
      return;
    }

    // The drag is finished, so its result becomes one undo entry.
    if (drag.kind === "vertex" && drag.moved) {
      dispatch({
        type: "OUTLINE_COMMITTED",
        outline,
        label: "Move contour node",
      });
    }
  };

  const handleContextMenu = (event: React.MouseEvent<SVGSVGElement>) => {
    if (detectedReview.showing || correctionMode) { event.preventDefault(); return; }
    if (usesNativeEditingMenu(event.target)) return;
    if (curveEditor.contextMenu(event)) return;
    if (mode !== "pan" && mode !== "navigate" && mode !== "edit" && mode !== "remove") return;
    if (mode === "edit" || mode === "remove") {
      event.preventDefault();
      if (processing) return;
      const image = toImage(event.clientX, event.clientY);
      const vertex = image && nearestVertex(outline, image, pickRadius, selection);
      const ring = vertex && getRing(outline, vertex.ref);
      if (!vertex || !ring || ring.length <= 3) return;
      desktopPoint.clear();
      dispatch({ type: "OUTLINE_COMMITTED", outline: setRing(outline, vertex.ref,
        ring.filter((_, index) => index !== vertex.index)), label: "Remove contour node" });
      return;
    }
    const image = toImage(event.clientX, event.clientY);
    if (!image) return;
    const contained = [...iterateRings(outline)].reverse().find(({ ring }) => pointInRing(ring, image));
    const edge = nearestEdge(outline, image, pickRadius);
    const ref = contained?.ref ?? edge?.ref;
    if (ref && openContourMenu?.(ref, contextMenuPoint(event))) event.preventDefault();
  };

  useCanvasShortcuts({
    fit: fitVisiblePhoto,
    resetZoom: viewport.resetZoom,
    zoomIn: () => viewport.zoomBy(1.2),
    zoomOut: () => viewport.zoomBy(1 / 1.2),
    undo,
    redo,
    escape: () => {
      const drag = dragRef.current;
      if (drag?.kind === "vertex") {
        dragRef.current = null;
        dispatch({ type: "OUTLINE_DRAGGING", outline: drag.originalOutline });
      }
      if (replacingRuler) dispatch({ type: "CANCEL_MANUAL_CALIBRATION" });
      desktopPoint.clear();
      dispatch({ type: "SELECT_RING", selection: null });
    },
  });

  const cursor = useMemo(() => {
    if (viewport.isPanning) return "grabbing";
    if (correctionMode) return review || correctionMode === "pan" || viewport.isSpaceHeld || (shiftHeld && !!correctionBrush) ? "grab" : processing ? "wait" : "crosshair";
    // Shift selects nodes during editing; Space and the hand tool still pan.
    if (viewport.isSpaceHeld || mode === "navigate" || shiftHeld && mode !== "edit" && mode !== "remove") return "grab";
    if (mode === "remove" || pointSelection.selectMode) return "crosshair";
    // Promise the grab before the drag, too.
    if (hoveredVertexIndex !== null) return "move";
    if (
      mode === "region" ||
      mode === "calibrate" ||
      mode === "measure" ||
      mode === "perspective"
    ) {
      return "crosshair";
    }
    return "default";
  }, [mode, correctionMode, correctionBrush, review, processing, viewport.isPanning, viewport.isSpaceHeld, shiftHeld, hoveredVertexIndex, pointSelection.selectMode]);

  // No wrapper element of its own: CanvasViewport already provides the
  // positioned, clipped, full-size box these children lay out against.
  return (
    <>
      <AlertDialog open={pendingRegion !== null} onOpenChange={open => { if (!open) setPendingRegion(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Re-detect in a new region?</AlertDialogTitle>
            <AlertDialogDescription>This replaces your manual contour edits with a fresh detection. Keep your edits to leave the current region unchanged.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my edits</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (pendingRegion) commitRegion(pendingRegion); }}>Replace manual edits</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {imageUrl && imageSize.width > 0 ? (
        <TraceScene
          svgRef={svgRef}
          sceneRef={sceneRef}
          sceneId={sceneId}
          imageUrl={imageUrl}
          imageSize={imageSize}
          imageRotation={imageRotation}
          imageAlignment={store.imageAlignment}
          imageCrop={imageCrop}
          transform={viewport.transform}
          highlightPocket={!!correctionBrush}
          outline={cleanup.open || detectedPreview ? [] : reviewOutline ?? outline}
          estimatedEdgeRegions={store.estimatedEdgeRegions}
          selection={detectedReview.showing || correctionMode ? null : selection}
          region={region}
          regionActive={mode === "region"}
          calibration={
            mode === "perspective" || mode === "measure"
              ? null
              : mode === "calibrate" && draftCalibration?.startX !== undefined
              ? null
              : displayedCalibration
          }
          draftCalibration={
            mode === "measure"
              ? null
              : mode === "calibrate" &&
                  draftCalibration?.startX !== undefined &&
                  draftCalibration.startY !== undefined &&
                  rulerPointer
                ? {
                    ...draftCalibration,
                    endX: rulerPointer.x,
                    endY: rulerPointer.y,
                  }
                : draftCalibration
          }
          rulerLengthMm={rulerLengthMm}
          rulerEditable={rulerEditable}
          onRulerLengthCommit={handleRulerLengthCommit}
          measurement={mode === "measure" ? measurement : null}
          measurementPreview={
            mode === "measure" ? measurementPointer : null
          }
          measurementMmPerPx={measurementMmPerPx}
          perspectivePoints={perspectiveOverlayPoints}
          perspectiveEditable={manualPerspectivePoints.length > 0}
          perspectivePreview={perspectivePointer}
          busy={processing}
          cursor={cursor}
          hoveredVertexIndex={hoveredVertexIndex}
          selectedVertexIndex={focusedPoint && sameRingRef(focusedPoint.ref, selection) ? focusedPoint.index : null}
          showVertices={!curveEditor.active && (mode === "edit" || mode === "remove")}
          contourOverlay={<>{detectedPreview && <g data-testid="detected-outline-preview" pointerEvents="none">
              <path d={outlineToPathData(detectedPreview)} fill="none" stroke="white" strokeWidth={5} vectorEffect="non-scaling-stroke" />
              <path d={outlineToPathData(detectedPreview)} fill="none" stroke="#10b981" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
            </g>}{curveEditor.overlay}{pointSelection.overlay}{cleanup.overlay}
            {correctionMode && [...store.detectionHints, ...(visibleStroke ? [visibleStroke] : [])].map((h, i) => <polyline key={`hint-${i}`} data-testid="detection-hint"
              points={(h.fill || h.points.length === 1 ? [...h.points, h.points[0]] : h.points).map(p => `${p.x},${p.y}`).join(" ")}
              fill={h.fill ? "#16a34a" : "none"} fillOpacity={.28} fillRule="evenodd" stroke={h.kind === "tool" ? "#16a34a" : "#dc2626"} strokeWidth={h.radius*2} strokeLinecap="round" strokeLinejoin="round" opacity={h === edgePreview ? .24 : .7} pointerEvents="none" />)}
            {!review && correctionMode === "tool" && !viewport.isPanning && !viewport.isSpaceHeld && !shiftHeld && !processing &&
              <EdgeBrushGuide stroke={edgePreview?.points} start={startJoin?.point} end={joins?.end.point} scale={viewport.transform.scale} />}
            {!review && correctionBrush && brushPoint && !processing && !viewport.isPanning && !viewport.isSpaceHeld && !shiftHeld &&
              <circle data-testid="correction-brush" cx={brushPoint.x} cy={brushPoint.y} r={brushRadius}
                fill={correctionMode === "tool" ? "#16a34a33" : "#dc262633"} stroke={correctionMode === "tool" ? "#16a34a" : "#dc2626"}
                strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
          </>}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={event => { if (event.pointerId === correctionPointer.current) cancelStroke(); pointSelection.lostCapture(event); curveEditor.lostCapture(event); }}
          onPointerLeave={() => {
            setBrushPoint(null);
            setHoveredVertexIndex(null);
            setMeasurementPointer(null);
            setPerspectivePointer(null);
          }}
          onContextMenu={handleContextMenu}
        />
      ) : (
        <div className="flex h-full w-full touch-pan-y overflow-y-auto p-4 md:p-8">
          <div className="m-auto h-full w-full max-w-5xl">{emptyState}</div>
        </div>
      )}

      {imageUrl && (
        <>
          <CanvasToolbar position="top-left" className="pointer-events-none max-md:flex-nowrap [&_button]:pointer-events-auto">
            {correcting ? !review && <CorrectionPanButton pressed={correctionMode === "pan"}
              onClick={() => {
                cancelStroke();
                if (correctionMode === "pan") setCorrectionTool(previousCorrectionTool.current);
                else { previousCorrectionTool.current = correctionMode ?? defaultCorrectionTool; setCorrectionTool("pan"); }
              }} /> : <>{isMobile ? <>
              <ModeButton mode="navigate" icon={Hand} label="Pan photo" />
              {mode === "measure" ? <ModeButton mode="measure" icon={Ruler} label="Measure distance" />
                : !calibration || mode === "calibrate" || mode === "perspective" ? <ModeButton mode="calibrate" icon={Scaling} label="Set scale" />
                : mode === "region" || outline.length === 0 ? <ModeButton mode="region" icon={Crop} label="Region" disabled={!canSelectRegion} />
                : <ModeButton mode="edit" icon={Spline} label="Edit outline" onSelect={focusContour} />}
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-11 w-11" aria-label="More trace tools"><Ellipsis className="h-4 w-4" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {([
                    { mode: "region", label: "Region", icon: Crop, disabled: !canSelectRegion },
                    { mode: "edit", label: "Edit outline", icon: Spline, disabled: outline.length === 0 },
                    { mode: "calibrate", label: "Set scale", icon: Scaling, disabled: false },
                    { mode: "measure", label: "Measure distance", icon: Ruler, disabled: measurementMmPerPx === null },
                  ] as const).map(tool => <DropdownMenuItem key={tool.mode} className="min-h-11" disabled={tool.disabled}
                    onSelect={() => { dispatch({ type: "SET_MODE", mode: tool.mode }); if (tool.mode === "edit") focusContour(); }}><tool.icon className="mr-2 h-4 w-4" />{tool.label}</DropdownMenuItem>)}
                </DropdownMenuContent>
              </DropdownMenu>
            </> : <>
              <ModeButton mode="pan" icon={MousePointer2} label="Select" />
              <ModeButton mode="navigate" icon={Hand} label="Pan photo" />
              <ModeButton mode="region" icon={Crop} label="Region" disabled={!canSelectRegion} />
              <ModeButton mode="edit" icon={Spline} label="Edit outline" disabled={outline.length === 0} />
              <ModeButton mode="calibrate" icon={Scaling} label="Set scale" />
              <ModeButton mode="measure" icon={Ruler} label="Measure distance" disabled={measurementMmPerPx === null} />
            </>}
            {onCorrection && region && <CorrectButton unavailable={correctionUnavailable} hasMarks={store.detectionHints.length > 0}
              onClick={() => { detectedReview.close(); cleanup.dismiss(); setCorrectionTool(defaultCorrectionTool); dispatch({ type: "SET_MODE", mode: "correct" }); }} />}
            </>}
          </CanvasToolbar>
          {editHost && correctionMode && createPortal(<CorrectionTools tool={correctionMode} busy={processing}
            hasOutline={outline.length > 0} edgeUnavailable={edgeUnavailable} brushWidth={brushWidth} onWidth={setBrushWidth}
            addFeedback={strokePreview?.fill ? "Release to finish the green loop." : joins ? "Release to preview the new edge." : edgeMessage || (correctionMode === "tool" ? addFeedback : undefined)}
            review={review && <div className="space-y-2 px-1 pb-2">
              <p role="status" className="text-xs">{review.previewFill ? "Fill the green loop, or preview it as a new edge."
                : "The purple shading shows the pocket this edge will create."}</p>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" onClick={applyReview}>{review.previewFill ? "Fill loop" : "Apply edge"}</Button>
                {review.fill && <Button size="sm" variant="outline" onClick={() => setEdgeReview({ ...review, previewFill: !review.previewFill })}>
                  {review.previewFill ? "Preview edge" : "Preview fill"}</Button>}
                {!review.previewFill && review.options.length > 1 && <Button size="sm" variant="outline"
                  onClick={() => setEdgeReview({ ...review, side: 1 - review.side })}>Other side</Button>}
                <Button size="sm" variant="ghost" onClick={cancelStroke}>Cancel</Button>
              </div>
            </div>}
            pointUnavailable={pointUnavailable} brushUnavailable={brushUnavailable} hasMarks={store.detectionHints.length > 0}
            onTool={tool => { cancelStroke(); setCorrectionTool(tool); }} onClear={() => onCorrection?.([])}
            onDone={finishCorrection}>
            {correctingPoints && pointSelection.selectionActions}
            {correctingPoints && store.curves && curveEditor.error && <p role="alert" className="text-xs text-destructive">{curveEditor.error}</p>}
          </CorrectionTools>, editHost)}

          <ContourMagnifier sceneId={sceneId} canvasWidth={containerSize.width} canvasHeight={containerSize.height} compact={isMobile}
            point={magnifiedPoint ? {
              x: viewport.transform.translateX + magnifiedPoint.x * viewport.transform.scale,
              y: viewport.transform.translateY + magnifiedPoint.y * viewport.transform.scale,
            } : null} />

          <CanvasToolbar position="top-right" className="max-md:bottom-2 max-md:left-2 max-md:right-auto max-md:top-auto">
            {/* Always present: outline edits can happen in any pointing mode,
                and a hidden undo reads as "there is no undo". */}
            <IconButton
              icon={Undo2}
              label={
                canUndo
                  ? `Undo ${history.stack[history.index].label} (Ctrl+Z)`
                  : "Undo (Ctrl+Z)"
              }
              disabled={!canUndo}
              onClick={undo}
            />
            <EditHistoryMenu
              entries={history.stack}
              index={history.index}
              onJump={(index) => dispatch({ type: "JUMP_TO_HISTORY", index })}
              align="start"
              testId="button-trace-history"
            />
            <IconButton
              icon={Redo2}
              label={
                canRedo
                  ? `Redo ${history.stack[history.index + 1].label} (Ctrl+Shift+Z)`
                  : "Redo (Ctrl+Shift+Z)"
              }
              disabled={!canRedo}
              onClick={redo}
            />
          </CanvasToolbar>

          {editHost && editingOutline && createPortal(curveEditor.controls || <OutlinePointPanel
            tool={pointTool} mobile={isMobile} canErase={!isMobile && !curveEditor.active && !!selection}
            contour={contourLabel} onToolChange={changePointTool} onDone={finishOutlineEdit}
            advanced={<>
              {!isMobile && deletePointAction}
              {curveEditor.startButton}
              {curveEditor.startButton && (store.margin ?? 0) !== 0 && <p className="w-full text-xs text-muted-foreground">Set trace margin to zero to bend edges.</p>}
            </>}>
            {isMobile && deletePointAction}
            {(pointTool === "select" || editorPoints.selection.length > 1) && editorPoints.selectionActions}
            {curveEditor.basicPoints && curveEditor.error && <p role="alert" className="text-xs text-destructive">{curveEditor.error}</p>}
          </OutlinePointPanel>, editHost)}
          {cleanup.open && <div className="absolute bottom-16 left-2 right-2 z-30 md:right-auto" data-testid="outline-cleanup-panel">
            <div className="max-h-[60vh] w-full overflow-y-auto rounded-xl border bg-background p-4 shadow-lg md:w-[23rem]" role="region" aria-label="Smooth outline preview">{cleanup.controls}</div>
          </div>}

          <CanvasToolbar position="bottom-right">
            <IconButton
              icon={ZoomOut}
              label="Zoom out (-)"
              onClick={() => viewport.zoomBy(1 / 1.2)}
            />
            <button
              type="button"
              onClick={viewport.resetZoom}
              className="hidden min-h-11 min-w-14 rounded px-2 py-1 text-xs md:block md:min-h-0 [@media(pointer:coarse)]:min-h-11 tabular-nums hover:bg-accent"
              title="Reset to 100% (1)"
            >
              {Math.round(viewport.transform.scale * 100)}%
            </button>
            <IconButton
              icon={ZoomIn}
              label="Zoom in (+)"
              onClick={() => viewport.zoomBy(1.2)}
            />
            <IconButton icon={Maximize2} label="Fit to screen (0)" onClick={fitVisiblePhoto} />
          </CanvasToolbar>

          <CanvasToolbar position="bottom-left" className="max-w-[calc(100%-13rem)] max-md:hidden">
            <span className="px-1.5 text-[11px] tabular-nums text-muted-foreground">
              {imageSize.width} × {imageSize.height} px
              {outline.length > 0 && (
                <>
                  {" · "}
                  {outline.length} shape{outline.length === 1 ? "" : "s"}
                </>
              )}
            </span>
            <span className={cn("hidden border-l pl-2 pr-1.5 text-[11px] text-muted-foreground", !correctionMode && !editingOutline && "md:inline")}>
              {mode === "measure"
                ? !measurement
                  ? "Click the first measurement point"
                  : measurement.end
                    ? "Click to start a new measurement"
                    : "Click the second measurement point"
                : mode === "pan"
                    ? "Click a contour to select · Empty space clears selection · Shift-drag pans"
                    : "Shift-drag pans · Ctrl-scroll zooms"}
            </span>
          </CanvasToolbar>

          {/*
            A small badge rather than an overlay that replaces the scene. The
            outline used to disappear entirely on every reprocess, which also
            meant an export started mid-process silently lost the ruler.
          */}
          {processing && (
            <div className="absolute left-1/2 top-32 md:top-14 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-background/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Tracing…
            </div>
          )}
        </>
      )}
    </>
  );
}

function ModeButton({
  mode,
  icon: Icon,
  label,
  disabled = false,
  onSelect,
}: {
  mode: TraceMode;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  disabled?: boolean;
  onSelect?: () => void;
}): JSX.Element {
  const trace = useTrace();
  const { mode: current, dispatch } = trace;
  const active = current === mode || (mode === "edit" && current === "remove");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active ? "secondary" : "ghost"}
          size="icon"
          className={cn("h-11 w-11 md:h-9 md:w-9 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11", active && "ring-1 ring-primary/40")}
          aria-pressed={active}
          aria-label={label}
          disabled={disabled}
          onClick={(event) => {
            // A pointer-selected tool should leave Space available for panning;
            // keyboard activation keeps focus for normal button access.
            if (event.detail > 0) event.currentTarget.blur();
            if (hasPendingManualCalibration(trace) && mode !== "calibrate") dispatch({ type: "CANCEL_MANUAL_CALIBRATION" });
            dispatch({ type: "SET_MODE", mode }); onSelect?.();
          }}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 md:h-9 md:w-9 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Rectangle from two corners, clamped to the image. */
function rectFromPoints(
  a: Point,
  b: Point,
  bounds: { x?: number; y?: number; width: number; height: number },
): Rect {
  const left = bounds.x ?? 0;
  const top = bounds.y ?? 0;
  const x = Math.max(left, Math.min(a.x, b.x));
  const y = Math.max(top, Math.min(a.y, b.y));
  const right = Math.min(left + bounds.width, Math.max(a.x, b.x));
  const bottom = Math.min(top + bounds.height, Math.max(a.y, b.y));
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

function clampPointToImage(
  point: Point,
  bounds: { width: number; height: number },
): Point {
  return {
    x: Math.max(0, Math.min(Math.max(0, bounds.width - 1), point.x)),
    y: Math.max(0, Math.min(Math.max(0, bounds.height - 1), point.y)),
  };
}

interface ShortcutHandlers {
  fit: () => void;
  resetZoom: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  undo: () => void;
  redo: () => void;
  escape: () => void;
}

/**
 * Canvas keyboard shortcuts.
 *
 * Active only while the canvas owns keyboard input. Dialogs and controls keep
 * their own text editing, navigation, and activation commands.
 */
function useCanvasShortcuts(handlers: ShortcutHandlers): void {
  const [state] = useState(() => ({ handlers }));
  state.handlers = handlers;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!canHandleCanvasShortcut(event) || event.altKey) return;

      const meta = event.ctrlKey || event.metaKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) state.handlers.redo();
        else state.handlers.undo();
        return;
      }
      if (meta && event.key.toLowerCase() === "y") {
        event.preventDefault();
        state.handlers.redo();
        return;
      }
      if (meta) return;

      switch (event.key) {
        case "Escape":
          event.preventDefault();
          state.handlers.escape();
          break;
        case "0":
          event.preventDefault();
          state.handlers.fit();
          break;
        case "1":
          event.preventDefault();
          state.handlers.resetZoom();
          break;
        case "+":
        case "=":
          event.preventDefault();
          state.handlers.zoomIn();
          break;
        case "-":
          event.preventDefault();
          state.handlers.zoomOut();
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state]);
}
