import { Button } from "@/components/ui/button";

/** The same three entry points on the welcome and empty Trace screens. */
export function StartDesignActions({ onTracePhoto, onDesignBin, onOpenSamples, traceActive = false }: {
  onTracePhoto: () => void;
  onDesignBin: () => void;
  onOpenSamples: () => void;
  traceActive?: boolean;
}): JSX.Element {
  return (
    <div role="group" aria-label="Get started" className="grid w-full grid-cols-3 gap-2 [&_button]:h-16 [&_button]:min-w-0 [&_button]:whitespace-normal [&_button]:px-2 [&_button]:text-xs [&_button]:leading-tight sm:[&_button]:h-11 sm:[&_button]:text-sm">
      <Button aria-current={traceActive ? "page" : undefined} onClick={onTracePhoto}>Trace a Photo</Button>
      <Button variant="outline" onClick={onDesignBin}>Design a Bin</Button>
      <Button variant="outline" onClick={onOpenSamples}>Open Sample Projects</Button>
    </div>
  );
}
