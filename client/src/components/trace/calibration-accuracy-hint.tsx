import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalibrationDownloads } from "./calibration-downloads";

type OpenMode = "hover" | "explicit" | null;

/** Optional guidance opens on hover or deliberate activation, never focus alone. */
export function CalibrationAccuracyHint({ children }: { children?: ReactNode }): JSX.Element {
  const [mode, setMode] = useState<OpenMode>(null);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const modeRef = useRef<OpenMode>(null);
  const lastOpenMode = useRef<OpenMode>(null);
  const downloadsOpening = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const descriptionId = useId();

  const clearTimer = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  const changeMode = (next: OpenMode) => {
    clearTimer();
    modeRef.current = next;
    if (next) lastOpenMode.current = next;
    setMode(next);
  };
  const leaveHover = () => {
    clearTimer();
    if (modeRef.current === "hover") {
      // Allow the pointer to cross the small gap into the interactive content.
      timer.current = setTimeout(() => changeMode(null), 200);
    }
  };

  useEffect(() => () => clearTimer(), []);
  useEffect(() => {
    if (downloadsOpen || !downloadsOpening.current) return;
    downloadsOpening.current = false;
    // The download dialog has no DialogTrigger of its own. Restore focus only
    // after its modal focus trap has unmounted.
    const frame = requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [downloadsOpen]);

  return (
    <>
      <div className="border-t border-amber-400/30 pt-2">
        <Popover open={mode !== null} onOpenChange={(open) => { if (!open) changeMode(null); }}>
          <PopoverTrigger asChild>
            <button
              ref={triggerRef}
              type="button"
              className="inline-flex items-center gap-1.5 rounded text-left text-xs text-amber-700 hover:text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:text-amber-300 dark:hover:text-amber-200 [@media(pointer:coarse)]:min-h-11"
              onPointerEnter={(event) => {
                if (event.pointerType === "touch" || downloadsOpening.current) return;
                clearTimer();
                if (!modeRef.current) timer.current = setTimeout(() => changeMode("hover"), 250);
              }}
              onPointerLeave={leaveHover}
              onClick={(event) => {
                // Override the default toggle so clicking a hover-open hint
                // pins it open. Native button activation covers Enter/Space.
                event.preventDefault();
                const next = modeRef.current === "explicit" ? null : "explicit";
                changeMode(next);
                if (next) contentRef.current?.focus({ preventScroll: true });
              }}
            >
              <CircleAlert aria-hidden="true" className="h-4 w-4 shrink-0" />
              Accuracy with thick objects
            </button>
          </PopoverTrigger>
          <PopoverContent
            ref={contentRef}
            side="top"
            align="start"
            collisionPadding={12}
            tabIndex={-1}
            aria-label="Accuracy with thick objects"
            aria-describedby={descriptionId}
            className="max-h-[min(28rem,var(--radix-popover-content-available-height))] max-w-[calc(100vw-1.5rem)] space-y-2 overflow-y-auto text-xs leading-relaxed"
            onPointerEnter={clearTimer}
            onPointerLeave={leaveHover}
            onFocusCapture={() => { if (modeRef.current === "hover") changeMode("explicit"); }}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              if (modeRef.current === "explicit") contentRef.current?.focus({ preventScroll: true });
            }}
            onCloseAutoFocus={(event) => {
              if (lastOpenMode.current === "hover" || downloadsOpening.current) event.preventDefault();
            }}
          >
            <div id={descriptionId} className="space-y-2">
              {children}
              <p>
                Automatic calibration is most accurate at the reference’s height.
                Raised parts of thick objects can appear oversized when using paper
                markers because they are closer to the camera. For better accuracy,
                place a measurement aid at the feature’s height, or set scale manually
                from a measured long feature on the tool.
              </p>
            </div>
            <button type="button"
              className="font-medium underline underline-offset-2 hover:no-underline [@media(pointer:coarse)]:min-h-11"
              onClick={() => {
                downloadsOpening.current = true;
                changeMode(null);
                setDownloadsOpen(true);
              }}>
              Download measurement aids
            </button>
          </PopoverContent>
        </Popover>
      </div>
      <CalibrationDownloads open={downloadsOpen} onOpenChange={setDownloadsOpen} showLink={false} />
    </>
  );
}
