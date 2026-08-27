import type { ReactNode } from "react";

export interface AppShellProps {
  /** Contents of the fixed-height top bar. Omit for a chrome-less shell. */
  header?: ReactNode;
  /** Fills every pixel below the header. */
  children: ReactNode;
}

/**
 * Full-viewport application frame: a fixed header over a body that owns all
 * remaining height.
 *
 * The shell itself never scrolls. Scrolling belongs to whatever the body
 * renders (the controls panel, say), so the canvas can assume its box is the
 * viewport minus the header and nothing shifts underneath it.
 */
export function AppShell({ header, children }: AppShellProps): JSX.Element {
  return (
    // h-dvh, not h-screen: on mobile browsers `100vh` includes the retracting
    // URL bar, so h-screen leaves the bottom of the app under it.
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
      {header ? (
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          {header}
        </header>
      ) : null}
      {/*
        min-h-0 is load-bearing. A flex item defaults to `min-height: auto`,
        which refuses to shrink below its content; the canvas would then push
        the shell past 100dvh and bring page scroll back. min-h-0 lets flex-1
        mean "exactly the leftover space".
      */}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
