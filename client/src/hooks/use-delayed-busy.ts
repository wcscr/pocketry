import { useEffect, useState } from "react";

/** Avoid flashing busy indicators for work that finishes within a few frames. */
export function useDelayedBusy(busy: boolean): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!busy) { setVisible(false); return; }
    const timer = setTimeout(() => setVisible(true), 150);
    return () => clearTimeout(timer);
  }, [busy]);
  return busy && visible;
}
