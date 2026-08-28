import {
  Crop,
  Loader2,
  Maximize2,
  MousePointer2,
  Redo2,
  Ruler,
  Spline,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  calibrationFromDraft,
  hasCalibrationEndpoints,
} from "@shared/geometry/scale";
import type { Point, Rect, RingRef } from "@shared/geometry/types";

import {
  CanvasViewport,
  useCanvasViewportSize,
} from "@/components/canvas/canvas-viewport";
import { CanvasToolbar } from "@/components/layout/canvas-toolbar";
import { EditHistoryMenu } from "@/components/history/edit-history-menu";
import { useViewportTransform } from "@/hooks/use-viewport-transform";
import { nearestEdge, nearestVertex } from "@/lib/geometry/hit-test";
import { getRing, sameRingRef, setRing } from "@/lib/geometry/outline";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTrace, type TraceMode } from "@/state/trace-store";

import { TraceScene } from "./trace-scene";

/** Grab radius in *screen* pixels; divided by scale at use. */
const PICK_RADIUS_PX = 10;

export interface TraceCanvasProps {
  onReprocess: () => void;
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
  return (
    <CanvasViewport>
      {/*
        Scene and floating toolbars both live in `children` rather than being
        split across the `overlays` slot, because both need the same viewport
        transform and it is owned by the stage. `CanvasViewport` renders its
        children into a full-size `absolute inset-0` layer, so the toolbars'
        corner offsets resolve against exactly the same box either way.
      */}
      <TraceStage {...props} />
    </CanvasViewport>
  );
}

function TraceStage({ onReprocess, emptyState }: TraceCanvasProps): JSX.Element {
  const store = useTrace();
  const {
    imageUrl,
    imageSize,
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
  const displayedCalibration =
    pendingAutoCalibration ?? (calibrationSource === "manual" ? calibration : null);
  const perspectiveOverlayPoints =
    manualPerspectivePoints.length > 0
      ? manualPerspectivePoints
      : (pendingPerspective?.points ?? []);
  const rulerEditable =
    (calibrationSource === "manual" && calibration !== null) ||
    (mode !== "calibrate" && hasCalibrationEndpoints(draftCalibration));

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

  // Plain drags never pan: panning is Shift-drag, Space-drag or middle-drag
  // (all still handled by the viewport hook in every mode), which frees the
  // plain click for contour editing and the cursor for a normal arrow.
  const viewport = useViewportTransform({
    contentWidth: imageSize.width,
    contentHeight: imageSize.height,
    containerWidth: containerSize.width,
    containerHeight: containerSize.height,
    panEnabled: false,
  });

  // Mirrors the hook's space tracking so the cursor can promise a pan before
  // the drag starts.
  const [shiftHeld, setShiftHeld] = useState(false);
  const [rulerPointer, setRulerPointer] = useState<Point | null>(null);
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

  // What the current drag is doing, if anything.
  const dragRef = useRef<
    | { kind: "region"; origin: Point }
    | { kind: "vertex"; ref: RingRef; index: number }
    | { kind: "ruler"; end: "start" | "end" }
    | { kind: "perspective"; index: number }
    | null
  >(null);

  // A candidate click-to-add in select mode: armed on pointer down, disarmed
  // by movement, executed on pointer up. The threshold separates a click from
  // the start of a (failed) drag.
  const clickRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const CLICK_SLOP_PX = 4;

  /**
   * The vertex currently under the cursor, on the selected ring. Feedback
   * before commitment: the scene enlarges and fills this handle, and the
   * cursor switches to "move" — so a click that would *miss* the handle (and
   * therefore add a point) is visible as a miss before the button goes down.
   */
  const [hoveredVertexIndex, setHoveredVertexIndex] = useState<number | null>(null);

  const updateHover = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const editable =
      selection !== null && (mode === "edit" || mode === "pan") && !viewport.isPanning;
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
   * - a click anywhere else adds a vertex to the selected ring, joined at its
   *   nearest edge so the outline reaches out to the clicked point.
   */
  const handleContourClick = (image: Point): boolean => {
    if (!selection) return false;

    if (nearestVertex(outline, image, pickRadius, selection)) return true;

    const other = nearestEdge(outline, image, pickRadius * 4);
    if (other && !sameRingRef(other.ref, selection)) {
      dispatch({ type: "SELECT_RING", selection: other.ref });
      return true;
    }

    const edge = nearestEdge(outline, image, Number.POSITIVE_INFINITY, selection);
    if (!edge) return true;
    const ring = getRing(outline, edge.ref);
    if (!ring) return true;
    const next = [...ring];
    next.splice(edge.insertIndex, 0, image);
    dispatch({
      type: "OUTLINE_COMMITTED",
      outline: setRing(outline, edge.ref, next),
      label: "Add contour node",
    });
    return true;
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const image = toImage(event.clientX, event.clientY);
    if (!image) return;

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
    if (displayedCalibration && mode !== "perspective") {
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
      dragRef.current = { kind: "region", origin: image };
      dispatch({
        type: "SET_REGION",
        region: { x: image.x, y: image.y, width: 0, height: 0 },
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

    if (mode === "edit" && event.button === 0 && !event.shiftKey) {
      const vertex = nearestVertex(outline, image, pickRadius, selection);
      if (vertex) {
        dragRef.current = { kind: "vertex", ref: vertex.ref, index: vertex.index };
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

    // Select mode with a contour selected: a drag starting on a vertex handle
    // relocates that vertex, and a plain click (not a Shift/Space pan) edits
    // the contour on release.
    if (
      mode === "pan" &&
      event.button === 0 &&
      !event.shiftKey &&
      !viewport.isSpaceHeld &&
      selection
    ) {
      const vertex = nearestVertex(outline, image, pickRadius, selection);
      if (vertex) {
        dragRef.current = { kind: "vertex", ref: vertex.ref, index: vertex.index };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      clickRef.current = { clientX: event.clientX, clientY: event.clientY };
    }

    viewport.handlers.onPointerDown(event);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
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
      updateHover(event);
      viewport.handlers.onPointerMove(event);
      return;
    }

    const image = toImage(event.clientX, event.clientY);
    if (!image) return;

    if (drag.kind === "region") {
      dispatch({
        type: "SET_REGION",
        region: rectFromPoints(drag.origin, image, imageSize),
      });
      return;
    }

    if (drag.kind === "ruler" && displayedCalibration) {
      dispatch({
        type: "SET_CALIBRATION",
        calibration:
          drag.end === "start"
            ? { ...displayedCalibration, startX: image.x, startY: image.y }
            : { ...displayedCalibration, endX: image.x, endY: image.y },
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
      const ring = getRing(outline, drag.ref);
      if (!ring) return;
      const next = [...ring];
      next[drag.index] = image;
      // Preview only. Pointer-up commits the final outline once, preserving
      // the pre-drag snapshot as the state Undo must restore.
      dispatch({
        type: "OUTLINE_DRAGGING",
        outline: setRing(outline, drag.ref, next),
      });
    }
  };

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;

    const click = clickRef.current;
    clickRef.current = null;

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!drag) {
      // A click that survived without becoming a drag edits the contour.
      if (click && event.button === 0) {
        const image = toImage(event.clientX, event.clientY);
        if (image && handleContourClick(image)) return;
      }
      viewport.handlers.onPointerUp(event);
      return;
    }

    if (drag.kind === "region") {
      // A stray click should not commit a degenerate crop.
      if (region && region.width > 5 && region.height > 5) {
        dispatch({ type: "REGION_COMMITTED" });
        onReprocess();
        // Framing what was just cropped is the whole point of cropping.
        viewport.fitToRect(region);
      } else {
        dispatch({ type: "SET_REGION", region: null });
      }
      return;
    }

    // The drag is finished, so its result becomes one undo entry.
    if (drag.kind === "vertex") {
      dispatch({
        type: "OUTLINE_COMMITTED",
        outline,
        label: "Move contour node",
      });
    }
  };

  const handleContextMenu = (event: React.MouseEvent<SVGSVGElement>) => {
    // Right-click removes a vertex wherever its handle is visible: always in
    // edit mode, and in pan mode while a contour is selected for viewing from
    // the contour list in Tool Detection. Region/calibrate keep the browser menu.
    const viewingContour = mode === "pan" && selection !== null;
    if (mode !== "edit" && !viewingContour) return;
    if (mode === "edit") event.preventDefault();

    const image = toImage(event.clientX, event.clientY);
    if (!image) return;

    const vertex = nearestVertex(outline, image, pickRadius, selection);
    if (!vertex) return;
    // In pan mode the menu is only hijacked when a vertex is actually hit.
    event.preventDefault();

    const ring = getRing(outline, vertex.ref);
    // A ring needs three points to enclose anything.
    if (!ring || ring.length <= 3) return;

    const next = ring.filter((_, i) => i !== vertex.index);
    dispatch({
      type: "OUTLINE_COMMITTED",
      outline: setRing(outline, vertex.ref, next),
      label: "Remove contour node",
    });
  };

  useCanvasShortcuts({
    fit: viewport.fit,
    resetZoom: viewport.resetZoom,
    zoomIn: () => viewport.zoomBy(1.2),
    zoomOut: () => viewport.zoomBy(1 / 1.2),
    undo,
    redo,
  });

  const cursor = useMemo(() => {
    if (viewport.isPanning) return "grabbing";
    // Promise the pan before the drag: Shift or Space turns the arrow into a
    // hand. Otherwise the arrow is the normal state in every pointing mode.
    if (viewport.isSpaceHeld || shiftHeld) return "grab";
    // Promise the grab before the drag, too.
    if (hoveredVertexIndex !== null) return "move";
    if (
      mode === "region" ||
      mode === "calibrate" ||
      mode === "perspective"
    ) {
      return "crosshair";
    }
    return "default";
  }, [mode, viewport.isPanning, viewport.isSpaceHeld, shiftHeld, hoveredVertexIndex]);

  // No wrapper element of its own: CanvasViewport already provides the
  // positioned, clipped, full-size box these children lay out against.
  return (
    <>
      {imageUrl && imageSize.width > 0 ? (
        <TraceScene
          svgRef={svgRef}
          sceneRef={sceneRef}
          imageUrl={imageUrl}
          imageSize={imageSize}
          transform={viewport.transform}
          outline={outline}
          selection={selection}
          region={region}
          regionActive={mode === "region"}
          calibration={
            mode === "perspective"
              ? null
              : mode === "calibrate" && draftCalibration?.startX !== undefined
              ? null
              : displayedCalibration
          }
          draftCalibration={
            mode === "calibrate" &&
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
          perspectivePoints={perspectiveOverlayPoints}
          perspectiveEditable={manualPerspectivePoints.length > 0}
          perspectivePreview={perspectivePointer}
          busy={processing}
          cursor={cursor}
          hoveredVertexIndex={hoveredVertexIndex}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={() => {
            setHoveredVertexIndex(null);
            setPerspectivePointer(null);
          }}
          onContextMenu={handleContextMenu}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center p-8">
          {emptyState}
        </div>
      )}

      {imageUrl && (
        <>
          <CanvasToolbar position="top-left">
            <ModeButton mode="pan" icon={MousePointer2} label="Select" />
            <ModeButton mode="region" icon={Crop} label="Region" />
            <ModeButton mode="edit" icon={Spline} label="Edit points" />
            <ModeButton mode="calibrate" icon={Ruler} label="Set scale" />

            {/* Always present: outline edits can happen in any pointing mode,
                and a hidden undo reads as "there is no undo". */}
            <div className="mx-1 h-5 w-px bg-border" />
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

          <CanvasToolbar position="top-right">
            <IconButton
              icon={ZoomOut}
              label="Zoom out (-)"
              onClick={() => viewport.zoomBy(1 / 1.2)}
            />
            <button
              type="button"
              onClick={viewport.resetZoom}
              className="min-w-14 rounded px-2 py-1 text-xs tabular-nums hover:bg-accent"
              title="Reset to 100% (1)"
            >
              {Math.round(viewport.transform.scale * 100)}%
            </button>
            <IconButton
              icon={ZoomIn}
              label="Zoom in (+)"
              onClick={() => viewport.zoomBy(1.2)}
            />
            <IconButton icon={Maximize2} label="Fit to screen (0)" onClick={viewport.fit} />
          </CanvasToolbar>

          <CanvasToolbar position="bottom-left">
            <span className="px-1.5 text-[11px] tabular-nums text-muted-foreground">
              {imageSize.width} × {imageSize.height} px
              {outline.length > 0 && (
                <>
                  {" · "}
                  {outline.length} shape{outline.length === 1 ? "" : "s"}
                </>
              )}
            </span>
            <span className="hidden border-l pl-2 pr-1.5 text-[11px] text-muted-foreground md:inline">
              {selection
                ? "Drag points to move · Click adds · Right-click removes · Shift-drag pans"
                : "Shift-drag pans · Ctrl-scroll zooms"}
            </span>
          </CanvasToolbar>

          {/*
            A small badge rather than an overlay that replaces the scene. The
            outline used to disappear entirely on every reprocess, which also
            meant an export started mid-process silently lost the ruler.
          */}
          {processing && (
            <div className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-background/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur">
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
}: {
  mode: TraceMode;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}): JSX.Element {
  const { mode: current, dispatch } = useTrace();
  const active = current === mode;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active ? "secondary" : "ghost"}
          size="icon"
          className={cn("h-8 w-8", active && "ring-1 ring-primary/40")}
          aria-pressed={active}
          aria-label={label}
          onClick={() => dispatch({ type: "SET_MODE", mode })}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
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
          className="h-8 w-8"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Rectangle from two corners, clamped to the image. */
function rectFromPoints(
  a: Point,
  b: Point,
  bounds: { width: number; height: number },
): Rect {
  const x = Math.max(0, Math.min(a.x, b.x));
  const y = Math.max(0, Math.min(a.y, b.y));
  const right = Math.min(bounds.width, Math.max(a.x, b.x));
  const bottom = Math.min(bounds.height, Math.max(a.y, b.y));
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
}

/**
 * Canvas keyboard shortcuts.
 *
 * Suppressed while focus is in a text field — the ruler-length input would
 * otherwise swallow "0" and "1" as zoom commands.
 */
function useCanvasShortcuts(handlers: ShortcutHandlers): void {
  const [state] = useState(() => ({ handlers }));
  state.handlers = handlers;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      const meta = event.ctrlKey || event.metaKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) state.handlers.redo();
        else state.handlers.undo();
        return;
      }
      if (meta) return;

      switch (event.key) {
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
