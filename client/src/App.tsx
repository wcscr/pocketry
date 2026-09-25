import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Route, Switch, useLocation } from "wouter";

import { HelpDialog } from "@/components/help/help-dialog";
import { FeedbackDialog, type FeedbackKind } from "@/components/help/feedback-dialog";
import { AppHeader } from "@/components/layout/app-header";
import { AppShell } from "@/components/layout/app-shell";
import { AppWelcome } from "@/components/layout/app-welcome";
import { ExperimentalFeaturesDialog } from "@/components/layout/experimental-features-dialog";
import { ExperimentalFeaturesProvider } from "@/state/experimental-features";
import { WORKSPACES } from "@/components/layout/workspaces";
import { PanelProvider, usePanelState } from "@/components/layout/panel-context";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import About from "@/pages/about";
import Ultim8Help from "@/pages/ultim8-help";
import NotFound from "@/pages/not-found";
import BinDesignerPage from "@/pages/bin-designer";
import { ShapeLibraryProvider } from "@/state/shape-library";
import { TraceProvider } from "@/state/trace-store";
import { ProjectActivityProvider } from "@/state/project-activity";
import { ProjectStatusBar } from "@/components/layout/project-status-bar";

import { queryClient } from "./lib/queryClient";

/**
 * Routes are generated from the workspace registry rather than written out
 * here, so adding a workspace (the Gridfinity bin designer, next) costs one
 * entry in `components/layout/workspaces.ts`.
 */
export function Router(): JSX.Element {
  const [, navigate] = useLocation();
  useEffect(() => {
    // Preserve published links to the former Help section without starting a fixture.
    const followLegacyHelp = (): void => {
      if (window.location.hash === "#ultim8-fixtures") navigate("/help/ultim8", { replace: true });
    };
    followLegacyHelp();
    window.addEventListener("hashchange", followLegacyHelp);
    return () => window.removeEventListener("hashchange", followLegacyHelp);
  }, [navigate]);
  return (
    <Switch>
      <Route path="/help/ultim8"><Ultim8Help /></Route>
      {/* One route keeps the designer mounted while entry replaces the URL. */}
      <Route path={/^\/(?:bin|ultim8)\/?$/}><BinDesignerPage /></Route>
      {WORKSPACES.filter(workspace => workspace.path !== "/bin").map(({ path, component: Workspace }) => (
        // Rendered as a child rather than passed as `component`, because
        // wouter's `component` prop requires the RouteComponentProps signature
        // and these workspaces take no route params.
        <Route key={path} path={path}>
          <Workspace />
        </Route>
      ))}
      <Route path="/about">
        <About />
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function Shell() {
  const { panelOpen, setPanelOpen, traceRestart } = usePanelState();
  const [helpOpen, setHelpOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind>("problem");
  const openFeedback = (kind: FeedbackKind) => {
    setHelpOpen(false);
    setFeedbackKind(kind);
    setFeedbackOpen(true);
  };

  return (
    <>
      <AppShell
        status={<ProjectStatusBar />}
        header={
          <AppHeader
            panelOpen={panelOpen}
            onPanelOpenChange={setPanelOpen}
            onHelpClick={() => setHelpOpen(true)}
            onFeedbackClick={openFeedback}
            onStartOver={traceRestart ?? undefined}
          />
        }
      >
        <Router />
      </AppShell>
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} onFeedbackClick={openFeedback} />
      <FeedbackDialog open={feedbackOpen} kind={feedbackKind} onOpenChange={setFeedbackOpen} />
      <ExperimentalFeaturesDialog />
      <AppWelcome />
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Needed once, for the icon-only buttons in the header and toolbars. */}
      <TooltipProvider delayDuration={300}>
        <ExperimentalFeaturesProvider>
        <PanelProvider>
          <ProjectActivityProvider>
          {/* Above the router: traced shapes must survive the Trace → Bin
              navigation, which unmounts both workspaces' own stores. */}
          <ShapeLibraryProvider>
            {/* The active trace is also session state. Keeping its provider
                above the route switch preserves the loaded photo, outline,
                calibration, crop, undo history and active tool while the user
                visits Bin. */}
            <TraceProvider persist>
              <Shell />
            </TraceProvider>
          </ShapeLibraryProvider>
          </ProjectActivityProvider>
        </PanelProvider>
        </ExperimentalFeaturesProvider>
      </TooltipProvider>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
