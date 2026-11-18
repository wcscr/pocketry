import { useCallback, useMemo, useState } from "react";
import { WorkspaceLayout, type WorkspaceLayoutProps } from "@/components/layout/workspace-layout";
import { useElementSize } from "@/hooks/use-element-size";
import { HelpHint } from "@/components/ui/help-hint";
import { useTrace } from "@/state/trace-store";
import { TraceInspectorContext } from "./trace-inspector-context";
import { TRACE_WORKFLOW_SECTIONS } from "./trace-workflow";

/** The workflow layout shares the bin editor shell and the existing trace state.
 * Phones retain their compact step actions and controls drawer. */
export function TraceEditingWorkspace({ enabled, ...props }: WorkspaceLayoutProps & { enabled: boolean }): JSX.Element {
  return enabled ? <TraceWorkflowWorkspace {...props} /> : <WorkspaceLayout {...props} />;
}

function TraceWorkflowWorkspace(props: WorkspaceLayoutProps): JSX.Element {
  const trace = useTrace();
  const [activeSection, setActiveSection] = useState(() => !trace.imageUrl ? "trace-settings-source"
    : trace.pendingAutoCalibration || !trace.calibration ? "trace-settings-scale"
    : trace.region || trace.outline.length ? "trace-settings-detect" : "trace-settings-crop");
  const [settings, setSettings] = useState<HTMLDivElement | null>(null);
  // A collapsed inspector measures zero. In that case the canvas owns the edit dock.
  const [editorRef, editorSize] = useElementSize<HTMLDivElement>();
  const outlineEditor = editorSize.width > 0 && activeSection === "trace-settings-detect" ? editorRef.current : null;
  const editingInInspector = !!outlineEditor && trace.outline.length > 0 && (trace.mode === "edit" || trace.mode === "remove");
  const [openRequest, setOpenRequest] = useState(0);
  const [canvasRequest, setCanvasRequest] = useState(0);
  const [marginVisitedRevision, setMarginVisitedRevision] = useState<number | null>(null);
  const marginVisited = marginVisitedRevision === trace.sourceRevision;
  const showSection = useCallback((id: string, reveal = true) => {
    setActiveSection(id);
    if (reveal) {
      setOpenRequest(request => request + 1);
      if (id === "trace-settings-margin") setMarginVisitedRevision(trace.sourceRevision);
    }
  }, [trace.sourceRevision]);
  const showCanvas = useCallback(() => setCanvasRequest(request => request + 1), []);
  const context = useMemo(() => ({ activeSection, marginVisited, settings, outlineEditor, showSection, showCanvas }),
    [activeSection, marginVisited, settings, outlineEditor, showSection, showCanvas]);
  const section = TRACE_WORKFLOW_SECTIONS.find(item => item.id === activeSection) ?? TRACE_WORKFLOW_SECTIONS[0];
  return <TraceInspectorContext.Provider value={context}>
    <WorkspaceLayout {...props} inspectorPanelTitle="Workflow" inspectorRequest={openRequest}
      canvasEditingMode={canvasRequest ? `trace-interaction-${canvasRequest}` : "placement"}
      inspector={<aside className="flex h-full min-h-0 flex-col" aria-label="Trace properties" data-testid="trace-properties">
        <header data-property-tone={section.tone} className="property-heading min-h-14 shrink-0 border-b py-2 pl-3 pr-12">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Workflow properties</p>
          <div className="flex items-center gap-1"><h3 className="text-sm font-semibold">{section.label}</h3>
            <HelpHint label={`${section.label.toLowerCase()} step`}>{section.description}</HelpHint>
          </div>
        </header>
        <div ref={editorRef} className="hidden min-h-0 overflow-y-auto overscroll-contain min-[1100px]:block" />
        <div ref={setSettings} hidden={editingInInspector} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="trace-properties-scroll" />
      </aside>} />
  </TraceInspectorContext.Provider>;
}
