import { useCallback, useEffect, useRef, useState } from "react";

import { mmPerPixel } from "@shared/geometry/scale";
import type { Rect } from "@shared/geometry/types";

import { usePanelState } from "@/components/layout/panel-context";
import { WorkspaceLayout } from "@/components/layout/workspace-layout";
import { TraceCanvas } from "@/components/trace/trace-canvas";
import { TraceControlsPanel } from "@/components/trace/trace-controls-panel";
import { useImageSource } from "@/components/trace/use-image-source";
import { useOutlineRefinement } from "@/components/trace/use-outline-refinement";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileUpload } from "@/components/ui/file-upload";
import { useToast } from "@/hooks/use-toast";
import { autoCalibrate } from "@/lib/calibrate/auto-calibrate";
import {
  correctPerspective,
  scalePerspectiveProposal,
  type PerspectiveProposal,
} from "@/lib/calibrate/perspective";
import { SKEW_WARN_FRACTION } from "@/lib/calibrate/solve";
import type { TemplatePaper } from "@/lib/calibrate/template";
import { downloadBlob } from "@/lib/download";
import { generateDXF } from "@/lib/export/dxf";
import { exportScale } from "@/lib/export/scale";
import { generateSTL } from "@/lib/export/stl";
import { generateOutlineSVG } from "@/lib/export/svg";
import { processImage } from "@/lib/image-processor";
import { useTrace } from "@/state/trace-store";

/** The tracing workspace. */
export default function TracePage(): JSX.Element {
  return <TraceWorkspace />;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function imageDataToPngUrl(image: ImageData): string {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create the corrected image preview.");
  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

function TraceWorkspace(): JSX.Element {
  const store = useTrace();
  const { dispatch } = store;
  const activeImageUrlRef = useRef(store.imageUrl);
  activeImageUrlRef.current = store.imageUrl;
  const { toast } = useToast();
  const { panelOpen, setPanelOpen } = usePanelState();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [dwgDialogOpen, setDwgDialogOpen] = useState(false);

  const { source, getImageData, getDetectionFrame } = useImageSource(
    store.imageUrl,
    store.fileName,
  );
  useOutlineRefinement();

  // Publish the working image size once decoding finishes; it is the
  // coordinate space of every point, the ruler, and every export.
  useEffect(() => {
    if (source.status === "ready") {
      dispatch({ type: "SOURCE_READY", imageSize: source.size });
    } else if (source.status === "error") {
      toast({
        title: "Could not open that image",
        description: source.message,
        variant: "destructive",
      });
    }
  }, [source, dispatch, toast]);

  const notice = useCallback(
    (title: string, description: string) => {
      toast({ title, description });
    },
    [toast],
  );

  const runDetection = useCallback(async () => {
    if (source.status !== "ready") return;

    // Tool detection is deliberately gated on an explicit region. Image load
    // may auto-detect scale markers, but it must never trace the calibration
    // sheet, its labels, or the surrounding table as candidate tool geometry.
    const region: Rect | null =
      store.region && store.region.width > 5 && store.region.height > 5
        ? store.region
        : null;
    if (!region) return;

    const imageData = getImageData(region);
    if (!imageData) return;

    dispatch({ type: "SET_PROCESSING", processing: true });
    try {
      const result = await processImage(imageData, {
        region: region
          ? { originalRegion: region, isCropped: true }
          : null,
        margin: store.margin,
        calibration: store.calibration,
        detect: {
          sensitivity: store.sensitivity,
          tolerancePx: store.tolerancePx,
          smoothing: store.smoothing,
        },
        onNotice: notice,
      });

      dispatch({
        type: "DETECTED",
        imageUrl: source.url,
        outline: result.outline,
        rawOutline: result.rawOutline,
        svg: result.svg,
        region,
      });
      // The legacy fire-and-forget POST /api/images is gone (design doc:
      // "opt-in or removed"): nothing ever read the copies back, and silently
      // uploading every trace is the wrong default for local tooling.
    } catch (error) {
      toast({
        title: "Tracing failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      dispatch({ type: "SET_PROCESSING", processing: false });
    }
    // `store.region` is read through a ref-free closure on purpose: the caller
    // decides when a region change should trigger a retrace.
  }, [
    source,
    getImageData,
    dispatch,
    notice,
    toast,
    store.region,
    store.margin,
    store.calibration,
    store.sensitivity,
    store.tolerancePx,
    store.smoothing,
    store.fileName,
  ]);

  /**
   * Marker detection over the full working frame (never the crop — the sheet
   * sits under the tool, outside any region the user drew). `manual` widens
   * the reporting: a click deserves an answer even when nothing is found,
   * and may overwrite an existing scale; the automatic pass on image load
   * stays quiet on the common no-markers case and never clobbers a
   * calibration the user already placed.
   */
  const detectMarkers = useCallback(
    async (manual: boolean) => {
      // Detection reads a higher-resolution frame than the working canvas —
      // small markers blur out at 800×600 — and the found geometry is mapped
      // back into working space, the coordinate space of the calibration.
      const frame = getDetectionFrame();
      if (!frame) return;

      const result = await autoCalibrate(frame.imageData);
      // OpenCV work cannot be cancelled once running. Bind its result to the
      // pixels it actually read so an old sheet can never paint overlays or
      // toasts over a replacement image.
      if (activeImageUrlRef.current !== frame.sourceImageUrl) return;
      if (!manual && result.kind !== "calibrated") {
        dispatch({
          type: "AUTO_CALIBRATION_FAILED",
          sourceImageUrl: frame.sourceImageUrl,
        });
      }
      switch (result.kind) {
        case "calibrated": {
          const calibration = {
            startX: result.calibration.startX * frame.toWorking.x,
            startY: result.calibration.startY * frame.toWorking.y,
            endX: result.calibration.endX * frame.toWorking.x,
            endY: result.calibration.endY * frame.toWorking.y,
            lengthMm: result.calibration.lengthMm,
          };
          dispatch({
            type: "AUTO_CALIBRATION_DETECTED",
            sourceImageUrl: frame.sourceImageUrl,
            calibration,
            perspective: result.perspectiveProposal
              ? scalePerspectiveProposal(
                  result.perspectiveProposal,
                  frame.toWorking.x,
                  frame.toWorking.y,
                )
              : null,
          });
          const { solution } = result;
          const mmPerPx = mmPerPixel(calibration);
          const paperName = result.paper === "a4" ? "A4" : "US Letter";
          const summary = `${paperName} · ${solution.markerIds.length} markers · ${(mmPerPx ?? solution.mmPerPx).toFixed(3)} mm/px`;
          if (solution.maxDeviation > SKEW_WARN_FRACTION) {
            toast({
              title: "Scale detected — review carefully",
              description: `${summary}. Marker distances disagree by ${(solution.maxDeviation * 100).toFixed(1)}%. ${result.perspectiveProposal ? "Perspective correction is available in Scale." : "Shoot straight down for accurate millimetres."}`,
              variant: "destructive",
              duration: 8000,
            });
          } else {
            toast({
              title: "Scale detected from calibration sheet",
              description: `${summary}. Review and accept it in Scale.`,
            });
          }
          break;
        }
        case "foreign-sheet":
          toast({
            title:
              result.reason === "incomplete-signature"
                ? "Incomplete Pocketry sheet detected"
                : result.reason === "invalid-geometry"
                  ? "Calibration sheet rejected"
                  : "Different marker sheet detected",
            description:
              result.reason === "incomplete-signature"
                ? `Pocketry found ${result.markerIds.length} of the 4 required v2 signature markers. Keep the complete current sheet visible and try again.`
                : result.reason === "invalid-geometry"
                  ? "The v2 marker IDs were present, but their 16 corners do not fit Pocketry's signed sheet geometry. No scale was proposed."
                  : "These are stock or third-party markers, not the Pocketry v2 signature. Print the current Pocketry sheet or set scale manually.",
            duration: 8000,
          });
          break;
        case "no-markers":
          if (manual) {
            toast({
              title: "No markers found",
              description:
                "Include the printed calibration sheet in the photo, flat and unobstructed.",
            });
          }
          break;
        case "unsupported":
          if (manual) {
            toast({
              title: "Marker detection unavailable",
              description: "OpenCV failed to load in this browser session.",
              variant: "destructive",
            });
          }
          break;
      }
    },
    [getDetectionFrame, dispatch, toast],
  );

  const applyPerspective = useCallback(
    async (proposal: PerspectiveProposal, paper: TemplatePaper) => {
      const frame = getDetectionFrame();
      if (
        !frame ||
        frame.toWorking.x <= 0 ||
        frame.toWorking.y <= 0
      ) {
        toast({
          title: "Correction unavailable",
          description: "The source image is not ready yet.",
          variant: "destructive",
        });
        return;
      }

      dispatch({ type: "SET_PROCESSING", processing: true });
      try {
        // Canvas points live in working-image coordinates. Correct from the
        // larger marker-detection raster so the warp preserves source detail.
        const detectionProposal = scalePerspectiveProposal(
          proposal,
          1 / frame.toWorking.x,
          1 / frame.toWorking.y,
        );
        const corrected = await correctPerspective(
          frame.imageData,
          detectionProposal,
          paper,
        );
        if (activeImageUrlRef.current !== frame.sourceImageUrl) return;
        const imageUrl = imageDataToPngUrl(corrected.imageData);
        dispatch({
          type: "PERSPECTIVE_APPLIED",
          sourceImageUrl: frame.sourceImageUrl,
          imageUrl,
          imageSize: { width: corrected.width, height: corrected.height },
          calibration: corrected.calibration,
          source: proposal.source,
          paper,
        });
        toast({
          title: "Perspective corrected",
          description: `${paper === "a4" ? "A4" : "US Letter"} plane rectified at ${(1 / corrected.pxPerMm).toFixed(3)} mm/px${corrected.reprojectionErrorPx === null ? "" : ` · ${corrected.reprojectionErrorPx.toFixed(2)} px fit residual`}.`,
        });
      } catch (error) {
        if (activeImageUrlRef.current !== frame.sourceImageUrl) return;
        toast({
          title: "Perspective correction failed",
          description: error instanceof Error ? error.message : String(error),
          variant: "destructive",
          duration: 8000,
        });
      } finally {
        if (activeImageUrlRef.current === frame.sourceImageUrl) {
          dispatch({ type: "SET_PROCESSING", processing: false });
        }
      }
    },
    [getDetectionFrame, dispatch, toast],
  );

  // Attempt auto-calibration once per image, and only while uncalibrated —
  // it must never overwrite a scale the user placed by hand.
  const hasCalibration = store.calibration !== null;
  useEffect(() => {
    if (source.status !== "ready") return;
    if (store.autoCalibrationAttemptedImageUrl === source.url) return;
    dispatch({ type: "AUTO_CALIBRATION_ATTEMPTED", imageUrl: source.url });
    if (hasCalibration) return;
    void detectMarkers(false);
  }, [
    source,
    hasCalibration,
    detectMarkers,
    dispatch,
    store.autoCalibrationAttemptedImageUrl,
  ]);

  const handleFileSelected = (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      toast({
        title: "File too large",
        description: "Please choose an image under 10MB.",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      if (!event.target?.result) return;
      const imageUrl = event.target.result as string;
      // Invalidate outstanding work before React processes the reducer queue;
      // the reducer carries the same guard as the final backstop.
      activeImageUrlRef.current = imageUrl;
      dispatch({
        type: "SOURCE_LOADED",
        imageUrl,
        fileName: file.name.replace(/\.[^/.]+$/, ""),
      });
      setUploadOpen(false);
    };
    reader.readAsDataURL(file);
  };

  const handleExport = async () => {
    const { outline, imageSize, exportFormat, extrusionHeight, fileName } = store;
    if (outline.length === 0) {
      toast({
        title: "Nothing to export",
        description: "Trace an image first.",
        variant: "destructive",
      });
      return;
    }

    const scale = exportScale(store.calibration, imageSize.height);
    const base = fileName || "outline";

    try {
      if (exportFormat === "svg") {
        downloadBlob(
          new Blob(
            [
              generateOutlineSVG(outline, {
                width: imageSize.width,
                height: imageSize.height,
                mmPerPx: scale.mmPerPx,
                calibration: store.calibration,
              }),
            ],
            { type: "image/svg+xml" },
          ),
          `outline_${base}.svg`,
        );
      } else if (exportFormat === "dxf" || exportFormat === "dwg") {
        downloadBlob(
          new Blob([generateDXF(outline, scale)], { type: "application/dxf" }),
          `outline_${base}.${exportFormat}`,
        );
        if (exportFormat === "dwg") {
          toast({
            title: "DWG compatibility file",
            description:
              "A DXF file was saved with a .dwg name; CAD software will open it.",
            duration: 5000,
          });
        }
      } else {
        const stl = await generateSTL(outline, {
          heightMm: extrusionHeight,
          scale,
        });
        downloadBlob(
          new Blob([stl], { type: "application/octet-stream" }),
          `model_${base}.stl`,
        );
      }

      toast({ title: "Saved", description: `Exported as ${exportFormat.toUpperCase()}.` });
    } catch (error) {
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  // Selecting DWG explains the substitution once, when it is chosen.
  const previousFormat = useRef(store.exportFormat);
  useEffect(() => {
    if (store.exportFormat === "dwg" && previousFormat.current !== "dwg") {
      setDwgDialogOpen(true);
    }
    previousFormat.current = store.exportFormat;
  }, [store.exportFormat]);

  const dropzone = (
    <FileUpload onFileSelected={handleFileSelected} className="h-64 w-full max-w-lg" />
  );

  return (
    <>
      <WorkspaceLayout
        autoSaveId="tooltrace:trace"
        panelOpen={panelOpen}
        onPanelOpenChange={setPanelOpen}
        panelTitle="Trace controls"
        panel={
          <TraceControlsPanel
            onReplaceImage={() => setUploadOpen(true)}
            onExport={() => void handleExport()}
            onReprocess={() => void runDetection()}
            onDetectMarkers={() => void detectMarkers(true)}
            onApplyPerspective={(proposal, paper) =>
              void applyPerspective(proposal, paper)
            }
          />
        }
        canvas={
          <TraceCanvas
            onReprocess={() => void runDetection()}
            emptyState={
              <div className="w-full max-w-lg space-y-3 text-center">
                <h2 className="text-lg font-medium">Trace a tool from a photo</h2>
                <p className="text-sm text-muted-foreground">
                  Photograph the tool on a plain background that contrasts with
                  it, and keep the whole tool in frame.
                </p>
                {dropzone}
              </div>
            }
          />
        }
      />

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose Source Image</DialogTitle>
            <DialogDescription>
              Loading a new image clears the current outline, region and scale.
            </DialogDescription>
          </DialogHeader>
          {dropzone}
        </DialogContent>
      </Dialog>

      <Dialog open={dwgDialogOpen} onOpenChange={setDwgDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>About DWG export</DialogTitle>
            <DialogDescription>
              DWG is a proprietary binary format that browsers cannot write.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              Choosing DWG saves a DXF file with a <code>.dwg</code> extension.
              AutoCAD, Fusion 360, FreeCAD and most CAM tools open it without
              complaint, and can re-save it as true DWG.
            </p>
            <p>Choose DXF instead wherever your software accepts it.</p>
          </div>
          <DialogFooter>
            <Button onClick={() => setDwgDialogOpen(false)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
