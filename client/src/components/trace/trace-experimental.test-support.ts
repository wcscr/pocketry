import { act } from "react";
import { EXPERIMENTAL_FEATURES_KEY } from "@/state/experimental-features";

/** Exercise the same persisted preference and live updates as App settings. */
export function setExperimentalTools(enabled: boolean) {
  if (enabled) localStorage.setItem(EXPERIMENTAL_FEATURES_KEY, "true");
  else localStorage.removeItem(EXPERIMENTAL_FEATURES_KEY);
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: EXPERIMENTAL_FEATURES_KEY })));
}
