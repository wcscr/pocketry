import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";

import type { Calibration, DraftCalibration } from "@shared/geometry/scale";
import {
  OUTER_RING,
  type Outline,
  type Point,
  type Rect,
  type RingRef,
} from "@shared/geometry/types";

import { iterateRings, sameRingRef } from "@/lib/geometry/outline";
import { outlineToPathData } from "@/lib/export/svg";

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
  /** Known physical length shown after both manual-ruler points are placed. */
  rulerLengthMm: number;
  /** Enables the on-image reference-length editor after endpoint placement. */
  rulerEditable?: boolean;
  onRulerLengthCommit?: (lengthMm: number) => void;
  /** Template centres or manually selected page corners awaiting correction. */
  perspectivePoints?: readonly Point[];
  /** Manual points remain draggable after all four have been placed. */
  perspectiveEditable?: boolean;
  /** Pointer-following endpoint while manual corner placement is active. */
  perspectivePreview?: Point | null;
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
const RULER_HIT_RADIUS = 18;
const RULER_MARKER_HALF_SIZE = 7;
const RULER_LABEL_OFFSET = 18;
const RULER_LABEL_HEIGHT = 22;
const RULER_LABEL_FONT_SIZE = 12;
const RULER_LABEL_RADIUS = 6;
const RULER_EDITOR_MIN_WIDTH = 96;
const RULER_EDITOR_HEIGHT = 30;
const PERSPECTIVE_MARKER_RADIUS = 10;
const PERSPECTIVE_HIT_RADIUS = 15;

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
  rulerLengthMm,
  rulerEditable = false,
  onRulerLengthCommit,
  perspectivePoints = [],
  perspectiveEditable = false,
  perspectivePreview = null,
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
          rulerLengthMm={rulerLengthMm}
          editable={rulerEditable}
          onLengthCommit={onRulerLengthCommit}
          inv={inv}
        />
        <PerspectiveOverlay
          points={perspectivePoints}
          editable={perspectiveEditable}
          preview={perspectivePreview}
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
  rulerLengthMm,
  editable,
  onLengthCommit,
  inv,
}: {
  calibration: Calibration | null;
  draft: DraftCalibration | null;
  rulerLengthMm: number;
  editable: boolean;
  onLengthCommit?: (lengthMm: number) => void;
  inv: number;
}): JSX.Element | null {
  const start: Point | null = calibration
    ? { x: calibration.startX, y: calibration.startY }
    : draft?.startX !== undefined && draft?.startY !== undefined
      ? { x: draft.startX, y: draft.startY }
      : null;

  const end: Point | null = calibration
    ? { x: calibration.endX, y: calibration.endY }
    : draft?.endX !== undefined && draft?.endY !== undefined
      ? { x: draft.endX, y: draft.endY }
      : null;

  if (!start) return null;

  const lengthMm = calibration?.lengthMm ?? rulerLengthMm;
  const markerHalfSize = RULER_MARKER_HALF_SIZE * inv;

  return (
    <g data-testid="ruler-overlay">
      {end && (
        <>
          <line
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
            className="stroke-white/95"
            strokeWidth={6}
            strokeDasharray={calibration ? undefined : "6 4"}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
          <line
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
            className="stroke-amber-500"
            strokeWidth={2.5}
            strokeDasharray={calibration ? undefined : "6 4"}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
            data-testid="ruler-line"
            data-ruler-preview={calibration ? undefined : "true"}
          />
          {(calibration || editable) && (
            <RulerLengthLabel
              start={start}
              end={end}
              lengthMm={lengthMm}
              editable={editable}
              onLengthCommit={onLengthCommit}
              inv={inv}
            />
          )}
        </>
      )}
      {[start, end].map((point, index) =>
        point ? (
          <g
            key={index}
            data-testid="ruler-marker"
            data-ruler-marker={index === 0 ? "start" : "end"}
            data-ruler-handle={
              calibration ? (index === 0 ? "start" : "end") : undefined
            }
          >
            {calibration && (
              <>
                <title>{`Drag the ${index === 0 ? "start" : "end"} scale point`}</title>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={RULER_HIT_RADIUS * inv}
                  className="cursor-grab fill-transparent stroke-transparent transition-colors hover:fill-amber-500/15 hover:stroke-amber-500/70 active:cursor-grabbing"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  data-testid="ruler-handle-hit-area"
                />
              </>
            )}
            <path
              d={rulerMarkerPath(point, markerHalfSize)}
              fill="none"
              className="stroke-white/95"
              strokeWidth={6}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
            <path
              d={rulerMarkerPath(point, markerHalfSize)}
              fill="none"
              className="stroke-amber-500"
              strokeWidth={2.5}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          </g>
        ) : null,
      )}
    </g>
  );
}

function RulerLengthLabel({
  start,
  end,
  lengthMm,
  editable,
  onLengthCommit,
  inv,
}: {
  start: Point;
  end: Point;
  lengthMm: number;
  editable: boolean;
  onLengthCommit?: (lengthMm: number) => void;
  inv: number;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [editorRect, setEditorRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const labelRef = useRef<SVGGElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, [editing]);

  const startEditing = () => {
    if (!editable) return;
    const bounds = labelRef.current?.getBoundingClientRect();
    const width = Math.max(RULER_EDITOR_MIN_WIDTH, bounds?.width ?? 0);
    const centreX = bounds ? bounds.left + bounds.width / 2 : 0;
    const centreY = bounds ? bounds.top + bounds.height / 2 : 0;
    setEditorRect({
      left: centreX - width / 2,
      top: centreY - RULER_EDITOR_HEIGHT / 2,
      width,
      height: RULER_EDITOR_HEIGHT,
    });
    setEditing(true);
  };

  const finishEditing = (commit: boolean) => {
    if (commit) {
      const value = Number(inputRef.current?.value);
      if (Number.isFinite(value) && value > 0) onLengthCommit?.(value);
    }
    setEditing(false);
    setEditorRect(null);
  };

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  const normal =
    distance > 0 ? { x: -dy / distance, y: dx / distance } : { x: 0, y: -1 };
  const offset = RULER_LABEL_OFFSET * inv;
  const x = (start.x + end.x) / 2 + normal.x * offset;
  const y = (start.y + end.y) / 2 + normal.y * offset;
  const label = `${formatRulerLength(lengthMm)} mm`;
  const displayWidthPx = Math.max(46, label.length * 7 + 14);
  const width = displayWidthPx * inv;
  const height = RULER_LABEL_HEIGHT * inv;

  return (
    <g
      ref={labelRef}
      data-testid="ruler-length-label"
      pointerEvents={editable ? "all" : "none"}
      role={editable ? "button" : undefined}
      tabIndex={editable ? 0 : undefined}
      aria-label={editable ? `Edit reference length, currently ${label}` : undefined}
      style={editable ? { cursor: "text" } : undefined}
      onPointerDown={
        editable
          ? (event) => {
              // Keep a just-focused Reference Length field from blurring on
              // the first half of this double-click. The inline editor takes
              // focus deliberately after the complete gesture.
              event.preventDefault();
              event.stopPropagation();
            }
          : undefined
      }
      onDoubleClick={
        editable
          ? (event) => {
              event.stopPropagation();
              startEditing();
            }
          : undefined
      }
      onKeyDown={
        editable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                startEditing();
              }
            }
          : undefined
      }
    >
      {editable ? <title>Double-click to edit the reference length</title> : null}
      <rect
        x={x - width / 2}
        y={y - height / 2}
        width={width}
        height={height}
        rx={RULER_LABEL_RADIUS * inv}
        className="fill-background/95 stroke-amber-500"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      {editing && editorRect && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed z-[60] flex items-center overflow-hidden rounded-md border border-amber-500 bg-background px-2 text-foreground shadow-md"
              style={{
                left: editorRect.left,
                top: editorRect.top,
                width: editorRect.width,
                height: editorRect.height,
              }}
              data-testid="ruler-length-inline-editor"
            >
              <input
                ref={inputRef}
                type="text"
                inputMode="decimal"
                defaultValue={formatRulerLength(lengthMm)}
                aria-label="Ruler length in millimetres"
                data-testid="ruler-length-inline-input"
                className="h-full min-w-0 flex-1 bg-transparent text-center text-xs font-semibold text-foreground caret-amber-500 outline-none selection:bg-amber-200 selection:text-slate-950"
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onBlur={() => finishEditing(true)}
                onKeyDown={(event) => {
                  // Portal events still bubble through the owning SVG <g> in
                  // React. Stop Enter from reopening the editor immediately.
                  event.stopPropagation();
                  if (event.key === "Enter") {
                    event.preventDefault();
                    finishEditing(true);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    finishEditing(false);
                  }
                }}
              />
              <span
                className="shrink-0 text-[10px] font-medium text-foreground"
                data-testid="ruler-length-inline-unit"
              >
                mm
              </span>
            </div>,
            document.body,
          )
        : null}
      {!editing ? (
        <text
          x={x}
          y={y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={RULER_LABEL_FONT_SIZE * inv}
          className="fill-foreground font-semibold"
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}

function rulerMarkerPath(point: Point, halfSize: number): string {
  return [
    `M ${point.x - halfSize} ${point.y - halfSize}`,
    `L ${point.x + halfSize} ${point.y + halfSize}`,
    `M ${point.x + halfSize} ${point.y - halfSize}`,
    `L ${point.x - halfSize} ${point.y + halfSize}`,
  ].join(" ");
}

function formatRulerLength(lengthMm: number): string {
  return Number.isFinite(lengthMm) ? String(Number(lengthMm.toPrecision(6))) : "—";
}

function PerspectiveOverlay({
  points,
  editable,
  preview,
  inv,
}: {
  points: readonly Point[];
  editable: boolean;
  preview: Point | null;
  inv: number;
}): JSX.Element | null {
  if (points.length === 0) return null;

  const pathPoints =
    preview && points.length < 4 ? [...points, preview] : [...points];
  const path = pathPoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  const closedPath = points.length === 4 ? `${path} Z` : path;
  const previewing = preview !== null && points.length < 4;

  return (
    <g data-testid="perspective-overlay">
      {pathPoints.length > 1 && (
        <>
          <path
            d={closedPath}
            fill={points.length === 4 ? "rgba(14, 165, 233, 0.08)" : "none"}
            className="stroke-white/95"
            strokeWidth={6}
            strokeDasharray={previewing ? "6 4" : undefined}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
          <path
            d={closedPath}
            fill="none"
            className="stroke-sky-500"
            strokeWidth={2.5}
            strokeDasharray={previewing ? "6 4" : undefined}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
            data-testid="perspective-outline"
            data-perspective-preview={previewing || undefined}
          />
        </>
      )}
      {points.map((point, index) => (
        <g
          key={index}
          data-testid="perspective-marker"
          data-perspective-handle={editable ? index : undefined}
        >
          {editable && (
            <circle
              cx={point.x}
              cy={point.y}
              r={PERSPECTIVE_HIT_RADIUS * inv}
              fill="transparent"
            />
          )}
          <circle
            cx={point.x}
            cy={point.y}
            r={PERSPECTIVE_MARKER_RADIUS * inv}
            className="fill-sky-500 stroke-white"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
          <text
            x={point.x}
            y={point.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={11 * inv}
            className="fill-white font-bold"
            pointerEvents="none"
          >
            {index + 1}
          </text>
        </g>
      ))}
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
