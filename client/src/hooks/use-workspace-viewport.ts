import { useEffect, useState } from "react";

/** Keyboard height affects available space, never the width-based layout mode. */
export function useWorkspaceViewport() {
  const read = () => ({ width: window.innerWidth, height: window.innerHeight,
    availableHeight: window.visualViewport?.height ?? window.innerHeight,
    offsetTop: window.visualViewport?.offsetTop ?? 0 });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const resize = () => setSize(previous => {
      const next = read();
      return { ...next, height: previous.width === next.width ? previous.height : next.height };
    });
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    return () => {
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("scroll", resize);
    };
  }, []);
  return { ...size, phone: size.width < 768, tablet: size.width >= 768 && size.width < 1100 };
}
