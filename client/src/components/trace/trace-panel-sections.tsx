import { Children, isValidElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight } from "lucide-react";
import { PanelBody, type PanelSectionProps } from "@/components/layout/panel-section";
import { PropertySurface } from "@/components/layout/property-surface";
import { useTrace } from "@/state/trace-store";
import { useTraceInspector } from "./trace-inspector-context";
import { TRACE_WORKFLOW_SECTIONS } from "./trace-workflow";

/** A single copy of each form moves to the selected workflow's properties. */
export function TracePanelSections({ children }: { children: ReactNode }): JSX.Element {
  const inspector = useTraceInspector();
  const trace = useTrace();
  if (!inspector) return <PanelBody className="[overflow-anchor:none]">{children}</PanelBody>;
  const sections = Children.toArray(children).filter(child => isValidElement<PanelSectionProps>(child));
  const complete = [!!trace.imageSize.width, !!trace.calibration && !trace.pendingAutoCalibration,
    !!trace.region && trace.region.width > 5 && trace.region.height > 5, !!trace.outline.length, false, false];
  const active = TRACE_WORKFLOW_SECTIONS.find(section => section.id === inspector.activeSection);
  return <>
    <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-label="Photo tracing workflow">
      {sections.map((child, index) => {
        const { id, summary, disabled } = child.props;
        const step = TRACE_WORKFLOW_SECTIONS.find(item => item.id === id);
        if (!step) return null;
        return <button key={id} type="button" data-testid={`trace-workflow-${step.label.toLowerCase()}`} data-property-tone={step.tone}
          className="property-heading flex min-h-14 w-full items-start gap-2 border-b border-l-2 px-3 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=step]:border-l-4 aria-[current=step]:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`${index + 1}. ${step.label}${complete[index] ? " (complete)" : ""}`} aria-current={inspector.activeSection === id ? "step" : undefined}
          aria-controls="objects-panel" disabled={disabled} onClick={() => inspector.showSection(step.id)}>
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]" aria-hidden>
            {complete[index] ? <Check className="h-3 w-3" /> : index + 1}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1 text-sm font-medium">{step.label}<ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0" /></span>
            {summary && <span className="mt-1 block truncate text-[11px] font-medium">{summary}</span>}
          </span>
        </button>;
      })}
    </nav>
    {inspector.settings && active && createPortal(sections.filter(child => child.props.id === active.id).map(child =>
      <PropertySurface id={active.id} key={active.id} tone={active.tone} className="m-3" tabIndex={-1} aria-label={`${active.label} properties`}>
        {child.props.children}
      </PropertySurface>), inspector.settings)}
  </>;
}
