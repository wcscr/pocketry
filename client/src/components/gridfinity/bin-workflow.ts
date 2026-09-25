/** Shared identity, order, and colors for workflow navigation and its editors. */
export const BIN_OBJECT_SECTIONS = new Set(["bin-settings-pockets", "bin-settings-finger-holes"]);

export const BIN_WORKFLOW_SECTIONS = [
  { id: "bin-settings-project", label: "Project", title: "Project", tone: "slate", description: "Save, open, and manage your projects." },
  { id: "bin-settings-size", label: "Size", title: "Bin size", tone: "blue", description: "Set the footprint, height, and grid pitch." },
  { id: "bin-settings-construction", label: "Construction", title: "Construction", tone: "rose", description: "Configure the base, rim, magnets, and label tab." },
  { id: "bin-settings-pockets", label: "Pockets", title: "Pockets", tone: "violet", description: "Add a pocket, then select it to edit its properties." },
  { id: "bin-settings-finger-holes", label: "Finger access", title: "Finger access", tone: "cyan", description: "Add an opening, then select it to edit its properties." },
  { id: "bin-settings-materials", label: "Materials & Colors", title: "Materials & Colors", tone: "amber", description: "Choose colors and material depths." },
  { id: "bin-settings-fit", label: "Check fit", title: "Check fit", tone: "emerald", description: "Inspect the inside of the bin or print a small fit template." },
  { id: "bin-settings-export", label: "Export", title: "Export", tone: "emerald", description: "Download a printable bin or a layout for fabrication." },
] as const;
