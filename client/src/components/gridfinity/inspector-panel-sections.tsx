import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import { PanelBody, type PanelSectionProps } from "@/components/layout/panel-section";
import { PropertySurface } from "@/components/layout/property-surface";
import { useSelectionInspector } from "./selection-inspector-context";
import { BIN_OBJECT_SECTIONS as objectSections, BIN_WORKFLOW_SECTIONS } from "./bin-workflow";

const binSections = new Set(["bin-settings-size", "bin-settings-construction", "bin-settings-materials"]);

/** Keep every editor mounted once; workflow navigation chooses its right-hand home. */
export function InspectorPanelSections({ children }: { children: ReactNode }): JSX.Element {
  const inspector = useSelectionInspector();
  if (!inspector) return <PanelBody>{children}</PanelBody>;
  const sections = Children.toArray(children).filter(child => isValidElement<PanelSectionProps>(child));
  const active = BIN_WORKFLOW_SECTIONS.find(section => section.id === inspector.activeSection);
  return <>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="object-list-scroll">
      {sections.map(child => {
        const { id = "", title, tone, icon: Icon, summary } = child.props;
        if (objectSections.has(id)) return cloneElement(child, {
          onOpenChange: inspector.workflow ? (open: boolean) => { if (open) inspector.showSection(id); } : undefined,
        });
        if (!inspector.workflow) return null;
        return <button key={id} type="button" data-testid={`workflow-section-${id}`} data-property-tone={tone}
          className="property-heading flex min-h-9 w-full items-center gap-2 border-b border-l-2 px-3 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:border-l-4 aria-pressed:bg-accent/60 [@media(pointer:coarse)]:min-h-11"
          aria-label={`${title} — show properties`} aria-pressed={inspector.activeSection === id} aria-controls="objects-panel"
          onClick={() => inspector.showSection(id)}>
          {Icon && <Icon className="h-4 w-4 shrink-0" />}
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
          {summary && <span className="max-w-24 shrink-0 truncate rounded-full bg-[rgb(var(--property-rgb)/0.1)] px-1.5 py-0.5 text-[10px] font-medium leading-none">{summary}</span>}
          <ChevronRight className="h-4 w-4 shrink-0" />
        </button>;
      })}
    </div>
    {inspector.settings && createPortal(inspector.workflow && active ?
      objectSections.has(active.id) ? <PropertySurface tone={active.tone} className="m-3"><p className="text-sm">{active.description}</p></PropertySurface>
        : sections.filter(child => child.props.id === active.id).map(child => <PropertySurface id={active.id} key={active.id} tone={active.tone} className="m-3" aria-label={`${active.title} properties`}>
          <p className="text-xs text-muted-foreground">{active.description}</p>{child.props.children}
        </PropertySurface>)
      : sections.filter(child => binSections.has(child.props.id ?? "")), inspector.settings)}
    {inspector.dialogContent && createPortal(sections.filter(child => child.props.id === inspector.dialogSection), inspector.dialogContent)}
  </>;
}
