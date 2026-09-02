import { useCallback, useEffect, useRef, useState } from "react";

import type { Rect } from "@shared/geometry/types";

/**
 * Owns image decoding and the offscreen canvas that pixels are read from.
 *
 * Extracted from `image-preview.tsx`, where the same logic sat inside an effect
 * with three defects this hook fixes: no `onerror` handler (a corrupt file left
 * the spinner up forever), no cancellation (a fast second upload could have its
 * `onload` clobbered by the first), and a hidden `<canvas>` in the JSX tree
 * that had no reason to be rendered at all.
 */

export interface Size {
  width: number;
  height: number;
}

/**
 * The working resolution cap.
 *
 * **This is the coordinate space of every outline point, the ruler
 * calibration, and every export.** It must never be derived from the display
 * or container size: doing so would silently change exported dimensions with no
 * on-screen symptom. Raising it is a deliberate, separate change that
 * invalidates saved calibrations.
 */
export const IMAGE_CANVAS_MAX: Size = { width: 800, height: 600 };

export type ImageSource =
  | { status: "empty" }
  | { status: "loading"; url: string; fileName: string }
  | {
      status: "ready";
      url: string;
      fileName: string;
      size: Size;
      /** Natural dimensions of the decoded file, before the cap. */
      naturalSize: Size;
    }
  | { status: "error"; url: string; fileName: string; message: string };

/**
 * The marker-detection resolution cap. ArUco markers that photograph at
 * ~50 px in the 800×600 working frame drop below the detector's module
 * resolution, so detection reads a larger rasterisation of the same photo
 * and maps its coordinates back into working space. This cap affects only
 * detection accuracy — never the coordinate space of outlines or exports.
 */
export const DETECTION_CANVAS_MAX: Size = { width: 1600, height: 1600 };

export interface DetectionFrame {
  imageData: ImageData;
  /** Exact per-axis mapping from rounded detection pixels to working pixels. */
  toWorking: { x: number; y: number };
  /** Provenance used to reject a result after the user replaces the image. */
  sourceImageUrl: string;
}

export interface DecodedImageFile {
  imageUrl: string;
  naturalSize: Size;
}

/**
 * Reads and validates an image before it replaces the current Trace source.
 *
 * Keeping this separate from {@link useImageSource} lets replacement commit
 * its URL and dimensions together. A slow or invalid second file therefore
 * cannot clear a perfectly usable first photo and leave the drop zone behind.
 */
export function decodeImageFile(file: File): Promise<DecodedImageFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("That file could not be read as an image."));
        return;
      }

      const imageUrl = reader.result;
      const image = new Image();
      image.onerror = () =>
        reject(new Error("That file could not be decoded as an image."));
      image.onload = () => {
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        if (width <= 0 || height <= 0) {
          reject(new Error("That image has invalid dimensions."));
          return;
        }
        resolve({ imageUrl, naturalSize: { width, height } });
      };
      image.src = imageUrl;
    };
    reader.readAsDataURL(file);
  });
}

/** Sizes the detection frame and the factor back into working space. */
export function detectionGeometry(
  natural: Size,
  max: Size = IMAGE_CANVAS_MAX,
  detectMax: Size = DETECTION_CANVAS_MAX,
): { detect: Size; toWorking: { x: number; y: number } } {
  const working = fitWithin(natural, max);
  const detect = fitWithin(natural, detectMax);
  return {
    detect,
    toWorking: {
      x: working.width / detect.width,
      y: working.height / detect.height,
    },
  };
}

export interface UseImageSourceResult {
  source: ImageSource;
  /**
   * Pixels for the whole working image, or for `region` within it.
   * Returns `null` until the image is ready.
   */
  getImageData(region?: Rect | null): ImageData | null;
  /**
   * The full frame at detection resolution ({@link DETECTION_CANVAS_MAX}),
   * or `null` until the image is ready.
   */
  getDetectionFrame(): DetectionFrame | null;
}

/** Fits `natural` inside `max` without changing its aspect ratio. */
export function fitWithin(natural: Size, max: Size): Size {
  let { width, height } = natural;
  if (width > max.width) {
    height = (max.width / width) * height;
    width = max.width;
  }
  if (height > max.height) {
    width = (max.height / height) * width;
    height = max.height;
  }
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

export function useImageSource(
  url: string | null,
  fileName = "",
  max: Size = IMAGE_CANVAS_MAX,
): UseImageSourceResult {
  const [source, setSource] = useState<ImageSource>({ status: "empty" });
  // Created imperatively: it is a pixel buffer, not part of the view.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // The decoded element outlives its load handler so detection can re-raster
  // the photo at a higher resolution than the working canvas.
  const imageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    // A render can briefly still expose the previous ready state before this
    // effect publishes "loading". Clear the decoded pixel source first so no
    // caller can start another request against the previous image.
    imageRef.current = null;
    if (!url) {
      setSource({ status: "empty" });
      return;
    }

    setSource({ status: "loading", url, fileName });

    // Guards against a second upload resolving before the first: the stale
    // handler must not overwrite the newer image.
    let cancelled = false;

    const image = new Image();

    image.onload = () => {
      if (cancelled) return;

      const naturalSize = { width: image.width, height: image.height };
      const size = fitWithin(naturalSize, max);

      const canvas = canvasRef.current ?? document.createElement("canvas");
      canvasRef.current = canvas;
      canvas.width = size.width;
      canvas.height = size.height;

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        setSource({
          status: "error",
          url,
          fileName,
          message: "Could not create a 2D drawing context.",
        });
        return;
      }

      ctx.drawImage(image, 0, 0, size.width, size.height);
      imageRef.current = image;
      setSource({ status: "ready", url, fileName, size, naturalSize });
    };

    image.onerror = () => {
      if (cancelled) return;
      imageRef.current = null;
      setSource({
        status: "error",
        url,
        fileName,
        message: "That file could not be decoded as an image.",
      });
    };

    image.src = url;

    return () => {
      cancelled = true;
    };
  }, [url, fileName, max]);

  const getImageData = useCallback(
    (region?: Rect | null): ImageData | null => {
      const canvas = canvasRef.current;
      if (!canvas || source.status !== "ready") return null;

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;

      if (!region || region.width <= 0 || region.height <= 0) {
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
      }

      // Clamp so a region dragged past the edge cannot ask for pixels that do
      // not exist.
      const x = Math.max(0, Math.min(Math.round(region.x), canvas.width - 1));
      const y = Math.max(0, Math.min(Math.round(region.y), canvas.height - 1));
      const width = Math.max(1, Math.min(Math.round(region.width), canvas.width - x));
      const height = Math.max(1, Math.min(Math.round(region.height), canvas.height - y));

      return ctx.getImageData(x, y, width, height);
    },
    [source],
  );

  const getDetectionFrame = useCallback((): DetectionFrame | null => {
    const image = imageRef.current;
    if (!image || source.status !== "ready") return null;

    const { detect, toWorking } = detectionGeometry(source.naturalSize, max);
    const canvas = document.createElement("canvas");
    canvas.width = detect.width;
    canvas.height = detect.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(image, 0, 0, detect.width, detect.height);
    return {
      imageData: ctx.getImageData(0, 0, detect.width, detect.height),
      toWorking,
      sourceImageUrl: source.url,
    };
  }, [source, max]);

  return { source, getImageData, getDetectionFrame };
}
