import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Box, Camera, ScanLine } from "lucide-react";
import { usePanelState } from "./panel-context";
import { StartDesignActions } from "./start-design-actions";
import { CalibrationDownloads } from "@/components/trace/calibration-downloads";

const DISMISSAL_KEY = "pocketry:welcome:1.1.1";
let dismissedThisSession = false;

function wasDismissed(): boolean {
  if (dismissedThisSession) return true;
  try {
    return window.localStorage.getItem(DISMISSAL_KEY) === "dismissed";
  } catch {
    // Private browsing and blocked storage must not prevent using the app.
    return false;
  }
}

/** One welcome per browser; blocked storage falls back to this page session. */
export function AppWelcome(): JSX.Element {
  const [location, navigate] = useLocation();
  const { setSampleLibraryRequested } = usePanelState();
  const [dismissed, setDismissed] = useState(wasDismissed);
  const hasOpened = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const workspace = location === "/" || location === "/bin";
  const open = workspace && !dismissed;

  const dismiss = useCallback(() => {
    dismissedThisSession = true;
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISSAL_KEY, "dismissed");
    } catch {
      // The session flag still prevents repeated interruptions after navigation.
    }
  }, []);

  useEffect(() => {
    // The explicit fixture entry supplies its own first step, including after
    // replacing /ultim8 with /bin. Do not interrupt it with a second welcome.
    if (location.replace(/\/$/, "") === "/ultim8") dismiss();
    if (open) hasOpened.current = true;
    else if (hasOpened.current && !dismissed) dismiss();
  }, [open, dismissed, dismiss, location]);

  const start = (path: "/" | "/bin") => {
    dismiss();
    if (location !== path) navigate(path);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) dismiss(); }}>
      <DialogContent
        className="max-w-2xl gap-0 rounded-lg p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          // Start with the introduction rather than jumping to an action.
          headingRef.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
        }}
      >
        <div className="p-3 sm:p-5">
          <DialogHeader className="space-y-1.5 pr-0">
            <DialogTitle ref={headingRef} tabIndex={-1} className="pr-9 text-xl leading-6 outline-none sm:text-2xl sm:leading-7">
              Welcome to Pocketry
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-[18px] sm:text-sm sm:leading-5">
              Design custom Gridfinity or flat-bottom bins, or create templates for laser etching and UV printing.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4">
            <StartDesignActions
              onTracePhoto={() => start("/")}
              onDesignBin={() => start("/bin")}
              onOpenSamples={() => { setSampleLibraryRequested(true); start("/bin"); }} />
          </div>

          <details className="text-sm">
            <summary className="w-fit cursor-pointer rounded py-2 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">How photo tracing works</summary>
            <ol aria-label="From photo to bin" className="my-3 space-y-3 rounded-lg bg-muted/30 p-3 text-[13px] leading-[18px] sm:my-4 sm:p-4 sm:text-sm sm:leading-5">
              <li className="flex gap-3">
                <Camera aria-hidden="true" className="hidden h-5 w-5 shrink-0 text-primary sm:block" />
                <div>
                  <h3 className="inline font-semibold">1. Take a photo.</h3>{" "}
                  <p className="inline text-muted-foreground">
                    Put your tool on a plain, contrasting background and photograph from above. Use optional calibration sheets or aids to assist in auto scale detection.
                  </p>
                </div>
              </li>
              <li className="flex gap-3">
                <ScanLine aria-hidden="true" className="hidden h-5 w-5 shrink-0 text-primary sm:block" />
                <div>
                  <h3 className="inline font-semibold">2. Trace your tool.</h3>{" "}
                  <p className="inline text-muted-foreground">
                    Set the scale and refine the outline.
                  </p>
                </div>
              </li>
              <li className="flex gap-3">
                <Box aria-hidden="true" className="hidden h-5 w-5 shrink-0 text-primary sm:block" />
                <div>
                  <h3 className="inline font-semibold">3. Make it fit.</h3>{" "}
                  <p className="inline text-muted-foreground">
                    Arrange, check fit, and export.
                  </p>
                </div>
              </li>
            </ol>

            <div className="text-xs [&_button]:min-h-11 [&_button]:text-left">
              <CalibrationDownloads />
            </div>
          </details>
          <p className="mt-1 text-xs leading-4 text-muted-foreground">
            Projects are saved only in this browser. Use <strong>Export project</strong>{" "}
            in Bin to keep a copy.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
