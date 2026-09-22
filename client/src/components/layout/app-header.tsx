import {
  CircleHelp,
  Github,
  Info,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  Ellipsis,
  RotateCcw,
} from "lucide-react";
import { Link, useLocation, useRoute } from "wouter";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useIsMobile } from "@/hooks/use-mobile";
import { MobileFeedbackLink } from "./mobile-feedback-link";

import { WORKSPACES } from "./workspaces";

const BRAND_FONT_FAMILY =
  'Rockwell, "American Typewriter", "Courier New", ui-serif, serif';

export interface AppHeaderProps {
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
  onHelpClick: () => void;
  onStartOver?: () => void;
}

/**
 * The header above every workspace: branding, workspace nav, and the
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
  onStartOver,
}: AppHeaderProps): JSX.Element {
  const isMobile = useIsMobile();
  const [isAbout] = useRoute("/about");
  const [location] = useLocation();
  const currentWorkspace = WORKSPACES.find(workspace => workspace.path === location);

  return (
    <>
      <div className="flex shrink-0 items-center">
        <div className="flex gap-2 [align-items:last_baseline]">
          <Link
            href="/"
            aria-label="Pocketry home"
            className="group flex shrink-0 flex-col items-center rounded-sm leading-none hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span className="text-[9px] font-medium tracking-wide text-muted-foreground/70 line-through decoration-muted-foreground/60 group-hover:text-muted-foreground">
              ToolTrace
            </span>
            <span
              className="text-base font-semibold tracking-[-0.015em]"
              style={{ fontFamily: BRAND_FONT_FAMILY }}
            >
              Pocketry
            </span>
          </Link>
          <span
            className="text-[10px] italic text-muted-foreground/80"
            style={{ fontFamily: BRAND_FONT_FAMILY }}
          >
            by
          </span>
        </div>
        <a
          href="https://sugarcreekresearch.com"
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-sm transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <img
            src="/sugarcreek-research-logo.png"
            alt="Sugarcreek Research, LLC"
            width={32}
            height={32}
            className="h-8 w-8 object-contain dark:invert"
          />
        </a>
      </div>

      <nav className={cn("items-center gap-1 ml-4", isMobile ? "hidden" : "flex")} aria-label="Workspaces">
        {WORKSPACES.map((workspace) => (
          <WorkspaceLink key={workspace.path} path={workspace.path}>
            <workspace.icon className="h-4 w-4" aria-hidden />
            {workspace.label}
          </WorkspaceLink>
        ))}
      </nav>

      <div className={cn("ml-auto items-center gap-1", isMobile ? "flex" : "hidden")}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-11 gap-1 px-2" aria-label={`Workspace: ${currentWorkspace?.label ?? "About"}`}>
              {currentWorkspace?.label ?? "About"}<ChevronDown className="h-4 w-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {WORKSPACES.map(workspace => <DropdownMenuItem key={workspace.path} asChild className="min-h-11">
              <Link href={workspace.path} aria-current={location === workspace.path ? "page" : undefined} onClick={() => onPanelOpenChange(false)}>
                <workspace.icon className="mr-2 h-4 w-4" aria-hidden />{workspace.label}
              </Link>
            </DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" className="h-11 w-11 p-0" aria-label="More options"><Ellipsis className="h-5 w-5" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!isAbout && <DropdownMenuItem className="min-h-11" onSelect={() => onPanelOpenChange(true)}><PanelLeftOpen className="mr-2 h-4 w-4" />All settings</DropdownMenuItem>}
            <DropdownMenuItem className="min-h-11" onSelect={onHelpClick}><CircleHelp className="mr-2 h-4 w-4" />Help</DropdownMenuItem>
            <DropdownMenuItem asChild className="min-h-11"><Link href="/about"><Info className="mr-2 h-4 w-4" />About Pocketry</Link></DropdownMenuItem>
            <MobileFeedbackLink />
            {onStartOver && <><DropdownMenuSeparator /><DropdownMenuItem className="min-h-11" onSelect={onStartOver}><RotateCcw className="mr-2 h-4 w-4" />Start over</DropdownMenuItem></>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className={cn("ml-auto shrink-0 items-center gap-1", isMobile ? "hidden" : "flex")}>
        {!isAbout ? (
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
        ) : null}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild variant={isAbout ? "secondary" : "ghost"} size="icon">
              <Link href="/about" aria-label="About Pocketry">
                <Info className="h-4 w-4" />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>About, licenses, and related projects</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild variant="ghost" size="icon" className="hidden sm:inline-flex">
              <a
                href="https://github.com/wcscr/pocketry"
                target="_blank"
                rel="noreferrer"
                aria-label="Pocketry on GitHub"
              >
                <Github className="h-4 w-4" />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent>View Pocketry on GitHub</TooltipContent>
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
