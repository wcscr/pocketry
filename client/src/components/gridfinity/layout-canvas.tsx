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
  fingerHoleFootprintRing,
  oblongDeepScoopEndpoints,
  placementFootprint,
  resizeCutoutPlacementFromHandle,
  resizeFingerHoleFromWidthHandle,
  resizeOblongDeepScoopFromEndpoint,
  transformPointPlacement,
  untransformPointPlacement,
  type CutoutPlacement,
  type FingerHole,
  type PocketResizeHandle,
  type TracedShape,
} from "@shared/gridfinity/cutout";
import {
  binFootprintMm,
  gridPitchMm,
} from "@shared/gridfinity/standard";
import { MAX_GRID } from "@shared/gridfinity/types";
import {
  OUTER_RING,
  type Outline,
  type Point,
  type Ring,
  type RingRef,
} from "@shared/geometry/types";
import { pointInRing } from "@shared/geometry/rings";
import { validateLayout, type IssueSeverity } from "@shared/gridfinity/validate";
import {
  boundaryEdges,
  canonicalCells,
  cellCenterMm,
  footprintInteriorRingMm,
  footprintOuterRingMm,
  footprintTopologyError,
  isBoundaryEdge,
  normalizeCustomFootprint,
  occupiedCells,
  rectangleCells,
  type BoundaryEdge,
  type GridCell,
} from "@shared/gridfinity/footprint";

import {
  CanvasViewport,
  useCanvasViewportSize,
} from "@/components/canvas/canvas-viewport";
import { Button } from "@/components/ui/button";
import { useViewportTransform } from "@/hooks/use-viewport-transform";
import { outlineBounds, pointInOutline } from "@/lib/geometry/outline";
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
const POCKET_RESIZE_HANDLES: PocketResizeHandle[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

function isPocketResizeHandle(value: string | null): value is PocketResizeHandle {
  return POCKET_RESIZE_HANDLES.includes(value as PocketResizeHandle);
}

function resizeCursor(center: Point, handle: Point): string {
  const angle =
    ((Math.atan2(handle.y - center.y, handle.x - center.x) * 180) / Math.PI +
      180) %
    180;
  if (angle < 22.5 || angle >= 157.5) return "ew-resize";
  if (angle < 67.5) return "nwse-resize";
  if (angle < 112.5) return "ns-resize";
  return "nesw-resize";
}

function pocketHandleLocalPoint(
  bounds: NonNullable<ReturnType<typeof outlineBounds>>,
  handle: PocketResizeHandle,
): Point {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    x: handle.includes("w")
      ? bounds.minX
      : handle.includes("e")
        ? bounds.maxX
        : centerX,
    y: handle.includes("s")
      ? bounds.minY
      : handle.includes("n")
        ? bounds.maxY
        : centerY,
  };
}

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
  const {
    spec,
    cutouts,
    fingerHoles,
    selectedCutoutId,
    selectedFingerHoleId,
    editorMode,
    dispatch,
  } = useBin();
  const { shapes, storeShape } = useShapeLibrary();
  const shapesById = useMemo(
    () => new Map(shapes.map((shape) => [shape.id, shape])),
    [shapes],
  );

  const pitchMm = gridPitchMm(spec.gridPitch);
  const widthMm = binFootprintMm(spec.gridX, spec.gridPitch);
  const lengthMm = binFootprintMm(spec.gridY, spec.gridPitch);
  const footprintEditorPaddingMm = editorMode === "footprint" ? pitchMm : 0;

  const containerSize = useCanvasViewportSize();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const sceneRef = useRef<SVGGElement | null>(null);

  const viewport = useViewportTransform({
    contentWidth: widthMm + footprintEditorPaddingMm * 2,
    contentHeight: lengthMm + footprintEditorPaddingMm * 2,
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

  // Transformed pocket outlines, recomputed per change — pure math over
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
        return [{ cutout, shape, outline: footprint.outline }];
      }),
    [cutouts, shapesById, draftContour],
  );

  const placedFingerHoles = useMemo(
    () =>
      fingerHoles.map((hole) => {
        const endpoints =
          hole.kind === "oblong-deep-scoop"
            ? oblongDeepScoopEndpoints(hole)
            : null;
        const radians = ((hole.rotationDeg ?? 0) * Math.PI) / 180;
        return {
          hole,
          ring: fingerHoleFootprintRing(hole, {
            position: { x: 0, y: 0 },
            rotationDeg: 0,
            mirrored: false,
          }),
          endpoints,
          widthHandle: {
            x: hole.center.x - Math.sin(radians) * hole.diameterMm / 2,
            y: hole.center.y + Math.cos(radians) * hole.diameterMm / 2,
          },
        };
      }),
    [fingerHoles],
  );

  const severityByCutout = useMemo(() => {
    const map = new Map<string, IssueSeverity>();
    for (const issue of validateLayout(spec, cutouts, shapesById, fingerHoles)) {
      for (const id of issue.cutoutIds ?? []) {
        if (issue.severity === "error" || !map.has(id)) map.set(id, issue.severity);
      }
    }
    return map;
  }, [spec, cutouts, shapesById, fingerHoles]);

  const severityByFingerHole = useMemo(() => {
    const map = new Map<string, IssueSeverity>();
    for (const issue of validateLayout(spec, cutouts, shapesById, fingerHoles)) {
      for (const id of issue.fingerHoleIds ?? []) {
        if (issue.severity === "error" || !map.has(id)) {
          map.set(id, issue.severity);
        }
      }
    }
    return map;
  }, [spec, cutouts, shapesById, fingerHoles]);

  const selected = placed.find((p) => p.cutout.id === selectedCutoutId) ?? null;
  const selectedFingerHole =
    placedFingerHoles.find((item) => item.hole.id === selectedFingerHoleId) ?? null;

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
        kind: "resize";
        id: string;
        handle: PocketResizeHandle;
        startPlacement: CutoutPlacement;
        localBounds: NonNullable<ReturnType<typeof outlineBounds>>;
      }
    | { kind: "finger-hole-move"; id: string; grabOffset: Point }
    | {
        kind: "feature-end";
        featureId: string;
        endpoint: "start" | "end";
      }
    | { kind: "feature-width"; featureId: string }
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
  const hasPlacedObjects = hasPlacedCutouts || placedFingerHoles.length > 0;

  useEffect(() => {
    if (hasPlacedObjects) return;
    setRulerActive(false);
    setMeasurementPoints([]);
  }, [hasPlacedObjects]);

  const hitCutout = (point: Point): CutoutPlacement | null => {
    // Topmost = later in the list.
    for (let i = placed.length - 1; i >= 0; i--) {
      if (pointInOutline(placed[i].outline, point)) return placed[i].cutout;
    }
    return null;
  };

  const hitFingerHole = (point: Point): FingerHole | null => {
    for (let i = placedFingerHoles.length - 1; i >= 0; i--) {
      if (pointInRing(placedFingerHoles[i].ring, point)) {
        return placedFingerHoles[i].hole;
      }
    }
    return null;
  };

  /**
   * Re-dispatches the dragged value once without `transient`, so the whole
   * gesture lands in history as a single undo step.
   */
  const commitDrag = (drag: NonNullable<typeof dragRef.current>) => {
    if (
      drag.kind === "finger-hole-move" ||
      drag.kind === "feature-end" ||
      drag.kind === "feature-width"
    ) {
      const id = drag.kind === "finger-hole-move" ? drag.id : drag.featureId;
      const current = fingerHoles.find((hole) => hole.id === id);
      if (!current) return;
      dispatch({
        type: "UPDATE_FINGER_HOLE",
        id,
        patch: current,
        historyLabel:
          drag.kind === "finger-hole-move"
            ? "Move finger hole"
            : drag.kind === "feature-end"
              ? "Resize oblong finger hole"
              : "Resize finger hole diameter",
      });
      return;
    }

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
    } else if (drag.kind === "resize") {
      dispatch({
        type: "UPDATE_CUTOUT",
        id: current.id,
        patch: {
          position: current.position,
          scaleX: current.scaleX,
          scaleY: current.scaleY,
        },
        historyLabel: "Resize tool pocket",
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

    if (editorMode === "footprint") {
      const cell = pointToGridCell(point, spec, pitchMm, true);
      if (!cell) return;
      const current = occupiedCells(spec);
      const occupied = current.some(
        (candidate) => candidate.x === cell.x && candidate.y === cell.y,
      );
      if (!occupied && !isFaceAdjacentToCells(cell, current)) return;
      const nextCells = occupied
        ? current.filter((candidate) => candidate.x !== cell.x || candidate.y !== cell.y)
        : [...current, cell];
      if (nextCells.length === 0) return;

      // Empty perimeter rows/columns are discarded after every edit. Pockets
      // and an explicit label anchor receive the same lattice translation so
      // their position relative to the retained cells does not jump.
      const normalized = normalizeCustomFootprint(nextCells);
      if (normalized.gridX > MAX_GRID || normalized.gridY > MAX_GRID) return;
      if (
        footprintTopologyError(
          normalized.gridX,
          normalized.gridY,
          normalized.cells,
        )
      ) {
        return;
      }
      const footprint = normalized.cells.length === normalized.gridX * normalized.gridY
        ? { kind: "rectangle" as const }
        : { kind: "custom" as const, cells: canonicalCells(normalized.cells) };
      const delta = footprintEditTranslationMm(
        spec,
        normalized.gridX,
        normalized.gridY,
        normalized.shiftCells,
        pitchMm,
      );
      const nextCutouts = cutouts.map((cutout) => ({
        ...cutout,
        position: {
          x: cutout.position.x + delta.x,
          y: cutout.position.y + delta.y,
        },
      }));
      const tabEdge = spec.labelTab?.edge;
      const nextTabEdge = tabEdge
        ? {
            ...tabEdge,
            cell: {
              x: tabEdge.cell.x + normalized.shiftCells.x,
              y: tabEdge.cell.y + normalized.shiftCells.y,
            },
          }
        : null;
      const nextLabelTab = spec.labelTab
        ? { ...spec.labelTab, edge: nextTabEdge }
        : null;
      const nextSpec = {
        ...spec,
        gridX: normalized.gridX,
        gridY: normalized.gridY,
        footprint,
        labelTab: nextLabelTab,
      };
      if (nextTabEdge && !isBoundaryEdge(nextSpec, nextTabEdge)) return;
      dispatch({
        type: "REPLACE_LAYOUT",
        cutouts: nextCutouts,
        gridX: normalized.gridX,
        gridY: normalized.gridY,
        footprint,
        specPatch: { labelTab: nextLabelTab },
        historyLabel: occupied ? "Remove footprint cell" : "Add footprint cell",
      });
      event.preventDefault();
      return;
    }

    if (editorMode === "label-edge") {
      const target = event.target as Element;
      const x = Number(target.getAttribute("data-edge-cell-x"));
      const y = Number(target.getAttribute("data-edge-cell-y"));
      const side = target.getAttribute("data-edge-side") as BoundaryEdge["side"] | null;
      if (Number.isInteger(x) && Number.isInteger(y) && side) {
        dispatch({
          type: "PATCH_SPEC",
          patch: {
            labelTab: {
              ...(spec.labelTab ?? { width: "full" as const, wall: side }),
              wall: side,
              edge: { cell: { x, y }, side },
            },
          },
          historyLabel: "Choose label tab edge",
        });
        dispatch({ type: "SET_EDITOR_MODE", editorMode: "placement" });
      }
      return;
    }

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

    const resizeHandle =
      target.getAttribute?.("data-pocket-resize-handle") ?? null;
    if (
      editorMode === "placement" &&
      selected &&
      isPocketResizeHandle(resizeHandle)
    ) {
      const localBounds = outlineBounds(selected.shape.outlineMm);
      if (!localBounds) return;
      dragRef.current = {
        kind: "resize",
        id: selected.cutout.id,
        handle: resizeHandle,
        startPlacement: selected.cutout,
        localBounds,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
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

    const featureEndpoint = target.getAttribute?.("data-feature-end");
    const featureId = target.getAttribute?.("data-feature-id");
    if (
      featureId &&
      (featureEndpoint === "start" || featureEndpoint === "end") &&
      selectedFingerHole?.hole.id === featureId &&
      selectedFingerHole.hole.kind === "oblong-deep-scoop"
    ) {
      dragRef.current = {
        kind: "feature-end",
        featureId,
        endpoint: featureEndpoint,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (
      target.getAttribute?.("data-feature-width") &&
      featureId &&
      selectedFingerHole?.hole.id === featureId
    ) {
      dragRef.current = { kind: "feature-width", featureId };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    // Independent finger holes grab before pocket bodies when they overlap.
    const hitHole = hitFingerHole(point);
    if (hitHole) {
      dispatch({ type: "SELECT_FINGER_HOLE", id: hitHole.id });
      dragRef.current = {
        kind: "finger-hole-move",
        id: hitHole.id,
        grabOffset: {
          x: point.x - hitHole.center.x,
          y: point.y - hitHole.center.y,
        },
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
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

    if (drag.kind === "finger-hole-move") {
      const current = fingerHoles.find((hole) => hole.id === drag.id);
      if (!current) return;
      let x = point.x - drag.grabOffset.x;
      let y = point.y - drag.grabOffset.y;
      if (!event.altKey) {
        const tolerance = SNAP_TOLERANCE_PX / Math.max(scale, 1e-6);
        x = snapAxis(x, snapTargets(spec.gridX), tolerance);
        y = snapAxis(y, snapTargets(spec.gridY), tolerance);
      }
      dispatch({
        type: "UPDATE_FINGER_HOLE",
        id: current.id,
        patch: { center: { x, y } },
        transient: true,
      });
      return;
    }

    if (drag.kind === "feature-width") {
      const current = fingerHoles.find((hole) => hole.id === drag.featureId);
      if (!current) return;
      const resized = resizeFingerHoleFromWidthHandle(current, point);
      dispatch({
        type: "UPDATE_FINGER_HOLE",
        id: current.id,
        patch: resized,
        transient: true,
      });
      return;
    }

    if (drag.kind === "feature-end") {
      const current = fingerHoles.find((hole) => hole.id === drag.featureId);
      if (!current) return;
      const resized = resizeOblongDeepScoopFromEndpoint(
        current,
        drag.endpoint,
        point,
      );
      dispatch({
        type: "UPDATE_FINGER_HOLE",
        id: current.id,
        patch: resized,
        transient: true,
      });
      return;
    }

    if (drag.kind === "resize") {
      const resized = resizeCutoutPlacementFromHandle(
        drag.startPlacement,
        drag.localBounds,
        drag.handle,
        point,
        event.altKey,
      );
      dispatch({
        type: "UPDATE_CUTOUT",
        id: drag.id,
        patch: {
          position: resized.position,
          scaleX: resized.scaleX,
          scaleY: resized.scaleY,
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
        const hole = point ? hitFingerHole(point) : null;
        const cutout = !hole && point ? hitCutout(point) : null;
        if (hole) {
          dispatch({ type: "SELECT_FINGER_HOLE", id: hole.id });
        } else if (cutout) {
          dispatch({ type: "SELECT_CUTOUT", id: cutout.id });
        } else {
          dispatch({ type: "SELECT_CUTOUT", id: null });
          dispatch({ type: "SELECT_FINGER_HOLE", id: null });
        }
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
      if (editorMode !== "placement") {
        if (event.key === "Escape") {
          dispatch({ type: "SET_EDITOR_MODE", editorMode: "placement" });
          event.preventDefault();
        }
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (selectedFingerHoleId) {
        const hole = fingerHoles.find(
          (candidate) => candidate.id === selectedFingerHoleId,
        );
        if (!hole) return;
        const nudge = event.shiftKey ? 0.1 : 1;
        let patch: Partial<FingerHole> | null = null;
        if (event.key === "ArrowLeft") {
          patch = { center: { x: hole.center.x - nudge, y: hole.center.y } };
        } else if (event.key === "ArrowRight") {
          patch = { center: { x: hole.center.x + nudge, y: hole.center.y } };
        } else if (event.key === "ArrowUp") {
          patch = { center: { x: hole.center.x, y: hole.center.y + nudge } };
        } else if (event.key === "ArrowDown") {
          patch = { center: { x: hole.center.x, y: hole.center.y - nudge } };
        } else if (
          (event.key === "r" || event.key === "R") &&
          hole.kind === "oblong-deep-scoop"
        ) {
          patch = {
            rotationDeg:
              (((hole.rotationDeg ?? 0) + (event.shiftKey ? -15 : 15)) % 360 +
                360) %
              360,
          };
        } else if (event.key === "Delete" || event.key === "Backspace") {
          dispatch({ type: "REMOVE_FINGER_HOLE", id: hole.id });
          event.preventDefault();
          return;
        } else if (event.key === "Escape") {
          dispatch({ type: "SELECT_FINGER_HOLE", id: null });
          event.preventDefault();
          return;
        }
        if (patch) {
          dispatch({
            type: "UPDATE_FINGER_HOLE",
            id: hole.id,
            patch,
            historyLabel:
              "rotationDeg" in patch
                ? "Rotate oblong finger hole"
                : "Move finger hole",
          });
          event.preventDefault();
        }
        return;
      }
      if (!selectedCutoutId) return;
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
  }, [
    selectedCutoutId,
    selectedFingerHoleId,
    cutouts,
    fingerHoles,
    editorMode,
    rulerActive,
    dispatch,
  ]);

  const cursor =
    rulerActive
      ? "crosshair"
      : editorMode !== "placement"
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

  const outerFootprint = useMemo(() => footprintOuterRingMm(spec), [spec]);
  const interiorFootprint = useMemo(() => footprintInteriorRingMm(spec), [spec]);
  const footprintCells = useMemo(() => occupiedCells(spec), [spec]);
  const footprintEditorCells = useMemo(
    () => editableFootprintCells(spec, footprintCells),
    [spec, footprintCells],
  );
  const selectableEdges = useMemo(() => boundaryEdges(spec), [spec]);

  const selectedControls = useMemo(() => {
    if (!selected) return null;
    const bounds = outlineBounds(selected.shape.outlineMm);
    if (!bounds) return null;
    const localCenter = {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    };
    const handles = new Map(
      POCKET_RESIZE_HANDLES.map((handle) => {
        const point = binToCanvas(
          transformPointPlacement(
            pocketHandleLocalPoint(bounds, handle),
            selected.cutout,
          ),
          spec,
        );
        return [handle, point] as const;
      }),
    );
    const center = binToCanvas(
      transformPointPlacement(localCenter, selected.cutout),
      spec,
    );
    // Cursor direction follows an oriented unit square, not the silhouette's
    // aspect ratio. Otherwise a corner on a wide tool can be misclassified as
    // horizontal even though it is still a diagonal resize handle.
    const cursorPlacement = {
      ...selected.cutout,
      scaleX: 1,
      scaleY: 1,
    };
    const cursorCenter = binToCanvas(
      transformPointPlacement(localCenter, cursorPlacement),
      spec,
    );
    const cursors = new Map(
      POCKET_RESIZE_HANDLES.map((handle) => {
        const direction = {
          x: handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0,
          y: handle.includes("s") ? -1 : handle.includes("n") ? 1 : 0,
        };
        const directionPoint = binToCanvas(
          transformPointPlacement(
            {
              x: localCenter.x + direction.x,
              y: localCenter.y + direction.y,
            },
            cursorPlacement,
          ),
          spec,
        );
        return [handle, resizeCursor(cursorCenter, directionPoint)] as const;
      }),
    );
    const top = handles.get("n")!;
    const outward = { x: top.x - center.x, y: top.y - center.y };
    const length = Math.hypot(outward.x, outward.y) || 1;
    const rotate = {
      x: top.x + (outward.x / length) * ROTATE_HANDLE_OFFSET_PX * inv,
      y: top.y + (outward.y / length) * ROTATE_HANDLE_OFFSET_PX * inv,
    };
    return { handles, cursors, center, top, rotate };
  }, [selected, spec, inv]);

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
          transform={`translate(${translateX + footprintEditorPaddingMm * scale} ${translateY + footprintEditorPaddingMm * scale}) scale(${scale})`}
        >
          {/* Bin footprint. */}
          <path
            d={ringToCanvasPath(outerFootprint, spec)}
            className="fill-background stroke-foreground/60"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          {/* Interior boundary the pockets must respect. */}
          <path
            d={ringToCanvasPath(interiorFootprint, spec)}
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

          {editorMode === "footprint" &&
            footprintEditorCells.map((cell) => {
              const centre = binToCanvas(cellCenterMm(spec, cell), spec);
              const filled = footprintCells.some(
                (candidate) => candidate.x === cell.x && candidate.y === cell.y,
              );
              const inside =
                cell.x >= 0 &&
                cell.y >= 0 &&
                cell.x < spec.gridX &&
                cell.y < spec.gridY;
              return (
                <rect
                  key={`footprint-${cell.x}-${cell.y}`}
                  x={centre.x - pitchMm / 2}
                  y={centre.y - pitchMm / 2}
                  width={pitchMm}
                  height={pitchMm}
                  className={
                    filled
                      ? "fill-blue-500/15 stroke-blue-500/70"
                      : "fill-muted/20 stroke-muted-foreground/40"
                  }
                  strokeWidth={1}
                  strokeDasharray={filled ? undefined : "3 3"}
                  vectorEffect="non-scaling-stroke"
                  data-testid={inside ? "footprint-cell" : "footprint-halo-cell"}
                />
              );
            })}

          {editorMode === "label-edge" &&
            selectableEdges.map((edge) => {
              const line = boundaryEdgeCanvasLine(edge, spec, pitchMm);
              return (
                <line
                  key={`${edge.cell.x}-${edge.cell.y}-${edge.side}`}
                  {...line}
                  className="stroke-rose-500 hover:stroke-rose-700"
                  strokeWidth={8}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  data-edge-cell-x={edge.cell.x}
                  data-edge-cell-y={edge.cell.y}
                  data-edge-side={edge.side}
                  data-testid="label-boundary-edge"
                />
              );
            })}

          {placed.map(({ cutout, outline }) => {
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
              </g>
            );
          })}

          {placedFingerHoles.map(({ hole, ring, endpoints, widthHandle }) => {
            const severity = severityByFingerHole.get(hole.id);
            const isSelected = hole.id === selectedFingerHoleId;
            const tone =
              severity === "error"
                ? "fill-destructive/30 stroke-destructive"
                : severity === "warning"
                  ? "fill-amber-500/25 stroke-amber-600"
                  : isSelected
                    ? "fill-fuchsia-500/30 stroke-fuchsia-700"
                    : "fill-fuchsia-500/15 stroke-fuchsia-600/70";
            const widthCanvas = binToCanvas(widthHandle, spec);
            return (
              <g key={hole.id}>
                <path
                  d={ringToCanvasPath(ring, spec)}
                  className={cn(tone, "cursor-move")}
                  strokeWidth={isSelected ? 2 : 1.25}
                  strokeDasharray={hole.kind === "straight" ? undefined : "3 2"}
                  vectorEffect="non-scaling-stroke"
                  data-feature-id={hole.id}
                  data-testid={`finger-hole-${hole.kind}-${hole.id}`}
                />
                {isSelected && (
                  <>
                    <circle
                      cx={widthCanvas.x}
                      cy={widthCanvas.y}
                      r={5 * inv}
                      className="fill-background stroke-fuchsia-700"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                      style={{ cursor: "nwse-resize" }}
                      data-feature-width="diameter"
                      data-feature-id={hole.id}
                      data-testid={`finger-hole-width-${hole.id}`}
                    />
                    {endpoints
                      ? (["start", "end"] as const).map((endpoint) => {
                          const canvasPoint = binToCanvas(endpoints[endpoint], spec);
                          return (
                            <circle
                              key={endpoint}
                              cx={canvasPoint.x}
                              cy={canvasPoint.y}
                              r={5 * inv}
                              className="fill-background stroke-fuchsia-700"
                              strokeWidth={2}
                              vectorEffect="non-scaling-stroke"
                              style={{ cursor: "grab" }}
                              data-feature-end={endpoint}
                              data-feature-id={hole.id}
                              data-testid={`finger-hole-oblong-end-${endpoint}-${hole.id}`}
                            />
                          );
                        })
                      : null}
                  </>
                )}
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

          {editorMode === "placement" && selectedControls && selected && (
            <g>
              <polygon
                points={(["nw", "ne", "se", "sw"] as const)
                  .map((handle) => {
                    const point = selectedControls.handles.get(handle)!;
                    return `${point.x},${point.y}`;
                  })
                  .join(" ")}
                fill="none"
                className="stroke-primary/70"
                strokeWidth={1}
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={selectedControls.top.x}
                y1={selectedControls.top.y}
                x2={selectedControls.rotate.x}
                y2={selectedControls.rotate.y}
                className="stroke-primary/70"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={selectedControls.rotate.x}
                cy={selectedControls.rotate.y}
                r={6 * inv}
                className="fill-primary stroke-background"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                data-rotate-handle
                style={{ cursor: ROTATE_CURSOR }}
                data-testid="pocket-rotate-handle"
              />
              {POCKET_RESIZE_HANDLES.map((handle) => {
                const point = selectedControls.handles.get(handle)!;
                return (
                  <rect
                    key={handle}
                    x={point.x - 5 * inv}
                    y={point.y - 5 * inv}
                    width={10 * inv}
                    height={10 * inv}
                    rx={1.5 * inv}
                    className="fill-background stroke-primary"
                    strokeWidth={1.75}
                    vectorEffect="non-scaling-stroke"
                    style={{
                      cursor: selectedControls.cursors.get(handle),
                    }}
                    data-pocket-resize-handle={handle}
                    data-testid={`pocket-resize-handle-${handle}`}
                  />
                );
              })}
            </g>
          )}
        </g>
      </svg>

      {!hasPlacedObjects ? (
        <div
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6"
          data-testid="layout-empty-state"
        >
          <div className="max-w-sm rounded-lg border border-dashed bg-background/90 px-5 py-4 text-center shadow-sm backdrop-blur">
            <p className="font-medium">No layout objects yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add a tool pocket or a finger hole to place it here.
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
          : editorMode === "footprint"
          ? "Footprint edit · click cells or the dashed outer halo · Esc finishes"
          : editorMode === "label-edge"
          ? "Label tab · click a highlighted boundary edge"
          : !hasPlacedObjects
          ? "Add a tool pocket or finger hole to begin"
          : editorMode === "contour"
          ? selectedCutoutId
            ? "Contour edit · drag points · click an edge to add · right-click a point to remove · Esc finishes"
            : "Contour edit · click a pocket to select it"
          : selectedFingerHoleId
            ? "Finger hole · drag moves · white handle resizes · arrows nudge · Del removes"
            : selectedCutoutId
              ? "Pocket · drag edges/corners to resize · Option resizes from centre · round handle rotates"
              : "Click a pocket or finger hole to select · Shift-drag pans · Ctrl-scroll zooms"}
      </div>
    </>
  );
}

function pointToGridCell(
  point: Point,
  spec: { gridX: number; gridY: number },
  pitchMm: number,
  includeHalo = false,
): GridCell | null {
  const x = Math.floor((point.x + (spec.gridX * pitchMm) / 2) / pitchMm);
  const y = Math.floor((point.y + (spec.gridY * pitchMm) / 2) / pitchMm);
  const minimum = includeHalo ? -1 : 0;
  const maximumX = includeHalo ? spec.gridX : spec.gridX - 1;
  const maximumY = includeHalo ? spec.gridY : spec.gridY - 1;
  return x >= minimum && y >= minimum && x <= maximumX && y <= maximumY
    ? { x, y }
    : null;
}

function isFaceAdjacentToCells(cell: GridCell, cells: readonly GridCell[]): boolean {
  return cells.some(
    (candidate) =>
      Math.abs(candidate.x - cell.x) + Math.abs(candidate.y - cell.y) === 1,
  );
}

function editableFootprintCells(
  spec: { gridX: number; gridY: number },
  occupied: readonly GridCell[],
): GridCell[] {
  const cells = new Map<string, GridCell>();
  for (const cell of rectangleCells(spec.gridX, spec.gridY)) {
    cells.set(`${cell.x},${cell.y}`, cell);
  }
  for (const cell of occupied) {
    for (const candidate of [
      { x: cell.x - 1, y: cell.y },
      { x: cell.x + 1, y: cell.y },
      { x: cell.x, y: cell.y - 1 },
      { x: cell.x, y: cell.y + 1 },
    ]) {
      if (
        candidate.x >= -1 &&
        candidate.y >= -1 &&
        candidate.x <= spec.gridX &&
        candidate.y <= spec.gridY
      ) {
        cells.set(`${candidate.x},${candidate.y}`, candidate);
      }
    }
  }
  return canonicalCells([...cells.values()]);
}

function footprintEditTranslationMm(
  previous: { gridX: number; gridY: number },
  nextGridX: number,
  nextGridY: number,
  shiftCells: GridCell,
  pitchMm: number,
): Point {
  return {
    x: (shiftCells.x + (previous.gridX - nextGridX) / 2) * pitchMm,
    y: (shiftCells.y + (previous.gridY - nextGridY) / 2) * pitchMm,
  };
}

function ringToCanvasPath(
  ring: Ring,
  spec: { gridX: number; gridY: number },
): string {
  if (ring.length === 0) return "";
  return `${ring
    .map((point, index) => {
      const canvas = binToCanvas(point, spec);
      return `${index === 0 ? "M" : "L"} ${canvas.x.toFixed(3)} ${canvas.y.toFixed(3)}`;
    })
    .join(" ")} Z`;
}

function boundaryEdgeCanvasLine(
  edge: BoundaryEdge,
  spec: { gridX: number; gridY: number },
  pitchMm: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const centre = cellCenterMm(spec, edge.cell);
  const half = pitchMm / 2;
  const [a, b]: [Point, Point] =
    edge.side === "north"
      ? [
          { x: centre.x - half, y: centre.y + half },
          { x: centre.x + half, y: centre.y + half },
        ]
      : edge.side === "south"
        ? [
            { x: centre.x - half, y: centre.y - half },
            { x: centre.x + half, y: centre.y - half },
          ]
        : edge.side === "east"
          ? [
              { x: centre.x + half, y: centre.y - half },
              { x: centre.x + half, y: centre.y + half },
            ]
          : [
              { x: centre.x - half, y: centre.y - half },
              { x: centre.x - half, y: centre.y + half },
            ];
  const ca = binToCanvas(a, spec);
  const cb = binToCanvas(b, spec);
  return { x1: ca.x, y1: ca.y, x2: cb.x, y2: cb.y };
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
