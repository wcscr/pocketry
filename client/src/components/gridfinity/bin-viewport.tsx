import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { LoaderCircle, Ruler, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { BufferGeometry, PerspectiveCamera } from "three";
import { Vector3 } from "three";

import type { Outline, Point } from "@shared/geometry/types";

import { Button } from "@/components/ui/button";
import { useElementSize } from "@/hooks/use-element-size";
import { fitDistanceMm, type FitSize } from "@/lib/gridfinity/camera-fit";
import {
  measurementDistanceMm,
  snapToToolContour,
} from "@/lib/gridfinity/layout-measure";
import {
  BIN_BODY_COLOR,
  POCKET_FLOOR_COLOR,
  STACKING_RIM_COLOR,
} from "@/lib/gridfinity/pocket-floor-mesh";
import { cn } from "@/lib/utils";

const RULER_3D_SNAP_TOLERANCE_MM = 5;
const RULER_3D_Z_FIGHT_OFFSET_MM = 0.25;
const EMPTY_MEASUREMENT_OUTLINES: readonly Outline[] = [];

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
  building: boolean;
  /** 0..1 while building. */
  progress: number;
  error: string | null;
  /** Outer bin dimensions; the camera re-fits when these change. */
  fitSize: FitSize;
  /** Placed tool outlines in bin-frame XY millimetres. */
  measurementOutlines?: readonly Outline[];
  /** Original top surface of the bin, below the stacking lip. */
  measurementPlaneZMm?: number;
}

function PlanarRulerScene({
  active,
  outlines,
  points,
  planeZMm,
  widthMm,
  lengthMm,
  onPoint,
}: {
  active: boolean;
  outlines: readonly Outline[];
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
  pocketFloorGeometry = null,
  stackingRimGeometry = null,
  hasPocketFloor = false,
  hasStackingRim = false,
  binColor = BIN_BODY_COLOR,
  pocketFloorColor = POCKET_FLOOR_COLOR,
  stackingRimColor = STACKING_RIM_COLOR,
  showPocketFloorColor = true,
  showStackingRimColor = true,
  building,
  progress,
  error,
  fitSize,
  measurementOutlines = EMPTY_MEASUREMENT_OUTLINES,
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
  const [measurementPoints, setMeasurementPoints] = useState<Point[]>([]);
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
  }, [measurementOutlines]);

  // Ground plane sized to the bin: at least one spare cell all round.
  const groundSpanMm =
    Math.ceil(Math.max(fitSize.widthMm, fitSize.lengthMm, 336) / 42) * 42 + 84;

  return (
    <div ref={containerRef} className="absolute inset-0" data-testid="bin-viewport">
      {laidOut ? (
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
        <PlanarRulerScene
          active={rulerActive}
          outlines={measurementOutlines}
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
      ) : null}

      <div
        className="absolute right-3 top-12 z-30 flex flex-col overflow-hidden rounded-md border bg-background/90 shadow-sm backdrop-blur"
        data-testid="bin-3d-tool-toolbar"
      >
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-9 w-9 rounded-none",
            rulerActive && "bg-accent text-accent-foreground",
          )}
          disabled={measurementOutlines.length === 0}
          aria-label={rulerActive ? "Stop measuring" : "Measure between contours"}
          aria-pressed={rulerActive}
          title={
            measurementOutlines.length === 0
              ? "Add a tool cutout before measuring"
              : "Ruler: measure on the tool-cutout plane"
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
        {measurementPoints.length > 0 ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-none border-t"
            aria-label="Clear measurement"
            title="Clear measurement"
            onClick={() => setMeasurementPoints([])}
            data-testid="button-clear-3d-measurement"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      {rulerActive ? (
        <div
          className="pointer-events-none absolute right-14 top-12 z-20 max-w-60 rounded-md border bg-background/90 px-2.5 py-1.5 text-xs font-medium shadow-sm backdrop-blur"
          role="status"
          data-testid="bin-3d-ruler-status"
        >
          <span className="block">
            {measurementPoints.length === 0
              ? "Click the first tool contour on the top plane"
              : measurementPoints.length === 1
                ? "Click the second tool contour on the top plane"
                : `${measuredDistanceMm!.toFixed(2)} mm · click another contour to restart`}
          </span>
          <span className="mt-1 block text-[11px] font-normal text-muted-foreground">
            For the most accurate dimension check, use the ruler in Layout.
          </span>
        </div>
      ) : null}

      {rulerActive ? (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-background/85 px-2 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
          3D ruler · endpoints snap to tool contours on the top XY plane · Esc exits
        </div>
      ) : null}

      {(hasPocketFloor && showPocketFloorColor) ||
      (hasStackingRim && showStackingRimColor) ? (
        <div
          className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded-full border bg-background/90 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm backdrop-blur"
          data-testid="material-color-legend"
        >
          {hasPocketFloor && showPocketFloorColor ? (
            <span className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-sm border border-black/10"
                style={{ backgroundColor: pocketFloorColor }}
                aria-hidden="true"
              />
              Pocket floor
            </span>
          ) : null}
          {hasStackingRim && showStackingRimColor ? (
            <span className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-sm border border-black/10"
                style={{ backgroundColor: stackingRimColor }}
                aria-hidden="true"
              />
              Rim top
            </span>
          ) : null}
        </div>
      ) : null}

      {building ? (
        <div
          className="pointer-events-none absolute left-1/2 top-16 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5 text-xs font-medium tabular-nums text-foreground shadow-lg backdrop-blur"
          role="status"
          aria-live="polite"
          data-testid="bin-preview-status"
        >
          <LoaderCircle className="h-3.5 w-3.5 animate-spin text-blue-600" />
          Updating 3D preview… {Math.round(progress * 100)}%
        </div>
      ) : null}
      {error ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 mx-auto w-fit max-w-[80%] rounded-md bg-destructive/90 px-3 py-1.5 text-xs text-destructive-foreground shadow">
          {error}
        </div>
      ) : null}
    </div>
  );
}
