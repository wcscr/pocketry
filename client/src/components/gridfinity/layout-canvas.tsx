import {
  Ruler,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  binToCanvas,
  canvasToBin,
  placementFootprint,
  transformPointPlacement,
  untransformPointPlacement,
  type CutoutPlacement,
  type TracedShape,
} from "@shared/gridfinity/cutout";
import {
  binFootprintMm,
  D_WALL,
  gridPitchMm,
  R_F2,
} from "@shared/gridfinity/standard";
import {
  OUTER_RING,
  type Outline,
  type Point,
  type Ring,
  type RingRef,
} from "@shared/geometry/types";
import { validateLayout, type IssueSeverity } from "@shared/gridfinity/validate";

import {
  CanvasViewport,
  useCanvasViewportSize,
} from "@/components/canvas/canvas-viewport";
import { Button } from "@/components/ui/button";
import { useViewportTransform } from "@/hooks/use-viewport-transform";
import { pointInOutline } from "@/lib/geometry/outline";
import {
  contourRing,
  insertContourPoint,
  moveContourPoint,
  removeContourPoint,
  reviseTracedShape,
} from "@/lib/gridfinity/contour-edit";
import {
  measurementDistanceMm,
  snapToToolContour,
} from "@/lib/gridfinity/layout-measure";
import { cn } from "@/lib/utils";
import { useBin } from "@/state/bin-store";
import { useShapeLibrary } from "@/state/shape-library";

/**
 * The top-down 2D placement editor: bin footprint in millimetres (y-down SVG
 * view of the y-up bin frame — the flip lives entirely in binToCanvas /
 * canvasToBin), with the trace canvas's interaction grammar: plain drag on a
 * cutout moves it, the handle above the selection rotates it, plain click
 * selects, Shift/Space/middle-drag pans, wheel zooms.
 *
 * All pointer math converts through canvasToBin *first*, so angles and
 * positions are computed in model space; the visual sense of rotation on the
 * flipped view is handled at the keyboard mapping (R = visually clockwise =
 * model +15°).
 */

const PICK_RADIUS_PX = 8;
const SNAP_TOLERANCE_PX = 8;
const ROTATE_HANDLE_OFFSET_PX = 24;
const ROTATE_SNAP_DEG = 15;
const ROTATE_SNAP_WITHIN_DEG = 3;
const CLICK_SLOP_PX = 4;
const RULER_SNAP_TOLERANCE_PX = 14;
/** Circular-arrow pointer, with `grab` as the browser fallback. */
const ROTATE_CURSOR = 'url("/cursors/rotate.svg") 16 16, grab';

function contourHandle(target: Element):
  | { cutoutId: string; ref: RingRef; index: number }
  | null {
  const cutoutId = target.getAttribute("data-contour-of");
  const shapeIndex = Number(target.getAttribute("data-contour-shape"));
  const ringIndex = Number(target.getAttribute("data-contour-ring"));
  const index = Number(target.getAttribute("data-contour-point"));
  if (
    !cutoutId ||
    !Number.isInteger(shapeIndex) ||
    !Number.isInteger(ringIndex) ||
    !Number.isInteger(index)
  ) {
    return null;
  }
  return { cutoutId, ref: { shapeIndex, ringIndex }, index };
}

function pointSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq),
  );
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function nearestContourEdge(
  outline: Outline,
  point: Point,
  tolerance: number,
): { ref: RingRef; afterIndex: number } | null {
  let best: { ref: RingRef; afterIndex: number; distance: number } | null = null;
  outline.forEach((shape, shapeIndex) => {
    const rings = [
      { ring: shape.outer, ringIndex: OUTER_RING },
      ...shape.holes.map((ring, ringIndex) => ({ ring, ringIndex })),
    ];
    for (const { ring, ringIndex } of rings) {
      for (let index = 0; index < ring.length; index++) {
        const distance = pointSegmentDistance(
          point,
          ring[index],
          ring[(index + 1) % ring.length],
        );
        if (distance <= tolerance && (!best || distance < best.distance)) {
          best = { ref: { shapeIndex, ringIndex }, afterIndex: index, distance };
        }
      }
    }
  });
  return best;
}

export function LayoutCanvas(): JSX.Element {
  return (
    <CanvasViewport>
      <LayoutStage />
    </CanvasViewport>
  );
}

function LayoutStage(): JSX.Element {
  const { spec, cutouts, selectedCutoutId, editorMode, dispatch } = useBin();
  const { shapes, storeShape } = useShapeLibrary();
  const shapesById = useMemo(
    () => new Map(shapes.map((shape) => [shape.id, shape])),
    [shapes],
  );

  const pitchMm = gridPitchMm(spec.gridPitch);
  const widthMm = binFootprintMm(spec.gridX, spec.gridPitch);
  const lengthMm = binFootprintMm(spec.gridY, spec.gridPitch);

  const containerSize = useCanvasViewportSize();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const sceneRef = useRef<SVGGElement | null>(null);

  const viewport = useViewportTransform({
    contentWidth: widthMm,
    contentHeight: lengthMm,
    containerWidth: containerSize.width,
    containerHeight: containerSize.height,
    panEnabled: false,
  });

  useEffect(() => {
    viewport.attachWheel(svgRef.current);
    return () => viewport.attachWheel(null);
  }, [viewport]);

  /** Screen client px → bin-frame mm. */
  const toBin = (clientX: number, clientY: number): Point | null => {
    const svg = svgRef.current;
    const scene = sceneRef.current;
    if (!svg || !scene) return null;
    const ctm = scene.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return canvasToBin({ x: local.x, y: local.y }, spec);
  };

  const scale = viewport.transform.scale;
  const pickRadius = PICK_RADIUS_PX / Math.max(scale, 1e-6);

  const [draftContour, setDraftContourState] = useState<{
    cutoutId: string;
    shapeId: string;
    outline: Outline;
  } | null>(null);
  const draftContourRef = useRef(draftContour);
  const setDraftContour = (next: typeof draftContour) => {
    draftContourRef.current = next;
    setDraftContourState(next);
  };

  useEffect(() => {
    if (
      editorMode !== "contour" ||
      (draftContour && draftContour.cutoutId !== selectedCutoutId)
    ) {
      setDraftContour(null);
    }
    // The state setter is intentionally local; selection/mode are the reset
    // boundaries for a gesture draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorMode, selectedCutoutId]);

  // Transformed outlines + feature handles + per-cutout worst severity,
  // recomputed per change — pure math over ≤150-point rings, cheap enough
  // per drag frame.
  const placed = useMemo(
    () =>
      cutouts.flatMap((cutout) => {
        const storedShape = shapesById.get(cutout.shapeId);
        if (!storedShape) return [];
        const shape =
          draftContour?.cutoutId === cutout.id &&
          draftContour.shapeId === storedShape.id
            ? { ...storedShape, outlineMm: draftContour.outline }
            : storedShape;
        const footprint = placementFootprint(shape, cutout);
        const features = cutout.fingerHoles.map((hole) => ({
          kind: hole.kind,
          id: hole.id,
          center: transformPointPlacement(hole.center, cutout),
          radius: hole.diameterMm / 2,
        }));
        return [{ cutout, shape, outline: footprint.outline, features }];
      }),
    [cutouts, shapesById, draftContour],
  );

  const severityByCutout = useMemo(() => {
    const map = new Map<string, IssueSeverity>();
    for (const issue of validateLayout(spec, cutouts, shapesById)) {
      for (const id of issue.cutoutIds ?? []) {
        if (issue.severity === "error" || !map.has(id)) map.set(id, issue.severity);
      }
    }
    return map;
  }, [spec, cutouts, shapesById]);

  const selected = placed.find((p) => p.cutout.id === selectedCutoutId) ?? null;

  const commitContour = (
    cutoutId: string,
    sourceShape: TracedShape,
    outline: Outline,
    historyLabel: string,
  ) => {
    const revision = reviseTracedShape(sourceShape, outline, crypto.randomUUID());
    if (revision === sourceShape) return;
    storeShape(revision);
    dispatch({
      type: "UPDATE_CUTOUT",
      id: cutoutId,
      patch: { shapeId: revision.id },
      historyLabel,
    });
    setDraftContour(null);
  };

  // --- interactions -------------------------------------------------------

  const dragRef = useRef<
    | { kind: "move"; id: string; grabOffset: Point }
    | { kind: "rotate"; id: string; center: Point; startPointerDeg: number; startRotationDeg: number }
    | {
        kind: "feature";
        id: string;
        feature: { kind: "straight" | "scoop"; id: string };
        grabOffset: Point;
      }
    | {
        kind: "contour";
        id: string;
        shapeId: string;
        ref: RingRef;
        index: number;
        operation: "add" | "move";
      }
    | null
  >(null);
  const clickRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const [isRotating, setIsRotating] = useState(false);
  const [rulerActive, setRulerActive] = useState(false);
  const [measurementPoints, setMeasurementPoints] = useState<Point[]>([]);
  const hasPlacedCutouts = placed.length > 0;

  useEffect(() => {
    if (hasPlacedCutouts) return;
    setRulerActive(false);
    setMeasurementPoints([]);
  }, [hasPlacedCutouts]);

  const hitCutout = (point: Point): CutoutPlacement | null => {
    // Topmost = later in the list; feature circles count as their pocket.
    for (let i = placed.length - 1; i >= 0; i--) {
      if (pointInOutline(placed[i].outline, point)) return placed[i].cutout;
      for (const feature of placed[i].features) {
        if (Math.hypot(point.x - feature.center.x, point.y - feature.center.y) <= feature.radius) {
          return placed[i].cutout;
        }
      }
    }
    return null;
  };

  /**
   * Re-dispatches the dragged value once without `transient`, so the whole
   * gesture lands in history as a single undo step.
   */
  const commitDrag = (drag: NonNullable<typeof dragRef.current>) => {
    const current = cutouts.find((cutout) => cutout.id === drag.id);
    if (!current) return;
    if (drag.kind === "move") {
      dispatch({
        type: "UPDATE_CUTOUT",
        id: current.id,
        patch: { position: current.position },
        historyLabel: "Move tool pocket",
      });
    } else if (drag.kind === "rotate") {
      dispatch({
        type: "UPDATE_CUTOUT",
        id: current.id,
        patch: { rotationDeg: current.rotationDeg },
        historyLabel: "Rotate tool pocket",
      });
    } else if (drag.kind === "feature") {
      dispatch({
        type: "UPDATE_CUTOUT",
        id: current.id,
        patch: { fingerHoles: current.fingerHoles },
        historyLabel: "Move finger hole",
      });
    }
  };

  const snapAxis = (value: number, candidates: number[], tolerance: number): number => {
    let best = value;
    let bestDistance = tolerance;
    for (const candidate of candidates) {
      const d = Math.abs(value - candidate);
      if (d < bestDistance) {
        best = candidate;
        bestDistance = d;
      }
    }
    return best;
  };

  /** Snap targets: bin centre, cell centres, cell boundaries. */
  const snapTargets = (cells: number): number[] => {
    const targets = [0];
    for (let i = 0; i < cells; i++) {
      targets.push((i - (cells - 1) / 2) * pitchMm);
      if (i < cells - 1) {
        targets.push((i - (cells - 1) / 2) * pitchMm + pitchMm / 2);
      }
    }
    return targets;
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || event.shiftKey || viewport.isSpaceHeld) {
      viewport.handlers.onPointerDown(event);
      return;
    }
    const point = toBin(event.clientX, event.clientY);
    if (!point) return;

    if (rulerActive) {
      const snapped = snapToToolContour(
        point,
        placed.map((item) => item.outline),
        RULER_SNAP_TOLERANCE_PX / Math.max(scale, 1e-6),
      );
      if (snapped) {
        setMeasurementPoints((current) =>
          current.length < 2 ? [...current, snapped.point] : [snapped.point],
        );
      }
      event.preventDefault();
      return;
    }

    const target = event.target as Element;
    if (editorMode === "contour") {
      const handle = contourHandle(target);
      if (handle && selected && handle.cutoutId === selected.cutout.id) {
        const sourceShape = shapesById.get(selected.cutout.shapeId);
        if (!sourceShape) return;
        const draft = {
          cutoutId: selected.cutout.id,
          shapeId: sourceShape.id,
          outline: sourceShape.outlineMm,
        };
        setDraftContour(draft);
        dragRef.current = {
          kind: "contour",
          id: selected.cutout.id,
          shapeId: sourceShape.id,
          ref: handle.ref,
          index: handle.index,
          operation: "move",
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }

      if (selected && target.getAttribute("data-cutout-id") === selected.cutout.id) {
        const sourceShape = shapesById.get(selected.cutout.shapeId);
        if (!sourceShape) return;
        const local = untransformPointPlacement(point, selected.cutout);
        const edge = nearestContourEdge(
          sourceShape.outlineMm,
          local,
          pickRadius * 1.5,
        );
        if (edge) {
          const outline = insertContourPoint(
            sourceShape.outlineMm,
            edge.ref,
            edge.afterIndex,
            local,
          );
          const draft = {
            cutoutId: selected.cutout.id,
            shapeId: sourceShape.id,
            outline,
          };
          setDraftContour(draft);
          dragRef.current = {
            kind: "contour",
            id: selected.cutout.id,
            shapeId: sourceShape.id,
            ref: edge.ref,
            index: edge.afterIndex + 1,
            operation: "add",
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        return;
      }

      const hit = hitCutout(point);
      if (hit) dispatch({ type: "SELECT_CUTOUT", id: hit.id });
      else viewport.handlers.onPointerDown(event);
      return;
    }

    if (target.getAttribute?.("data-rotate-handle") && selected) {
      const center = selected.cutout.position;
      dragRef.current = {
        kind: "rotate",
        id: selected.cutout.id,
        center,
        startPointerDeg:
          (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI,
        startRotationDeg: selected.cutout.rotationDeg,
      };
      setIsRotating(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    // Feature circles of the selected pocket grab before the body does, so
    // a hole overlapping its own outline stays draggable.
    if (selected) {
      for (const feature of selected.features) {
        if (
          Math.hypot(point.x - feature.center.x, point.y - feature.center.y) <=
          feature.radius + pickRadius / 2
        ) {
          dragRef.current = {
            kind: "feature",
            id: selected.cutout.id,
            feature: { kind: feature.kind, id: feature.id },
            grabOffset: { x: point.x - feature.center.x, y: point.y - feature.center.y },
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          return;
        }
      }
    }

    const hit = hitCutout(point);
    if (hit) {
      dispatch({ type: "SELECT_CUTOUT", id: hit.id });
      dragRef.current = {
        kind: "move",
        id: hit.id,
        grabOffset: { x: point.x - hit.position.x, y: point.y - hit.position.y },
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    clickRef.current = { clientX: event.clientX, clientY: event.clientY };
    viewport.handlers.onPointerDown(event);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
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
      if (rulerActive && !viewport.isPanning) return;
      viewport.handlers.onPointerMove(event);
      return;
    }
    const point = toBin(event.clientX, event.clientY);
    if (!point) return;

    if (drag.kind === "contour") {
      const current = cutouts.find((cutout) => cutout.id === drag.id);
      const draft = draftContourRef.current;
      if (!current || !draft || draft.shapeId !== drag.shapeId) return;
      const local = untransformPointPlacement(point, current);
      setDraftContour({
        ...draft,
        outline: moveContourPoint(draft.outline, drag.ref, drag.index, local),
      });
      return;
    }

    if (drag.kind === "move") {
      let x = point.x - drag.grabOffset.x;
      let y = point.y - drag.grabOffset.y;
      if (!event.altKey) {
        const tolerance = SNAP_TOLERANCE_PX / Math.max(scale, 1e-6);
        x = snapAxis(x, snapTargets(spec.gridX), tolerance);
        y = snapAxis(y, snapTargets(spec.gridY), tolerance);
      }
      dispatch({
        type: "UPDATE_CUTOUT",
        id: drag.id,
        patch: { position: { x, y } },
        transient: true,
      });
      return;
    }

    if (drag.kind === "feature") {
      const current = cutouts.find((cutout) => cutout.id === drag.id);
      if (!current) return;
      const centreBin = {
        x: point.x - drag.grabOffset.x,
        y: point.y - drag.grabOffset.y,
      };
      // Feature centres are stored shape-local so they ride the placement.
      const local = untransformPointPlacement(centreBin, current);
      dispatch({
        type: "UPDATE_CUTOUT",
        id: drag.id,
        patch: {
          fingerHoles: current.fingerHoles.map((hole) =>
            hole.id === drag.feature.id ? { ...hole, center: local } : hole,
          ),
        },
        transient: true,
      });
      return;
    }

    const pointerDeg =
      (Math.atan2(point.y - drag.center.y, point.x - drag.center.x) * 180) / Math.PI;
    let rotation = drag.startRotationDeg + pointerDeg - drag.startPointerDeg;
    if (!event.altKey) {
      const nearest = Math.round(rotation / ROTATE_SNAP_DEG) * ROTATE_SNAP_DEG;
      if (Math.abs(nearest - rotation) <= ROTATE_SNAP_WITHIN_DEG) rotation = nearest;
    }
    dispatch({
      type: "UPDATE_CUTOUT",
      id: drag.id,
      patch: { rotationDeg: ((rotation % 360) + 360) % 360 },
      transient: true,
    });
  };

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setIsRotating(false);
    const click = clickRef.current;
    clickRef.current = null;

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!drag) {
      if (rulerActive && !viewport.isPanning) return;
      if (click && event.button === 0) {
        const point = toBin(event.clientX, event.clientY);
        dispatch({
          type: "SELECT_CUTOUT",
          id: point ? (hitCutout(point)?.id ?? null) : null,
        });
      }
      viewport.handlers.onPointerUp(event);
      return;
    }
    if (drag.kind === "contour") {
      const sourceShape = shapesById.get(drag.shapeId);
      const draft = draftContourRef.current;
      if (sourceShape && draft?.shapeId === drag.shapeId) {
        commitContour(
          drag.id,
          sourceShape,
          draft.outline,
          drag.operation === "add" ? "Add contour node" : "Move contour node",
        );
      }
      return;
    }
    // The gesture's frames were transient; one commit makes it undoable.
    commitDrag(drag);
  };

  const handleContextMenu = (event: React.MouseEvent<SVGSVGElement>) => {
    if (editorMode !== "contour" || !selected) return;
    const handle = contourHandle(event.target as Element);
    if (!handle || handle.cutoutId !== selected.cutout.id) return;
    event.preventDefault();

    const sourceShape = shapesById.get(selected.cutout.shapeId);
    const ring = sourceShape
      ? contourRing(sourceShape.outlineMm, handle.ref)
      : null;
    if (!sourceShape || !ring || ring.length <= 3) return;
    commitContour(
      selected.cutout.id,
      sourceShape,
      removeContourPoint(sourceShape.outlineMm, handle.ref, handle.index),
      "Remove contour node",
    );
  };

  // Keyboard: nudge, rotate (visually clockwise = model +deg on the flipped
  // view), delete, deselect. Window-level, guarded against text entry.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (rulerActive && event.key === "Escape") {
        setRulerActive(false);
        setMeasurementPoints([]);
        event.preventDefault();
        return;
      }
      if (editorMode === "contour") {
        if (event.key === "Escape") {
          dispatch({ type: "SET_EDITOR_MODE", editorMode: "placement" });
          event.preventDefault();
        }
        return;
      }
      if (!selectedCutoutId) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const current = cutouts.find((cutout) => cutout.id === selectedCutoutId);
      if (!current) return;

      const nudge = event.shiftKey ? 0.1 : 1;
      let handled = true;
      switch (event.key) {
        case "ArrowLeft":
          dispatch({
            type: "UPDATE_CUTOUT",
            id: current.id,
            patch: { position: { x: current.position.x - nudge, y: current.position.y } },
          });
          break;
        case "ArrowRight":
          dispatch({
            type: "UPDATE_CUTOUT",
            id: current.id,
            patch: { position: { x: current.position.x + nudge, y: current.position.y } },
          });
          break;
        case "ArrowUp":
          // Screen-up is +y in the bin frame (the view flip).
          dispatch({
            type: "UPDATE_CUTOUT",
            id: current.id,
            patch: { position: { x: current.position.x, y: current.position.y + nudge } },
          });
          break;
        case "ArrowDown":
          dispatch({
            type: "UPDATE_CUTOUT",
            id: current.id,
            patch: { position: { x: current.position.x, y: current.position.y - nudge } },
          });
          break;
        case "r":
        case "R":
          dispatch({
            type: "UPDATE_CUTOUT",
            id: current.id,
            patch: {
              rotationDeg:
                (((current.rotationDeg + (event.shiftKey ? -15 : 15)) % 360) + 360) % 360,
            },
          });
          break;
        case "Delete":
        case "Backspace":
          dispatch({ type: "REQUEST_REMOVE_CUTOUT", id: current.id });
          break;
        case "Escape":
          dispatch({ type: "SELECT_CUTOUT", id: null });
          break;
        default:
          handled = false;
      }
      if (handled) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedCutoutId, cutouts, editorMode, rulerActive, dispatch]);

  const cursor =
    rulerActive
      ? "crosshair"
      : editorMode === "contour"
      ? "crosshair"
      : isRotating
        ? ROTATE_CURSOR
        : viewport.isPanning
          ? "grabbing"
          : viewport.isSpaceHeld
            ? "grab"
            : "default";

  // --- rendering ----------------------------------------------------------

  const { translateX, translateY } = viewport.transform;
  const inv = 1 / Math.max(scale, 1e-6);
  const measuredDistanceMm =
    measurementPoints.length === 2
      ? measurementDistanceMm(measurementPoints[0], measurementPoints[1])
      : null;

  const gridLines = useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let i = 0; i < spec.gridX - 1; i++) {
      const xBin = (i - (spec.gridX - 1) / 2) * pitchMm + pitchMm / 2;
      const x = xBin + widthMm / 2;
      lines.push({ x1: x, y1: 0, x2: x, y2: lengthMm });
    }
    for (let j = 0; j < spec.gridY - 1; j++) {
      const yBin = (j - (spec.gridY - 1) / 2) * pitchMm + pitchMm / 2;
      const y = lengthMm / 2 - yBin;
      lines.push({ x1: 0, y1: y, x2: widthMm, y2: y });
    }
    return lines;
  }, [spec.gridX, spec.gridY, pitchMm, widthMm, lengthMm]);

  const selectedBox = useMemo(() => {
    if (!selected) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const shape of selected.outline) {
      for (const point of shape.outer) {
        const c = binToCanvas(point, spec);
        minX = Math.min(minX, c.x);
        minY = Math.min(minY, c.y);
        maxX = Math.max(maxX, c.x);
        maxY = Math.max(maxY, c.y);
      }
    }
    return { minX, minY, maxX, maxY };
  }, [selected, spec]);

  return (
    <>
      <svg
        ref={svgRef}
        className="absolute inset-0 block h-full w-full touch-none select-none"
        style={{ cursor }}
        data-testid="layout-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onContextMenu={handleContextMenu}
      >
        <g
          ref={sceneRef}
          transform={`translate(${translateX} ${translateY}) scale(${scale})`}
        >
          {/* Bin footprint. */}
          <rect
            x={0}
            y={0}
            width={widthMm}
            height={lengthMm}
            rx={3.75}
            className="fill-background stroke-foreground/60"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          {/* Interior boundary the pockets must respect. */}
          <rect
            x={D_WALL}
            y={D_WALL}
            width={widthMm - 2 * D_WALL}
            height={lengthMm - 2 * D_WALL}
            rx={R_F2}
            fill="none"
            className="stroke-muted-foreground/40"
            strokeWidth={1}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
          {/* 42 mm cell boundaries. */}
          {gridLines.map((line, index) => (
            <line
              key={index}
              {...line}
              className="stroke-muted-foreground/30"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {placed.map(({ cutout, outline, features }) => {
            const severity = severityByCutout.get(cutout.id);
            const isSelected = cutout.id === selectedCutoutId;
            const tone =
              severity === "error"
                ? "fill-destructive/30 stroke-destructive"
                : severity === "warning"
                  ? "fill-amber-500/25 stroke-amber-600"
                  : isSelected
                    ? "fill-primary/30 stroke-primary"
                    : "fill-primary/15 stroke-primary/60";
            return (
              <g key={cutout.id}>
                <path
                  d={outlineToCanvasPath(outline, spec)}
                  fillRule="evenodd"
                  className={tone}
                  strokeWidth={isSelected ? 2 : 1.25}
                  vectorEffect="non-scaling-stroke"
                  data-cutout-id={cutout.id}
                />
                {features.map((feature) => {
                  const centre = binToCanvas(feature.center, spec);
                  return (
                    <circle
                      key={`${cutout.id}-${feature.kind}-${feature.id}`}
                      cx={centre.x}
                      cy={centre.y}
                      r={feature.radius}
                      className={cn(
                        tone,
                        isSelected && "cursor-move",
                      )}
                      strokeWidth={isSelected ? 1.5 : 1}
                      strokeDasharray={feature.kind === "scoop" ? "3 2" : undefined}
                      vectorEffect="non-scaling-stroke"
                      data-feature-of={cutout.id}
                      data-testid={`feature-${feature.kind}-${cutout.id}`}
                    />
                  );
                })}
              </g>
            );
          })}

          {measurementPoints.length > 0 ? (
            <g className="pointer-events-none" data-testid="layout-measurement">
              {measurementPoints.length === 2 ? (
                <>
                  <line
                    x1={binToCanvas(measurementPoints[0], spec).x}
                    y1={binToCanvas(measurementPoints[0], spec).y}
                    x2={binToCanvas(measurementPoints[1], spec).x}
                    y2={binToCanvas(measurementPoints[1], spec).y}
                    className="stroke-fuchsia-600"
                    strokeWidth={2.5}
                    vectorEffect="non-scaling-stroke"
                  />
                  <text
                    x={
                      (binToCanvas(measurementPoints[0], spec).x +
                        binToCanvas(measurementPoints[1], spec).x) /
                      2
                    }
                    y={
                      (binToCanvas(measurementPoints[0], spec).y +
                        binToCanvas(measurementPoints[1], spec).y) /
                        2 -
                      8 * inv
                    }
                    textAnchor="middle"
                    fontSize={12 * inv}
                    strokeWidth={3 * inv}
                    className="fill-fuchsia-700 stroke-background font-semibold"
                    style={{ paintOrder: "stroke" }}
                    data-testid="layout-measurement-label"
                  >
                    {measuredDistanceMm!.toFixed(2)} mm
                  </text>
                </>
              ) : null}
              {measurementPoints.map((point, index) => {
                const canvasPoint = binToCanvas(point, spec);
                return (
                  <circle
                    key={index}
                    cx={canvasPoint.x}
                    cy={canvasPoint.y}
                    r={5 * inv}
                    className="fill-fuchsia-600 stroke-background"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </g>
          ) : null}

          {editorMode === "contour" &&
            selected &&
            selected.shape.outlineMm.flatMap((shape, shapeIndex) => {
              const rings = [
                { ring: shape.outer, ringIndex: OUTER_RING },
                ...shape.holes.map((ring, ringIndex) => ({ ring, ringIndex })),
              ];
              return rings.flatMap(({ ring, ringIndex }) =>
                ring.map((point, pointIndex) => {
                  const canvasPoint = binToCanvas(
                    transformPointPlacement(point, selected.cutout),
                    spec,
                  );
                  return (
                    <circle
                      key={`${shapeIndex}-${ringIndex}-${pointIndex}`}
                      cx={canvasPoint.x}
                      cy={canvasPoint.y}
                      r={4.5 * inv}
                      className="fill-background stroke-violet-600"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                      style={{ cursor: "move" }}
                      data-contour-of={selected.cutout.id}
                      data-contour-shape={shapeIndex}
                      data-contour-ring={ringIndex}
                      data-contour-point={pointIndex}
                      data-testid="contour-vertex-handle"
                    />
                  );
                }),
              );
            })}

          {editorMode !== "contour" && selectedBox && selected && (
            <g>
              <rect
                x={selectedBox.minX}
                y={selectedBox.minY}
                width={selectedBox.maxX - selectedBox.minX}
                height={selectedBox.maxY - selectedBox.minY}
                fill="none"
                className="stroke-primary/70"
                strokeWidth={1}
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
              />
              {/* Rotate handle above the box (screen offset / scale). */}
              <line
                x1={(selectedBox.minX + selectedBox.maxX) / 2}
                y1={selectedBox.minY}
                x2={(selectedBox.minX + selectedBox.maxX) / 2}
                y2={selectedBox.minY - ROTATE_HANDLE_OFFSET_PX * inv}
                className="stroke-primary/70"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={(selectedBox.minX + selectedBox.maxX) / 2}
                cy={selectedBox.minY - ROTATE_HANDLE_OFFSET_PX * inv}
                r={6 * inv}
                className="fill-primary stroke-background"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                data-rotate-handle
                style={{ cursor: ROTATE_CURSOR }}
              />
            </g>
          )}
        </g>
      </svg>

      {!hasPlacedCutouts ? (
        <div
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6"
          data-testid="layout-empty-state"
        >
          <div className="max-w-sm rounded-lg border border-dashed bg-background/90 px-5 py-4 text-center shadow-sm backdrop-blur">
            <p className="font-medium">No tool cutouts yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Trace a tool and choose Add to bin to place it here.
            </p>
          </div>
        </div>
      ) : null}

      <div
        className="absolute right-3 top-12 z-30 flex flex-col overflow-hidden rounded-md border bg-background/90 shadow-sm backdrop-blur"
        data-testid="layout-tool-toolbar"
      >
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-9 w-9 rounded-none",
            rulerActive && "bg-accent text-accent-foreground",
          )}
          aria-label={
            hasPlacedCutouts
              ? rulerActive
                ? "Stop measuring"
                : "Measure between contours"
              : "Add a tool cutout before measuring"
          }
          aria-pressed={rulerActive}
          title={
            hasPlacedCutouts
              ? "Ruler: measure between two tool-contour points"
              : "Add a tool cutout before measuring"
          }
          disabled={!hasPlacedCutouts}
          onClick={() => {
            const next = !rulerActive;
            setRulerActive(next);
            setMeasurementPoints([]);
            if (next && editorMode !== "placement") {
              dispatch({ type: "SET_EDITOR_MODE", editorMode: "placement" });
            }
          }}
          data-testid="button-layout-ruler"
        >
          <Ruler className="h-4 w-4" />
        </Button>
        {measurementPoints.length > 0 ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-none border-t"
            aria-label="Clear measurement"
            title="Clear measurement"
            onClick={() => setMeasurementPoints([])}
            data-testid="button-clear-layout-measurement"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      {rulerActive ? (
        <div
          className="pointer-events-none absolute right-14 top-12 z-20 rounded-md border bg-background/90 px-2.5 py-1.5 text-xs font-medium shadow-sm backdrop-blur"
          role="status"
          data-testid="layout-ruler-status"
        >
          {measurementPoints.length === 0
            ? "Click the first tool contour"
            : measurementPoints.length === 1
              ? "Click the second tool contour"
              : `${measuredDistanceMm!.toFixed(2)} mm · click another contour to restart`}
        </div>
      ) : null}

      <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-background/85 px-2 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
        {rulerActive
          ? "Ruler · endpoints snap to tool contours · Esc exits"
          : !hasPlacedCutouts
          ? "Add a tool from Trace to begin"
          : editorMode === "contour"
          ? selectedCutoutId
            ? "Contour edit · drag points · click an edge to add · right-click a point to remove · Esc finishes"
            : "Contour edit · click a pocket to select it"
          : selectedCutoutId
          ? "Drag moves · circles drag finger holes · handle rotates · R rotates 15° · arrows nudge · Del removes"
          : "Click a pocket to select · Shift-drag pans · Ctrl-scroll zooms"}
      </div>
    </>
  );
}

/** Transformed bin-frame outline → SVG path in the y-down canvas frame. */
function outlineToCanvasPath(
  outline: Outline,
  spec: { gridX: number; gridY: number },
): string {
  const ringPath = (ring: Ring): string => {
    if (ring.length === 0) return "";
    const parts = ring.map((point, index) => {
      const c = binToCanvas(point, spec);
      return `${index === 0 ? "M" : "L"} ${c.x.toFixed(3)} ${c.y.toFixed(3)}`;
    });
    return `${parts.join(" ")} Z`;
  };
  return outline
    .flatMap((shape) => [ringPath(shape.outer), ...shape.holes.map(ringPath)])
    .join(" ");
}
