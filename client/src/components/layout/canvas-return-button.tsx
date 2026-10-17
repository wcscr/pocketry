import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A prominent, persistent exit from compact workflow and properties panels. */
export function CanvasReturnButton({ onClick }: { onClick: () => void }): JSX.Element {
  return <Button className="h-12 w-full gap-2 text-base font-semibold shadow-sm" data-testid="button-back-to-canvas" onClick={onClick}>
    <ArrowLeft className="h-5 w-5" aria-hidden />Back to Canvas
  </Button>;
}
