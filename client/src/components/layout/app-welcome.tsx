import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowRight, Box, Camera, ScanLine } from "lucide-react";
import { usePanelState } from "./panel-context";
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
    if (open) hasOpened.current = true;
    else if (hasOpened.current && !dismissed) dismiss();
  }, [open, dismissed, dismiss]);

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

          <ol aria-label="From photo to bin" className="my-3 space-y-3 rounded-lg bg-muted/30 p-3 text-[13px] leading-[18px] sm:my-4 sm:p-4 sm:text-sm sm:leading-5">
            <li className="flex gap-3">
              <Camera aria-hidden="true" className="hidden h-5 w-5 shrink-0 text-primary sm:block" />
              <div>
                <h3 className="inline font-semibold">1. Take a photo.</h3>{" "}
                <p className="inline text-muted-foreground">
                  Shoot from above with a scale reference.
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <ScanLine aria-hidden="true" className="hidden h-5 w-5 shrink-0 text-primary sm:block" />
              <div>
                <h3 className="inline font-semibold">2. Trace your tool.</h3>{" "}
                <p className="inline text-muted-foreground">
                  Set the size and refine the outline.
                </p>
                <p className="mt-1 text-muted-foreground">
                  Or skip this and go to step 3 to create an empty bin or one with basic shapes.
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

          <div className="grid grid-cols-2 items-center gap-x-3 text-xs [&_button]:min-h-11 [&_button]:text-left">
            <CalibrationDownloads />
            <button type="button"
              className="min-h-11 rounded text-left font-medium text-primary underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => { setSampleLibraryRequested(true); start("/bin"); }}>
              Open sample projects
            </button>
          </div>
          <p className="mt-1 text-xs leading-4 text-muted-foreground">
            Projects are saved only in this browser. Use <strong>Backups</strong>{" "}
            to keep a copy.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t bg-muted/20 p-3 sm:px-5">
          <Button className="min-h-11 px-2 sm:px-4" onClick={() => start("/")}>
            Start tracing <ArrowRight aria-hidden="true" className="hidden sm:block" />
          </Button>
          <Button variant="outline" className="min-h-11 px-2 sm:px-4" onClick={() => start("/bin")}>
            Design a bin
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
