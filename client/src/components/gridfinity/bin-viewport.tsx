import { SelectionToolButtons } from "./selection-tool-buttons";
import { useSelectionInspector } from "./selection-inspector-context";
import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { LoaderCircle, Ruler, Move3D, X } from "lucide-react";
import { Component, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import type { BufferGeometry, PerspectiveCamera } from "three";
import { Vector3 } from "three";

import type { Outline, Point } from "@shared/geometry/types";

import { Button } from "@/components/ui/button";
import { canHandleCanvasShortcut } from "@/lib/canvas-keyboard";
import { useDelayedBusy } from "@/hooks/use-delayed-busy";
import { useElementSize } from "@/hooks/use-element-size";
import { fitDistanceMm, type FitSize } from "@/lib/gridfinity/camera-fit";
import {
  measurementDistanceMm,
  snapToToolContour,
  type MeasurementPaths,
} from "@/lib/gridfinity/layout-measure";
import {
  BIN_BODY_COLOR,
  POCKET_FLOOR_COLOR,
  STACKING_RIM_COLOR,
} from "@/lib/gridfinity/pocket-floor-mesh";
import { cn } from "@/lib/utils";
import { type PocketTransformMode } from "@/lib/gridfinity/pocket-transform";
import { PocketSelectionPlane, SelectionTransformScene, ObjectTransformWire, type PocketEditor } from "./pocket-transform-scene";

import { ObjectTransformPanel, commitEditorObjects } from "./object-transform-panel";
import { applyObjectEdits, objectKey, objectRef, type EditableObject, type ObjectEdits, type RotationPivot } from "@/lib/gridfinity/object-arrangement";

const RULER_3D_SNAP_TOLERANCE_MM = 5;
const RULER_3D_Z_FIGHT_OFFSET_MM = 0.25;
const EMPTY_MEASUREMENT_OUTLINES: readonly Outline[] = [];
const EMPTY_MEASUREMENT_PATHS: MeasurementPaths = [];

export type MaterialColorTarget = "bin" | "pocket-floor" | "stacking-rim";

/** A lost GPU context must not take the project, history, or Layout view down. */
class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div role="alert" className="absolute bottom-16 left-3 right-3 rounded-lg border bg-background p-4 text-sm shadow-sm">
      <p>3D preview is unavailable. Your design is still open; use Layout to keep editing.</p>
      <Button variant="outline" size="sm" className="mt-2" onClick={() => this.setState({ failed: false })}>Retry 3D preview</Button>
    </div>;
  }
}

/**
 * The 3D preview for the bin designer: an r3f canvas dropped into the
 * workspace's canvas slot.
 *
 * Conventions: the geometry arrives in the bin frame (millimetres, z-up,
 * XY-centred, grounded at z = 0), so the camera's `up` is +z and the ground
 * grid is rotated into the XY plane with 42 mm divisions matching the
 * Gridfinity pitch. Normals come precomputed from manifold with 60° creases —
 * the material must never trigger a recompute (see `toBufferGeometry`).
 */
export interface BinViewportProps {
  geometry: BufferGeometry | null;
  pocketEditor?: PocketEditor;
  /** Exact printable pocket-floor material volume. */
  pocketFloorGeometry?: BufferGeometry | null;
  /** Exact printable stacking-rim material volume. */
  stackingRimGeometry?: BufferGeometry | null;
  /** The preview includes a contrasting pocket-floor material volume. */
  hasPocketFloor?: boolean;
  /** Geometry has a printable material group at the stacking-lip crest. */
  hasStackingRim?: boolean;
  binColor?: string;
  pocketFloorColor?: string;
  stackingRimColor?: string;
  showPocketFloorColor?: boolean;
  showStackingRimColor?: boolean;
  /** Reveal the matching material control from its legend entry. */
  onEditColor: (target: MaterialColorTarget) => void;
  building: boolean;
  /** The displayed preview is temporarily simplified. */
  previewIsDraft?: boolean;
  /** 0..1 while building. */
  progress: number;
  error: string | null;
  onRetryPreview?: () => void;
  /** Outer bin dimensions; the camera re-fits when these change. */
  fitSize: FitSize;
  /** Placed tool outlines in bin-frame XY millimetres. */
  measurementOutlines?: readonly Outline[];
  /** Open split boundaries in the same bin-frame XY millimetres. */
  measurementSplitBoundaries?: MeasurementPaths;
  /** Original top surface of the bin, below the stacking lip. */
  measurementPlaneZMm?: number;
}

function PlanarRulerScene({
  active,
  outlines,
  splitBoundaries,
  points,
  planeZMm,
  widthMm,
  lengthMm,
  onPoint,
}: {
  active: boolean;
  outlines: readonly Outline[];
  splitBoundaries: MeasurementPaths;
  points: readonly Point[];
  planeZMm: number;
  widthMm: number;
  lengthMm: number;
  onPoint: (point: Point) => void;
}): JSX.Element | null {
  if (!active) return null;

  const displayZ = planeZMm + RULER_3D_Z_FIGHT_OFFSET_MM;
  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const snapped = snapToToolContour(
      { x: event.point.x, y: event.point.y },
      outlines,
      RULER_3D_SNAP_TOLERANCE_MM,
      splitBoundaries,
    );
    if (snapped) onPoint(snapped.point);
  };

  return (
    <group name="bin-3d-measurement">
      <mesh
        position={[0, 0, planeZMm + 0.01]}
        onPointerDown={handlePointerDown}
      >
        <planeGeometry args={[widthMm, lengthMm]} />
        <meshBasicMaterial
          transparent
          opacity={0}
          depthWrite={false}
          colorWrite={false}
        />
      </mesh>
      {splitBoundaries.filter(boundary => boundary.length >= 2).map((boundary, index) => (
        <Line
          key={index}
          points={boundary.map(point => [point.x, point.y, displayZ] as [number, number, number])}
          color="#c026d3"
          lineWidth={1.5}
          dashed
          dashSize={2}
          gapSize={1}
          depthTest={false}
          renderOrder={99}
        />
      ))}
      {points.length === 2 ? (
        <Line
          points={[
            [points[0].x, points[0].y, displayZ],
            [points[1].x, points[1].y, displayZ],
          ]}
          color="#c026d3"
          lineWidth={3}
          depthTest={false}
          renderOrder={100}
        />
      ) : null}
      {points.map((point, index) => (
        <mesh
          key={`${point.x}-${point.y}-${index}`}
          position={[point.x, point.y, displayZ]}
          renderOrder={101}
        >
          <sphereGeometry args={[1.25, 20, 12]} />
          <meshBasicMaterial color="#c026d3" depthTest={false} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Re-frames the camera whenever the bin's outer dimensions change — a 7×10
 * bin must not swallow a camera positioned for a 2×2 — while preserving the
 * user's orbit direction, so growing the bin reads as "zoom out", not as a
 * teleport.
 */
function CameraFit({ size }: { size: FitSize }): null {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const controls = useThree((state) => state.controls) as unknown as {
    target: Vector3;
    update: () => void;
  } | null;

  useEffect(() => {
    const target = new Vector3(0, 0, size.heightMm / 2);
    const previousTarget = controls?.target ?? target;
    const direction = camera.position.clone().sub(previousTarget);
    if (direction.lengthSq() < 1) direction.set(150, -170, 109);
    direction.normalize();

    const distance = fitDistanceMm(size, camera.fov, camera.aspect);
    camera.position.copy(target.clone().addScaledVector(direction, distance));
    if (controls) {
      controls.target.copy(target);
      controls.update();
    } else {
      camera.lookAt(target);
    }
    // Refit on dimension changes (and once controls attach) — never on
    // orbit, which lives inside controls.
  }, [size.widthMm, size.lengthMm, size.heightMm, camera, controls]);

  return null;
}

export function BinViewport({
  geometry,
  pocketEditor,
  pocketFloorGeometry = null,
  stackingRimGeometry = null,
  hasPocketFloor = false,
  hasStackingRim = false,
  binColor = BIN_BODY_COLOR,
  pocketFloorColor = POCKET_FLOOR_COLOR,
  stackingRimColor = STACKING_RIM_COLOR,
  showPocketFloorColor = true,
  showStackingRimColor = true,
  onEditColor,
  building,
  previewIsDraft = false,
  error,
  onRetryPreview,
  fitSize,
  measurementOutlines = EMPTY_MEASUREMENT_OUTLINES,
  measurementSplitBoundaries = EMPTY_MEASUREMENT_PATHS,
  measurementPlaneZMm = fitSize.heightMm,
}: BinViewportProps): JSX.Element {
  // The workspace's panel group lays out *after* children mount, so this slot
  // is zero-sized for a beat. r3f ignores zero-size measurements and its
  // follow-up resize delivery proved unreliable here (the canvas stayed at
  // the 300×150 default until a window resize). Mounting the Canvas only once
  // the slot has real dimensions makes fiber's initial measurement the
  // correct one; after that its own observer tracks panel drags fine.
  const [containerRef, containerSize] = useElementSize<HTMLDivElement>();
  const laidOut = containerSize.width > 0 && containerSize.height > 0;
  const [rulerActive, setRulerActive] = useState(false);
  const inspector = useSelectionInspector();
  const [objectControlsOpen, setObjectControlsOpen] = useState(false);
  useEffect(() => { if (!pocketEditor) setObjectControlsOpen(false); }, [!!pocketEditor]);
  const [transformMode, setTransformMode] = useState<PocketTransformMode>("translate");
  const [modeRequest, setModeRequest] = useState(0);
  useEffect(() => {
    if (inspector?.tool === "translate" || inspector?.tool === "rotate") setTransformMode(inspector.tool);
    if (inspector && inspector.tool !== "properties") setRulerActive(false);
  }, [inspector?.tool]);
  const [snapTransform, setSnapTransform] = useState(false);
  const [dragPreview, setDragPreview] = useState<ObjectEdits | null>(null);
  const [transformLimited, setTransformLimited] = useState(false);
  const [pivot, setPivot] = useState<RotationPivot>("individual");
  const objects = useMemo<EditableObject[]>(() => pocketEditor ? [
    ...pocketEditor.pockets.map(p => ({ ...p, kind: "pocket" as const })),
    ...(pocketEditor.fingerHoles ?? []).map(hole => ({ hole, kind: "finger" as const })),
  ] : [], [pocketEditor?.pockets, pocketEditor?.fingerHoles]);
  const selectionKey = JSON.stringify((pocketEditor?.selection ?? (pocketEditor?.selectedId ? [{ kind: "pocket" as const, id: pocketEditor.selectedId }] : [])).map(objectKey));
  const selectedObjects = useMemo(() => (JSON.parse(selectionKey) as string[]).flatMap(key => objects.filter(o => objectKey(objectRef(o)) === key)), [objects, selectionKey]);
  const displayedObjects = dragPreview ? applyObjectEdits(selectedObjects, dragPreview) : selectedObjects;
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!pocketEditor || !canHandleCanvasShortcut(event) || event.altKey) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault(); pocketEditor.onSelectionChange?.(objects.map(objectRef)); return;
      }
      if (event.ctrlKey || event.metaKey) return;
      if (event.key === "Escape") { pocketEditor.onSelectionChange?.([]); return; }
      if (event.key.toLowerCase() === "w" || event.key.toLowerCase() === "e") {
        event.preventDefault(); setRulerActive(false); setObjectControlsOpen(true);
        setTransformMode(event.key.toLowerCase() === "w" ? "translate" : "rotate");
        inspector?.setTool(event.key.toLowerCase() === "w" ? "translate" : "rotate");
        setModeRequest(value => value + 1);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [pocketEditor, objects, inspector?.setTool]);
  const [measurementPoints, setMeasurementPoints] = useState<Point[]>([]);
  const showBusy = useDelayedBusy(building);
  const measuredDistanceMm = useMemo(
    () =>
      measurementPoints.length === 2
        ? measurementDistanceMm(measurementPoints[0], measurementPoints[1])
        : null,
    [measurementPoints],
  );
  const recordMeasurementPoint = useCallback((point: Point) => {
    setMeasurementPoints((current) =>
      current.length < 2 ? [...current, point] : [point],
    );
  }, []);

  useEffect(() => {
    if (!rulerActive) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!canHandleCanvasShortcut(event)) return;
      if (event.key === "Escape") {
        setRulerActive(false);
        setMeasurementPoints([]);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [rulerActive]);

  useEffect(() => {
    setMeasurementPoints([]);
  }, [measurementOutlines, measurementSplitBoundaries]);

  // Ground plane sized to the bin: at least one spare cell all round.
  const groundSpanMm =
    Math.ceil(Math.max(fitSize.widthMm, fitSize.lengthMm, 336) / 42) * 42 + 84;

  return (
    <div ref={containerRef} className="absolute inset-0" data-testid="bin-viewport">
      {laidOut ? (
        <PreviewBoundary>
        <Canvas
          camera={{ position: [150, -170, 130], up: [0, 0, 1], fov: 40, near: 1, far: 6000 }}
        >
        <ambientLight intensity={0.45} />
        <directionalLight position={[90, -70, 160]} intensity={1.1} />
        <directionalLight position={[-70, 90, 50]} intensity={0.35} />
        {geometry ? (
          <mesh geometry={geometry}>
            <meshStandardMaterial color={binColor} roughness={0.55} metalness={0.05} />
          </mesh>
        ) : null}
        {pocketFloorGeometry ? (
          <mesh geometry={pocketFloorGeometry}>
            <meshStandardMaterial
              color={showPocketFloorColor ? pocketFloorColor : binColor}
              roughness={0.55}
              metalness={0.02}
            />
          </mesh>
        ) : null}
        {stackingRimGeometry ? (
          <mesh geometry={stackingRimGeometry}>
            <meshStandardMaterial
              color={showStackingRimColor ? stackingRimColor : binColor}
              roughness={0.5}
              metalness={0.02}
            />
          </mesh>
        ) : null}
        {pocketEditor && <PocketSelectionPlane editor={pocketEditor} width={fitSize.widthMm} length={fitSize.lengthMm} disabled={rulerActive || !!dragPreview} />}
        {pocketEditor && !rulerActive && displayedObjects.map(object => <ObjectTransformWire key={objectKey(objectRef(object))} object={object} spec={pocketEditor.spec} />)}
        {selectedObjects.length > 0 && pocketEditor && (inspector ? (inspector.tool === "translate" || inspector.tool === "rotate") : objectControlsOpen) && !rulerActive && <SelectionTransformScene
          key={`${selectionKey}-${transformMode}`} objects={selectedObjects} allObjects={objects} spec={pocketEditor.spec} mode={transformMode} snap={snapTransform} pivot={pivot}
          onPreview={setDragPreview} onLimit={setTransformLimited}
          onCommit={edits => commitEditorObjects(pocketEditor, edits, `${transformMode === "translate" ? "Move" : "Rotate"} ${selectedObjects.length} objects in 3D`, transformMode)} />}
        <PlanarRulerScene
          active={rulerActive}
          outlines={measurementOutlines}
          splitBoundaries={measurementSplitBoundaries}
          points={measurementPoints}
          planeZMm={measurementPlaneZMm}
          widthMm={fitSize.widthMm}
          lengthMm={fitSize.lengthMm}
          onPoint={recordMeasurementPoint}
        />
        {/* One line per 42 mm grid cell. gridHelper lives in three's y-up XZ
            plane; rotate it into our z-up world's XY. (Full 6-digit hex:
            THREE.Color rejects #rgba shorthand.) */}
          <gridHelper
            key={groundSpanMm}
            args={[groundSpanMm, groundSpanMm / 42, "#9a9a9a", "#d4d4d4"]}
            rotation={[Math.PI / 2, 0, 0]}
          />
          <OrbitControls
            makeDefault
            target={[0, 0, 21]}
            enabled={!rulerActive}
            enableDamping
            dampingFactor={0.12}
          />
          <CameraFit size={fitSize} />
        </Canvas>
        </PreviewBoundary>
      ) : null}

      <div
        className="absolute right-3 top-16 md:top-12 [@media(pointer:coarse)]:top-16 z-30 flex flex-col overflow-hidden rounded-md border bg-background/90 shadow-sm backdrop-blur"
        data-testid="bin-3d-tool-toolbar"
      >
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-9 w-9 rounded-none [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11",
            rulerActive && "bg-accent text-accent-foreground",
          )}
          disabled={measurementOutlines.length === 0}
          aria-label={rulerActive ? "Stop measuring" : "Measure between contours"}
          aria-pressed={rulerActive}
          title={
            measurementOutlines.length === 0
              ? "Add a tool cutout before measuring"
              : "Ruler: measure contours or split lines on the top plane"
          }
          onClick={() => {
            const next = !rulerActive;
            setRulerActive(next);
            setMeasurementPoints([]);
          }}
          data-testid="button-3d-ruler"
        >
          <Ruler className="h-4 w-4" />
        </Button>
        {pocketEditor && inspector && <SelectionToolButtons count={selectedObjects.length} inactive={rulerActive} onActivate={() => setRulerActive(false)} />}
        {pocketEditor && !inspector && <Button variant="ghost" size="icon"
          className={cn("h-9 w-9 rounded-none border-t [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11", objectControlsOpen && !rulerActive && "bg-accent text-accent-foreground")}
          aria-label="Object controls" title="Move, rotate and arrange objects" aria-expanded={objectControlsOpen && !rulerActive}
          onClick={() => { setObjectControlsOpen(open => !open || rulerActive); setRulerActive(false); }}><Move3D className="h-4 w-4" /></Button>}
        {measurementPoints.length > 0 ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-none [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 border-t"
            aria-label="Clear measurement"
            title="Clear measurement"
            onClick={() => setMeasurementPoints([])}
            data-testid="button-clear-3d-measurement"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      {pocketEditor && (objectControlsOpen || !!inspector && selectedObjects.length > 0) && !rulerActive && <ObjectTransformPanel editor={pocketEditor} objects={objects} selected={selectedObjects} displayed={displayedObjects}
        mode={transformMode} modeRequest={modeRequest} setMode={mode => { setRulerActive(false); setTransformMode(mode); }} snap={snapTransform} setSnap={setSnapTransform}
        pivot={pivot} setPivot={setPivot} limited={transformLimited} onClose={() => setObjectControlsOpen(false)} />}

      {rulerActive ? (
        <div
          className="pointer-events-none absolute right-14 top-12 [@media(pointer:coarse)]:right-16 [@media(pointer:coarse)]:top-16 z-20 max-w-60 rounded-md border bg-background/90 px-2.5 py-1.5 text-xs font-medium shadow-sm backdrop-blur"
          role="status"
          data-testid="bin-3d-ruler-status"
        >
          <span className="block">
            {measurementPoints.length === 0
              ? "Click the first contour or split line on the top plane"
              : measurementPoints.length === 1
                ? "Click the second contour or split line on the top plane"
                : `${measuredDistanceMm!.toFixed(2)} mm · click to start a new measurement`}
          </span>
          <span className="mt-1 block text-[11px] font-normal text-muted-foreground">
            For the most accurate dimension check, use the ruler in Layout.
          </span>
        </div>
      ) : null}

      {rulerActive ? (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-background/85 px-2 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
          3D ruler · snap to contours or split lines on the top XY plane · Esc exits
        </div>
      ) : null}

      {(hasPocketFloor && showPocketFloorColor) ||
      (hasStackingRim && showStackingRimColor) ? (
        <div
          className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full border bg-background/90 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm backdrop-blur"
          data-testid="material-color-legend"
        >
          <button
            type="button"
            className="-m-1 flex items-center gap-1.5 rounded-full p-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onEditColor("bin")}
            title="Edit bin body color"
          >
            <span
              className="h-2.5 w-2.5 rounded-sm border border-black/10"
              style={{ backgroundColor: binColor }}
              aria-hidden="true"
            />
            Bin body
          </button>
          {hasPocketFloor && showPocketFloorColor ? (
            <button
              type="button"
              className="-m-1 flex items-center gap-1.5 rounded-full p-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onEditColor("pocket-floor")}
              title="Edit pocket floor color"
            >
              <span
                className="h-2.5 w-2.5 rounded-sm border border-black/10"
                style={{ backgroundColor: pocketFloorColor }}
                aria-hidden="true"
              />
              Pocket floor
            </button>
          ) : null}
          {hasStackingRim && showStackingRimColor ? (
            <button
              type="button"
              className="-m-1 flex items-center gap-1.5 rounded-full p-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onEditColor("stacking-rim")}
              title="Edit rim top color"
            >
              <span
                className="h-2.5 w-2.5 rounded-sm border border-black/10"
                style={{ backgroundColor: stackingRimColor }}
                aria-hidden="true"
              />
              Rim top
            </button>
          ) : null}
        </div>
      ) : null}

      {showBusy || previewIsDraft ? (
        <div
          className="pointer-events-none absolute left-1/2 top-16 flex w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5 text-center text-xs font-medium tabular-nums text-foreground shadow-lg backdrop-blur"
          role="status"
          aria-live="polite"
          data-testid="bin-preview-status"
        >
          {building ? <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-600" /> : null}
          <span>
            {previewIsDraft
              ? building
                ? "Simplified preview · refining details…"
                : "Simplified preview · detailed preview unavailable"
              : "Updating preview…"}
          </span>
        </div>
      ) : null}
      {error ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 mx-auto w-fit max-w-[80%] rounded-md bg-destructive/90 px-3 py-1.5 text-xs text-destructive-foreground shadow">
          {error}
          {onRetryPreview && <Button variant="outline" size="sm" className="pointer-events-auto ml-2" onClick={onRetryPreview}>Retry preview</Button>}
        </div>
      ) : null}
    </div>
  );
}
