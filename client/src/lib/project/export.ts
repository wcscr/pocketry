import type { ProjectDoc } from "@shared/gridfinity/project";
import type { BinSpec } from "@shared/gridfinity/types";

import { downloadBlob } from "@/lib/download";

/** Keep readable names while removing path separators and unsafe filename characters. */
export function exportFilePart(value: string): string {
  return value.trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 80)
    .replace(/[.-]+$/g, "");
}

export function binSizeLabel(spec: BinSpec): string {
  return `${spec.gridX}x${spec.gridY}x${spec.heightUnits}${
    spec.gridPitch === "full" ? "" : `-${spec.gridPitch}`
  }${spec.footprint.kind === "custom" ? `-custom-${spec.footprint.cells.length}cell` : ""}`;
}

export interface ProjectExport {
  baseName: string;
  backup: Blob;
}

/** Snapshot before awaiting geometry so both downloads describe the same design. */
export function prepareProjectExport(
  doc: ProjectDoc,
  projectName: string | null,
  variant = "",
  date = new Date(),
): ProjectExport {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  // Local date/time is recognizable beside the user's other downloads; include
  // milliseconds so repeated exports do not normally reuse a backup filename.
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
  const baseName = [
    exportFilePart(projectName ?? ""),
    `bin-${binSizeLabel(doc.spec)}`,
    exportFilePart(variant),
    stamp,
  ].filter(Boolean).join("-");
  return {
    baseName,
    backup: new Blob([JSON.stringify({ ...doc, ...(projectName?.trim() ? { name: projectName.trim().slice(0, 80) } : {}) }, null, 2)], { type: "application/json" }),
  };
}

/** Include the recovery copy only when requested, using the same design snapshot. */
export function downloadModelWithProject(
  model: Blob,
  format: "stl" | "3mf" | "svg" | "dxf",
  project: ProjectExport,
  includeProject: boolean,
): void {
  if (includeProject) downloadBlob(project.backup, `${project.baseName}.pocketry.json`);
  downloadBlob(model, `${project.baseName}.${format}`);
}
