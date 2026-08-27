import type { LucideIcon } from "lucide-react";
import { Box, Scan } from "lucide-react";

import type { ComponentType } from "react";

import BinDesigner from "@/pages/bin-designer";
import Trace from "@/pages/trace";

/**
 * The app's workspaces, as data.
 *
 * A registry rather than hardcoded `<Route>` elements so a new workspace costs
 * one entry here and nothing in `App.tsx` — the Gridfinity bin designer plugs
 * in this way, next to the tracer.
 */
export interface Workspace {
  /** Route path. */
  path: string;
  /** Label in the header nav. */
  label: string;
  icon: LucideIcon;
  component: ComponentType;
}

export const WORKSPACES: Workspace[] = [
  {
    path: "/",
    label: "Trace",
    icon: Scan,
    component: Trace,
  },
  {
    path: "/bin",
    label: "Bin",
    icon: Box,
    component: BinDesigner,
  },
];
