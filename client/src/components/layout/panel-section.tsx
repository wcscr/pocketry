import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export interface PanelSectionProps {
  /** Header label. Truncates rather than wrapping in a narrow panel. */
  title: string;
  icon?: LucideIcon;
  defaultOpen?: boolean;
  /** Greys the header and blocks toggling — e.g. before an image is loaded. */
  disabled?: boolean;
  children: ReactNode;
  className?: string;
  /** Optional DOM target for a panel's quick-navigation controls. */
  id?: string;
  /** A short current-value cue shown beside the title. */
  summary?: ReactNode;
  /** Restrained semantic accent used to distinguish settings categories. */
  tone?: PanelTone;
  /** Briefly draws the eye to the next section in a guided workflow. */
  attention?: boolean;
}

export type PanelTone =
  | "slate"
  | "blue"
  | "violet"
  | "amber"
  | "rose"
  | "emerald";

const TONE_STYLES = {
  slate: {
    marker: "bg-slate-400 dark:bg-slate-500",
    icon: "text-slate-600 dark:text-slate-300",
    open: "data-[state=open]:bg-slate-500/5",
    summary: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
    index:
      "bg-slate-500/5 text-slate-700 hover:bg-slate-500/10 dark:text-slate-300",
  },
  blue: {
    marker: "bg-blue-500",
    icon: "text-blue-600 dark:text-blue-400",
    open: "data-[state=open]:bg-blue-500/5",
    summary: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    index: "bg-blue-500/5 text-blue-700 hover:bg-blue-500/10 dark:text-blue-300",
  },
  violet: {
    marker: "bg-violet-500",
    icon: "text-violet-600 dark:text-violet-400",
    open: "data-[state=open]:bg-violet-500/5",
    summary: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
    index:
      "bg-violet-500/5 text-violet-700 hover:bg-violet-500/10 dark:text-violet-300",
  },
  amber: {
    marker: "bg-amber-500",
    icon: "text-amber-600 dark:text-amber-400",
    open: "data-[state=open]:bg-amber-500/5",
    summary: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    index:
      "bg-amber-500/5 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300",
  },
  rose: {
    marker: "bg-rose-500",
    icon: "text-rose-600 dark:text-rose-400",
    open: "data-[state=open]:bg-rose-500/5",
    summary: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
    index: "bg-rose-500/5 text-rose-700 hover:bg-rose-500/10 dark:text-rose-300",
  },
  emerald: {
    marker: "bg-emerald-500",
    icon: "text-emerald-600 dark:text-emerald-400",
    open: "data-[state=open]:bg-emerald-500/5",
    summary: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    index:
      "bg-emerald-500/5 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300",
  },
} as const;

/**
 * A collapsible group of controls inside the workspace panel.
 *
 * Deliberately not a `<Card>`: the panel is only ~300px wide, and a card's
 * padding plus border on both sides eats roughly 32px of that — enough to force
 * sliders and number inputs onto extra lines. A flat section with a bottom
 * border gives the same visual grouping for zero horizontal cost.
 */
export function PanelSection({
  title,
  icon: Icon,
  defaultOpen = true,
  disabled = false,
  children,
  className,
  id,
  summary,
  tone,
  attention = false,
}: PanelSectionProps): JSX.Element {
  const toneStyles = tone ? TONE_STYLES[tone] : null;
  return (
    <Collapsible
      id={id}
      defaultOpen={defaultOpen}
      disabled={disabled}
      data-tone={tone}
      className={cn("border-b", className)}
    >
      <CollapsibleTrigger
        data-panel-section-trigger
        className={cn(
          "group relative flex w-full items-center gap-2 overflow-hidden px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          attention &&
            "animate-[pulse_1s_ease-in-out_3] motion-reduce:animate-none",
          toneStyles?.open,
        )}
      >
        {toneStyles ? (
          <span
            aria-hidden
            className={cn(
              "absolute inset-y-1.5 left-0 w-0.5 rounded-r-full",
              toneStyles.marker,
            )}
          />
        ) : null}
        {Icon ? (
          <Icon
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground",
              toneStyles?.icon,
            )}
          />
        ) : null}
        {/* min-w-0 lets truncate actually engage; without it the text sets a
            min-content floor and widens the whole panel. */}
        <span className="min-w-0 flex-1 truncate text-left">{title}</span>
        {summary ? (
          <span
            className={cn(
              "max-w-24 shrink-0 truncate rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground",
              toneStyles?.summary,
            )}
          >
            {summary}
          </span>
        ) : null}
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-3 pb-3">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export interface PanelSettingsIndexItem {
  id: string;
  label: string;
  tone: PanelTone;
  /** Keeps unavailable workflow steps visible while explaining their order. */
  disabled?: boolean;
  disabledReason?: string;
}

export interface PanelSettingsIndexProps {
  ariaLabel: string;
  /** Used for stable test hooks, e.g. `bin` or `trace`. */
  testIdPrefix: string;
  items: readonly PanelSettingsIndexItem[];
}

/**
 * Persistent map for a long settings panel.
 *
 * It opens the requested section and scrolls only PanelBody. Native
 * `scrollIntoView()` also scrolls a mobile drawer ancestor, which can carry the
 * map itself behind the drawer's clipped top edge.
 */
export function PanelSettingsIndex({
  ariaLabel,
  testIdPrefix,
  items,
}: PanelSettingsIndexProps): JSX.Element {
  const revealSection = (id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    const scroller = target.parentElement;

    // The index is a focused navigator, not just an anchor list: close every
    // sibling before opening the requested section so its final offset is
    // deterministic and only the chosen settings remain in view.
    for (const item of items) {
      const section = document.getElementById(item.id);
      if (
        section &&
        section !== target &&
        section.parentElement === scroller &&
        section.dataset.state === "open"
      ) {
        section
          .querySelector<HTMLButtonElement>("[data-panel-section-trigger]")
          ?.click();
      }
    }
    if (target.dataset.state === "closed") {
      target
        .querySelector<HTMLButtonElement>("[data-panel-section-trigger]")
        ?.click();
    }

    const scroll = () => {
      if (!scroller) return;
      // Browsers otherwise clamp the final sections below the top because
      // there is not enough content beneath them. Add only the blank space
      // required for the selected heading to reach the scroller's top edge.
      scroller.style.paddingBottom = `${scroller.clientHeight}px`;
      // offsetTop is relative to the nearest positioned ancestor, which is the
      // whole panel rather than PanelBody. Convert the live rectangles into a
      // scroll-content coordinate so the heading lands at PanelBody's visible
      // top instead of disappearing behind the settings index.
      const targetTop =
        scroller.scrollTop +
        target.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top;
      // A full-pane reserve guarantees that even the final short section can
      // reach the top; calculated minimums are vulnerable to scroll anchoring
      // while sibling collapsibles unmount. Assign scrollTop directly so the
      // browser cannot animate or clamp an intermediate position.
      scroller.scrollTop = targetTop;
      scroller?.scrollTo?.({ top: targetTop, behavior: "auto" });
      const alignSelectedHeading = () => {
        const remainingOffset =
          target.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top;
        if (Math.abs(remainingOffset) > 0.5) {
          scroller.scrollTop += remainingOffset;
        }
      };
      // Scroll anchoring and collapsible content can adjust the pane just
      // after scrollTo. Correct against the actual rendered rectangles for
      // the following two frames so the result is exact.
      window.requestAnimationFrame(() => {
        alignSelectedHeading();
        window.requestAnimationFrame(alignSelectedHeading);
      });
    };
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => window.requestAnimationFrame(scroll));
    } else {
      scroll();
    }
  };

  return (
    <nav
      aria-label={ariaLabel}
      className="z-20 shrink-0 border-b bg-background/95 px-3 py-2 backdrop-blur"
      data-testid={`${testIdPrefix}-settings-index`}
    >
      <div className="mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Find a setting
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {items.map((item) => {
          const styles = TONE_STYLES[item.tone];
          return (
            <button
              key={item.id}
              type="button"
              className={cn(
                "flex min-w-0 items-center gap-1.5 rounded px-2 py-1 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40",
                styles.index,
              )}
              aria-controls={item.id}
              disabled={item.disabled}
              title={item.disabled ? item.disabledReason : undefined}
              onClick={() => revealSection(item.id)}
              data-testid={`${testIdPrefix}-settings-jump-${item.label
                .toLowerCase()
                .replace(/\s+/g, "-")}`}
            >
              <span
                aria-hidden
                className={cn("h-1.5 w-1.5 shrink-0 rounded-full", styles.marker)}
              />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export interface PanelSlotProps {
  children: ReactNode;
  className?: string;
}

/**
 * Scrolling region of a panel. Pair with a `flex h-full flex-col` panel root so
 * the sections scroll while the footer stays put.
 */
export function PanelBody({ children, className }: PanelSlotProps): JSX.Element {
  // min-h-0 for the same reason as in AppShell: without it this flex item will
  // not shrink below its content, and the scrollbar never appears.
  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto", className)}>
      {children}
    </div>
  );
}

/** Pinned action row at the bottom of a panel (export buttons, reset, ...). */
export function PanelFooter({
  children,
  className,
}: PanelSlotProps): JSX.Element {
  return (
    <div className={cn("shrink-0 border-t bg-background p-3", className)}>
      {children}
    </div>
  );
}
