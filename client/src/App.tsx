import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Route, Switch } from "wouter";

import { HelpDialog } from "@/components/help/help-dialog";
import { AppHeader } from "@/components/layout/app-header";
import { AppShell } from "@/components/layout/app-shell";
import { WORKSPACES } from "@/components/layout/workspaces";
import { PanelProvider, usePanelState } from "@/components/layout/panel-context";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { ShapeLibraryProvider } from "@/state/shape-library";
import { TraceProvider } from "@/state/trace-store";

import { queryClient } from "./lib/queryClient";

/**
 * Routes are generated from the workspace registry rather than written out
 * here, so adding a workspace (the Gridfinity bin designer, next) costs one
 * entry in `components/layout/workspaces.ts`.
 */
function Router() {
  return (
    <Switch>
      {WORKSPACES.map(({ path, component: Workspace }) => (
        // Rendered as a child rather than passed as `component`, because
        // wouter's `component` prop requires the RouteComponentProps signature
        // and these workspaces take no route params.
        <Route key={path} path={path}>
          <Workspace />
        </Route>
      ))}
      <Route component={NotFound} />
    </Switch>
  );
}

function Shell() {
  const { panelOpen, setPanelOpen } = usePanelState();
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <>
      <AppShell
        header={
          <AppHeader
            panelOpen={panelOpen}
            onPanelOpenChange={setPanelOpen}
            onHelpClick={() => setHelpOpen(true)}
          />
        }
      >
        <Router />
      </AppShell>
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Needed once, for the icon-only buttons in the header and toolbars. */}
      <TooltipProvider delayDuration={300}>
        <PanelProvider>
          {/* Above the router: traced shapes must survive the Trace → Bin
              navigation, which unmounts both workspaces' own stores. */}
          <ShapeLibraryProvider>
            {/* The active trace is also session state. Keeping its provider
                above the route switch preserves the loaded photo, outline,
                calibration, crop, undo history and active tool while the user
                visits Bin. */}
            <TraceProvider>
              <Shell />
            </TraceProvider>
          </ShapeLibraryProvider>
        </PanelProvider>
      </TooltipProvider>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
