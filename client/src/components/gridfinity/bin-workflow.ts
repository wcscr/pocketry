/** Shared identity, order, and colors for workflow navigation and its editors. */
export const BIN_OBJECT_SECTIONS = new Set(["bin-settings-pockets", "bin-settings-finger-holes", "bin-settings-text"]);

export const BIN_WORKFLOW_SECTIONS = [
  { id: "bin-settings-project", label: "Project", title: "Project", tone: "slate", description: "Save, open, and manage your projects." },
  { id: "bin-settings-size", label: "Size", title: "Bin size", tone: "blue", description: "Set the footprint, height, and grid pitch." },
  { id: "bin-settings-construction", label: "Construction", title: "Construction", tone: "rose", description: "Configure dividers, scoop bottoms, the base, rim, and label tab." },
  { id: "bin-settings-pockets", label: "Pockets", title: "Pockets", tone: "violet", description: "Add a pocket, then select it to edit its properties." },
  { id: "bin-settings-finger-holes", label: "Finger access", title: "Finger access", tone: "cyan", description: "Add an opening, then select it to edit its properties." },
  { id: "bin-settings-text", label: "Surface text", title: "Surface text", tone: "cyan", description: "Add surface text, then select a label to edit its properties." },
  { id: "bin-settings-materials", label: "Materials & Colors", title: "Materials & Colors", tone: "amber", description: "Choose colors and material depths." },
  { id: "bin-settings-fit", label: "Check fit", title: "Check fit", tone: "indigo", description: null },
  { id: "bin-settings-export", label: "Export", title: "Export", tone: "emerald", description: null },
] as const;

/** Keep section identities shared while describing the active project profile. */
export function binWorkflowSections(isJig: boolean): Array<Omit<typeof BIN_WORKFLOW_SECTIONS[number], "title" | "description"> & { title: string; description: string | null }> {
  return BIN_WORKFLOW_SECTIONS.map(section => !isJig ? section : section.id === "bin-settings-size"
    ? { ...section, title: "Fixture size", description: "Set dimensions and body thickness in millimetres." }
    : section.id === "bin-settings-construction"
      ? { ...section, description: "Configure the backing, fill, and locating pegs for the mat." }
      : section);
}
