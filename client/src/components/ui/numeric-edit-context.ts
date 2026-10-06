import { createContext } from "react";

/** A field owns its preview until it commits, cancels, or loses its document. */
export interface NumericEditSession {
  isCurrent: () => boolean;
  preview: (valid: boolean, update?: () => void) => void;
  commit: (update: () => void) => void;
  cancel: (restore: () => void) => void;
}

export const NumericEditContext = createContext<{
  begin: (owner: string) => NumericEditSession;
} | null>(null);
