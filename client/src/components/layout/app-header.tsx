import {
  CircleHelp,
  Github,
  Info,
  LibraryBig,
  PanelLeftOpen,
  ChevronDown,
  Ellipsis,
  RotateCcw,
  Settings,
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

import { WORKSPACES } from "./workspaces";
import { usePanelState } from "./panel-context";
import { useExperimentalFeatures } from "@/state/experimental-features";

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
 * WorkspaceLayout owns the panel collapse and restore controls.
 */
export function AppHeader({
  onPanelOpenChange,
  onHelpClick,
  onStartOver,
}: AppHeaderProps): JSX.Element {
  const [isAbout] = useRoute("/about");
  const [location] = useLocation();
  const { setLibraryRequested } = usePanelState();
  const { enabled: experimentalEnabled, inspectorEnabled, setSettingsOpen } = useExperimentalFeatures();
  const currentWorkspace = WORKSPACES.find(workspace => workspace.path === location);

  return (
    <>
      <div className="flex shrink-0 items-center">
        <div className="flex gap-2 [align-items:last_baseline]">
          <Link
            href="/"
            aria-label="Pocketry home"
            className="flex shrink-0 items-center rounded-md border-2 border-[#d97514] bg-[#151a20] px-2.5 py-1.5 leading-none text-[#e38225] shadow-[inset_0_0_0_2px_#080c10,inset_0_0_0_3px_#2b333d] transition-colors hover:border-[#ed8a27] hover:text-[#f0983e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span
              className="translate-y-px text-base font-semibold leading-none tracking-[-0.015em]"
              style={{
                fontFamily: BRAND_FONT_FAMILY,
                textShadow: "0 -1px 0 #080c10, 0 1px 0 rgb(255 158 54 / 0.15)",
              }}
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

      <nav className="hidden items-center gap-1 md:ml-4 md:flex" aria-label="Workspaces">
        {WORKSPACES.map((workspace) => (
          <WorkspaceLink key={workspace.path} path={workspace.path}>
            <workspace.icon className="h-4 w-4" aria-hidden />
            {workspace.label}
          </WorkspaceLink>
        ))}
        <Link href="/bin" onClick={() => setLibraryRequested(true)} aria-haspopup="dialog"
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground">
          <LibraryBig className="h-4 w-4" aria-hidden />Library
        </Link>
      </nav>

      <div className="ml-auto flex items-center gap-1 md:hidden">
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
            <DropdownMenuItem asChild className="min-h-11">
              <Link href="/bin" onClick={() => setLibraryRequested(true)} aria-haspopup="dialog">
                <LibraryBig className="mr-2 h-4 w-4" aria-hidden />Library
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" className="h-11 w-11 p-0" aria-label="More options"><Ellipsis className="h-5 w-5" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!isAbout && !(location === "/bin" && inspectorEnabled) && <DropdownMenuItem className="min-h-11" onSelect={() => onPanelOpenChange(true)}><PanelLeftOpen className="mr-2 h-4 w-4" />All settings</DropdownMenuItem>}
            <DropdownMenuItem className="min-h-11" onSelect={() => setSettingsOpen(true)}><Settings className="mr-2 h-4 w-4" />Settings{experimentalEnabled && <span className="ml-auto pl-3 text-xs text-muted-foreground">Experimental on</span>}</DropdownMenuItem>
            <DropdownMenuItem className="min-h-11" onSelect={onHelpClick}><CircleHelp className="mr-2 h-4 w-4" />Help</DropdownMenuItem>
            <DropdownMenuItem asChild className="min-h-11"><Link href="/about"><Info className="mr-2 h-4 w-4" />About Pocketry</Link></DropdownMenuItem>
            {onStartOver && <><DropdownMenuSeparator /><DropdownMenuItem className="min-h-11" onSelect={onStartOver}><RotateCcw className="mr-2 h-4 w-4" />Start over</DropdownMenuItem></>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="ml-auto hidden shrink-0 items-center gap-1 md:flex">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Settings" onClick={() => setSettingsOpen(true)} className="relative">
              <Settings className="h-4 w-4" />
              {experimentalEnabled && <span aria-label="Experimental features enabled" className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-500" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{experimentalEnabled ? "Settings · experimental features on" : "Settings"}</TooltipContent>
        </Tooltip>

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
