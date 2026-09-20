import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";

const DISMISSAL_KEY = "pocketry:mobile-development-welcome:v1";
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
export function MobileDevelopmentWelcome(): JSX.Element {
  const isMobile = useIsMobile();
  const [location] = useLocation();
  const [dismissed, setDismissed] = useState(wasDismissed);
  const hasOpened = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const workspace = location === "/" || location === "/bin";
  const open = isMobile && workspace && !dismissed;

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
          if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
        }}
      >
        <DialogHeader>
          <DialogTitle ref={headingRef} tabIndex={-1}>Help improve Pocketry on mobile</DialogTitle>
          <DialogDescription>
            The mobile interface is in early development. We’re looking for feedback
            on what works and what makes tracing or designing bins difficult.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p>Found a problem or have a suggestion? Tell us by email or open a GitHub issue.</p>
          <div className="flex flex-col items-start">
            <a className="inline-flex min-h-11 items-center rounded font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href="mailto:pocketry@sugarcreekresearch.com">Email feedback</a>
            <a className="inline-flex min-h-11 items-center rounded font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href="https://github.com/wcscr/pocketry/issues/new" target="_blank" rel="noopener noreferrer">
              Open a GitHub issue<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
        </div>
        <Button className="min-h-11 w-full" onClick={dismiss}>Continue</Button>
      </DialogContent>
    </Dialog>
  );
}
