import { useEffect, useState } from "react";
import { useIsMobile } from "./use-mobile";

/** Available space follows the keyboard; layout shares the stable mobile decision. */
export function useWorkspaceViewport() {
  const phone = useIsMobile();
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
  return { ...size, phone, tablet: !phone && size.width < 1100 };
}
