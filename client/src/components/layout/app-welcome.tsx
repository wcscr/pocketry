import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Settings } from "lucide-react";
import { useExperimentalFeatures } from "@/state/experimental-features";
import { useIsMobile } from "@/hooks/use-mobile";

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
  const isMobile = useIsMobile();
  const { setSettingsOpen } = useExperimentalFeatures();
  const openingSettings = useRef(false);
  const [location] = useLocation();
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

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) dismiss(); }}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto [&>button:last-child]:h-11 [&>button:last-child]:w-11"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          // Keep the introduction visible even when the dialog must scroll.
          headingRef.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!openingSettings.current && returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
        }}
      >
        <DialogHeader>
          <DialogTitle ref={headingRef} tabIndex={-1}>Welcome to Pocketry</DialogTitle>
          <DialogDescription>
            Choose your layout and optional tools in App settings.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p><strong>Keep your work:</strong> Projects are saved only in this browser. Use Backups above the workspace to download a copy before clearing browser data or moving to another device.</p>
          <p><strong>Layouts:</strong> “Workflow + properties” is the desktop default for photo tracing and bin design. Switch back to “Original Single Panel UI” in App settings. Phones keep compact adjustments.</p>
          <p><strong>Object tools:</strong> Move, rotate, select multiple objects, align, and distribute in either layout.</p>
          <p><strong>Experimental features:</strong> Opt in to adjustable walls for empty bins, removable lids, surface text, system fonts, and linked designs.</p>
          {isMobile && <p className="border-t pt-3 text-xs text-muted-foreground">
            The mobile interface is still being refined.{" "}
            <a className="rounded text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href="https://github.com/wcscr/pocketry/issues/new" target="_blank" rel="noopener noreferrer">
              Share feedback on GitHub<span className="sr-only"> (opens in a new tab)</span>
            </a>.
          </p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={dismiss}>Continue</Button>
          <Button size="sm" onClick={() => {
            openingSettings.current = true;
            dismiss();
            setSettingsOpen(true);
          }}><Settings aria-hidden="true" />Open App settings</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
