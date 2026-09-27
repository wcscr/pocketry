/** Shared order, guidance, and colors for the tracing workflow and properties. */
export const TRACE_WORKFLOW_SECTIONS = [
  { id: "trace-settings-source", label: "Photo", tone: "slate", description: "Choose a clear photo of the whole tool." },
  { id: "trace-settings-scale", label: "Scale", tone: "amber", description: "Confirm a reference or set a known distance." },
  { id: "trace-settings-crop", label: "Region", tone: "rose", description: "Draw a box around the tool to trace." },
  { id: "trace-settings-detect", label: "Outline", tone: "blue", description: "Refine the outline and edit its contours." },
  { id: "trace-settings-margin", label: "Margin", tone: "violet", description: "Optionally add space around the traced tool." },
  { id: "trace-settings-output", label: "Export Outline", tone: "emerald", description: "Add the tool to a bin or save its outline." },
] as const;
