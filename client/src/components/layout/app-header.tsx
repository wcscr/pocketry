import { CircleHelp, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Link, useRoute } from "wouter";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { WORKSPACES } from "./workspaces";

export interface AppHeaderProps {
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
  onHelpClick: () => void;
}

/**
 * The single row above every workspace: wordmark, workspace nav, and the
 * controls that do not belong to any one canvas.
 *
 * The panel toggle lives here rather than in the panel itself because
 * `WorkspaceLayout` persists its collapsed state in localStorage — without an
 * always-visible way back, a user who collapses the panel finds it missing on
 * their next visit with no obvious way to restore it.
 */
export function AppHeader({
  panelOpen,
  onPanelOpenChange,
  onHelpClick,
}: AppHeaderProps): JSX.Element {
  return (
    <>
      <Link
        href="/"
        aria-label="Pocketry home"
        className="group flex flex-col items-center rounded-sm leading-none hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <span className="text-[9px] font-medium tracking-wide text-muted-foreground/70 line-through decoration-muted-foreground/60 group-hover:text-muted-foreground">
          ToolTrace
        </span>
        <span
          className="text-base font-semibold tracking-[-0.015em]"
          style={{
            fontFamily:
              'Rockwell, "American Typewriter", "Courier New", ui-serif, serif',
          }}
        >
          Pocketry
        </span>
      </Link>

      <nav className="ml-4 flex items-center gap-1">
        {WORKSPACES.map((workspace) => (
          <WorkspaceLink key={workspace.path} path={workspace.path}>
            <workspace.icon className="h-4 w-4" aria-hidden />
            {workspace.label}
          </WorkspaceLink>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onPanelOpenChange(!panelOpen)}
              aria-label={panelOpen ? "Hide controls" : "Show controls"}
              aria-pressed={panelOpen}
            >
              {panelOpen ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeftOpen className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {panelOpen ? "Hide controls" : "Show controls"} ([)
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onHelpClick}
              aria-label="Help"
            >
              <CircleHelp className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>How to use Pocketry</TooltipContent>
        </Tooltip>
      </div>
    </>
  );
}

function WorkspaceLink({
  path,
  children,
}: {
  path: string;
  children: React.ReactNode;
}): JSX.Element {
  const [isActive] = useRoute(path);
  return (
    <Link
      href={path}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
        isActive
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
