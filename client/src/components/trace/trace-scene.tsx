import { memo, useMemo, type PointerEvent as ReactPointerEvent } from "react";

import { OUTER_RING, type Point, type Rect, type RingRef } from "@shared/geometry/types";

import { iterateRings, sameRingRef } from "@/lib/geometry/outline";
import { outlineToPathData } from "@/lib/export/svg";
import type { Outline } from "@shared/geometry/types";
import type { Calibration, DraftCalibration } from "@shared/geometry/scale";

/** The viewport transform applied to the whole scene. */
export interface SceneTransform {
  scale: number;
  translateX: number;
  translateY: number;
}

export interface TraceSceneProps {
  imageUrl: string;
  imageSize: { width: number; height: number };
  transform: SceneTransform;
  outline: Outline;
  selection: RingRef | null;
  region: Rect | null;
  /** Keeps the crop boundary prominent only while the region tool is active. */
  regionActive?: boolean;
  calibration: Calibration | null;
  draftCalibration: DraftCalibration | null;
  /** Dims the outline while a new one is being computed. */
  busy?: boolean;
  /**
   * Index of the hovered vertex on the *selected* ring, or null. The hovered
   * handle renders enlarged and filled, so a click reads as "grab this point"
   * rather than "add a new one".
   */
  hoveredVertexIndex?: number | null;
  /** Handles for the interaction layer above. */
  onPointerDown?: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerMove?: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerCancel?: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerLeave?: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onContextMenu?: (event: React.MouseEvent<SVGSVGElement>) => void;
  svgRef?: React.Ref<SVGSVGElement>;
  sceneRef?: React.Ref<SVGGElement>;
  cursor?: string;
}

/** Screen-space sizes, divided by the scale so they stay constant when zooming. */
const HANDLE_RADIUS = 5;
const HANDLE_RADIUS_SELECTED = 7;
const RULER_HANDLE_RADIUS = 7;
const RULER_HIT_RADIUS = 12;

/**
 * The canvas scene: one `<svg>` filling the viewport, with the image and every
 * overlay inside a single transformed group.
 *
 * This structure is the fix for the outline appearing offset from the photo.
 * Previously an `<img className="object-contain">` was laid out by CSS inside a
 * fixed-height box while a separately-sized `<svg>` was absolutely positioned
 * over it. Two different sizing algorithms produced the two boxes, so they only
 * agreed when the image happened to be exactly as tall as the container —
 * anything else letterboxed the image and left the outline shifted.
 *
 * With `<image>` inside the same `<g transform>` as the geometry, registration
 * is structural: there is no code path that can desynchronise them, and
 * `getScreenCTM()` on that group is an exact screen↔image mapping for hit
 * testing.
 *
 * The `<svg>` deliberately has **no `viewBox`** and no width/height attributes.
 * It is sized to fill its container by CSS, so its user units are container
 * pixels — the same units the transform is computed in. A viewBox would
 * introduce a second, implicit scale, which is the very class of bug being
 * removed here.
 */
export function TraceScene({
  imageUrl,
  imageSize,
  transform,
  outline,
  selection,
  region,
  regionActive = false,
  calibration,
  draftCalibration,
  busy = false,
  hoveredVertexIndex = null,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  onContextMenu,
  svgRef,
  sceneRef,
  cursor,
}: TraceSceneProps): JSX.Element {
  const { scale, translateX, translateY } = transform;
  const inv = scale > 0 ? 1 / scale : 1;

  const fillPath = useMemo(() => outlineToPathData(outline), [outline]);
  const rings = useMemo(() => [...iterateRings(outline)], [outline]);

  const selectedRing = useMemo(() => {
    if (!selection) return null;
    return rings.find(({ ref }) => sameRingRef(ref, selection))?.ring ?? null;
  }, [rings, selection]);

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 block h-full w-full touch-none select-none"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerLeave}
      onContextMenu={onContextMenu}
    >
      <g
        ref={sceneRef}
        transform={`translate(${translateX} ${translateY}) scale(${scale})`}
      >
        <SourceImage url={imageUrl} width={imageSize.width} height={imageSize.height} />

        {/* The traced material, with holes punched out by the even-odd rule. */}
        {fillPath && (
          <path
            d={fillPath}
            fillRule="evenodd"
            className="fill-fuchsia-500/10"
            style={{ opacity: busy ? 0.4 : 1, transition: "opacity 120ms" }}
            data-testid="detected-contour-fill"
          />
        )}

        {/*
          A bright contour alone disappears wherever the photo contains that
          hue or brightness. The white under-stroke creates a constant halo on
          dark tools, while the magenta foreground stays distinct on pale
          backgrounds and from the blue region/orange scale overlays.
        */}
        {rings.map(({ ref, ring }) => (
          <g key={`${ref.shapeIndex}:${ref.ringIndex}`}>
            <path
              d={ringToPath(ring)}
              fill="none"
              vectorEffect="non-scaling-stroke"
              strokeWidth={sameRingRef(selection, ref) ? 7 : 6}
              className="stroke-white/95"
              strokeDasharray={ref.ringIndex === OUTER_RING ? undefined : "4 3"}
              strokeLinejoin="round"
              style={{ opacity: busy ? 0.4 : 1 }}
              data-testid="detected-contour-halo"
            />
            <path
              d={ringToPath(ring)}
              fill="none"
              vectorEffect="non-scaling-stroke"
              strokeWidth={sameRingRef(selection, ref) ? 3.5 : 2.75}
              className={
                sameRingRef(selection, ref)
                  ? "stroke-fuchsia-500"
                  : ref.ringIndex === OUTER_RING
                    ? "stroke-fuchsia-500/95"
                    : "stroke-fuchsia-400/90"
              }
              strokeDasharray={ref.ringIndex === OUTER_RING ? undefined : "4 3"}
              strokeLinejoin="round"
              style={{ opacity: busy ? 0.4 : 1 }}
              data-testid="detected-contour-stroke"
            />
          </g>
        ))}

        {/*
          Vertex handles only for the selected ring. A native-resolution trace
          can carry thousands of points per ring; rendering a handle for every
          one of them is unusable and janks the whole canvas.
        */}
        {selectedRing?.map((point, index) => {
          const hovered = index === hoveredVertexIndex;
          return (
            <circle
              key={index}
              cx={point.x}
              cy={point.y}
              r={(hovered ? HANDLE_RADIUS_SELECTED : HANDLE_RADIUS) * inv}
              className={
                hovered
                  ? "fill-fuchsia-500 stroke-white"
                  : "fill-white stroke-fuchsia-500"
              }
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              data-vertex={index}
              data-vertex-hovered={hovered || undefined}
            />
          );
        })}

        {region && region.width > 0 && region.height > 0 && (
          <rect
            x={region.x}
            y={region.y}
            width={region.width}
            height={region.height}
            fill="none"
            className="stroke-sky-500 transition-opacity"
            strokeWidth={regionActive ? 2 : 1.5}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
            opacity={regionActive ? 1 : 0.4}
            data-testid="detection-region-outline"
          />
        )}

        <RulerOverlay
          calibration={calibration}
          draft={draftCalibration}
          inv={inv}
        />
      </g>
    </svg>
  );
}

/**
 * The photograph.
 *
 * Memoised on the URL because it is typically a multi-megabyte data URL:
 * re-serialising it into the DOM on every pointermove would stutter badly.
 * `preserveAspectRatio="none"` is safe — and required — because the element's
 * width and height are exactly the working image size, which *is* the outline's
 * coordinate space.
 */
const SourceImage = memo(function SourceImage({
  url,
  width,
  height,
}: {
  url: string;
  width: number;
  height: number;
}) {
  if (width <= 0 || height <= 0) return null;
  return (
    <image
      href={url}
      x={0}
      y={0}
      width={width}
      height={height}
      preserveAspectRatio="none"
    />
  );
});

function RulerOverlay({
  calibration,
  draft,
  inv,
}: {
  calibration: Calibration | null;
  draft: DraftCalibration | null;
  inv: number;
}): JSX.Element | null {
  const start: Point | null = calibration
    ? { x: calibration.startX, y: calibration.startY }
    : draft?.startX !== undefined && draft?.startY !== undefined
      ? { x: draft.startX, y: draft.startY }
      : null;

  const end: Point | null = calibration
    ? { x: calibration.endX, y: calibration.endY }
    : null;

  if (!start) return null;

  return (
    <g>
      {end && (
        <line
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          className="stroke-amber-500"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {[start, end].map((point, index) =>
        point ? (
          <g key={index}>
            {/* An invisible, generously sized hit target: the visible dot is
                too small to grab reliably, especially on a touchscreen. */}
            <circle
              cx={point.x}
              cy={point.y}
              r={RULER_HIT_RADIUS * inv}
              fill="transparent"
              data-ruler-handle={index === 0 ? "start" : "end"}
            />
            <circle
              cx={point.x}
              cy={point.y}
              r={RULER_HANDLE_RADIUS * inv}
              className="fill-amber-500 stroke-background"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ) : null,
      )}
    </g>
  );
}

function ringToPath(ring: readonly Point[]): string {
  if (ring.length === 0) return "";
  const parts = ring.map((p, i) =>
    `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`,
  );
  return `${parts.join(" ")} Z`;
}

export { HANDLE_RADIUS, HANDLE_RADIUS_SELECTED, RULER_HIT_RADIUS };
