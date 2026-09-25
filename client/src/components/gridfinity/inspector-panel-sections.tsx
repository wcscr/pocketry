import { Children, isValidElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PanelBody, type PanelSectionProps } from "@/components/layout/panel-section";
import { useSelectionInspector } from "./selection-inspector-context";

const objectSections = new Set(["bin-settings-pockets", "bin-settings-finger-holes"]);
const binSections = new Set(["bin-settings-size", "bin-settings-construction", "bin-settings-materials"]);

/** Route existing sections to their homes without duplicating editor state. */
export function InspectorPanelSections({ children }: { children: ReactNode }): JSX.Element {
  const inspector = useSelectionInspector();
  if (!inspector) return <PanelBody>{children}</PanelBody>;
  const sections = Children.toArray(children).filter(child => isValidElement<PanelSectionProps>(child));
  return <>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="object-list-scroll">
      {sections.filter(child => objectSections.has(child.props.id ?? ""))}
    </div>
    {inspector.settings && createPortal(sections.filter(child => binSections.has(child.props.id ?? "")), inspector.settings)}
    {inspector.dialogContent && createPortal(sections.filter(child => child.props.id === inspector.dialogSection), inspector.dialogContent)}
  </>;
}
