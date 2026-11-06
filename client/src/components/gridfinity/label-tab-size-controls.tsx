import type { BinSpec } from "@shared/gridfinity/types";
import { compartmentLabelTabPlacements } from "@shared/gridfinity/compartments";
import { edgeForWall, resolveBoundaryRun } from "@shared/gridfinity/footprint";
import { boundaryLabelTabProfileMm, labelTabDepthMm, labelTabFrontRimWidthMm, labelTabWidthMm } from "@shared/gridfinity/label-tab";
import { D_WALL, MIN_LABEL_TAB_DEPTH_MM, MIN_LABEL_TAB_WIDTH_MM, TAB_DEPTH_MM, TAB_WIDTH_NOMINAL_MM } from "@shared/gridfinity/standard";
import { Button } from "@/components/ui/button";
import { DraftNumberInput } from "@/components/ui/draft-number-input";
import { HelpHint } from "@/components/ui/help-hint";
import { Label } from "@/components/ui/label";

/** Requested dimensions stay editable even when a smaller bin limits the shelf. */
export function LabelTabSizeControls({ spec, onChange }: {
  spec: BinSpec;
  onChange: (patch: Partial<NonNullable<BinSpec["labelTab"]>>, transient?: boolean) => void;
}): JSX.Element | null {
  if (!spec.labelTab) return null;
  const depth = labelTabDepthMm(spec), width = labelTabWidthMm(spec);
  const repeated = spec.labelTab.scope === "compartments" && spec.fill === "none";
  const placement = repeated ? compartmentLabelTabPlacements(spec)[0] : undefined;
  const effectiveDepth = repeated ? placement?.depth : boundaryLabelTabProfileMm(spec)?.depthMm;
  const run = repeated ? null : resolveBoundaryRun(spec, spec.labelTab.edge ?? edgeForWall(spec, spec.labelTab.wall));
  const effectiveWidth = repeated ? placement?.length : run ? Math.min(width, Math.max(0, run.lengthMm - 2 * D_WALL)) : undefined;
  const noWritingArea = effectiveDepth !== undefined && effectiveDepth <= labelTabFrontRimWidthMm(spec, effectiveDepth);
  return <div className="space-y-2" data-testid="label-tab-size-controls">
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-1">
        <Label htmlFor="bin-label-tab-depth" className="text-xs">Tab depth</Label>
        <HelpHint label="label tab depth">How far the tab reaches into the bin. Smaller depths leave more storage space. Sub-bins limit tabs to half their depth; height and recess can also limit supported shelves. Your entered size is retained. The front rim uses part of this depth.</HelpHint>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <DraftNumberInput id="bin-label-tab-depth" aria-label="Label tab depth in millimetres" className="h-8 w-20"
          value={depth} min={MIN_LABEL_TAB_DEPTH_MM} max={TAB_DEPTH_MM} step={0.5} displayPrecision={2}
          onValueChange={depthMm => onChange({ depthMm }, true)} onValueCommit={depthMm => onChange({ depthMm })} />
        <span className="text-xs text-muted-foreground">mm</span>
      </div>
    </div>
    {spec.labelTab.width !== "full" && <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-1">
        <Label htmlFor="bin-label-tab-width" className="text-xs">Tab width</Label>
        <HelpHint label="label tab width">Length along the wall, centered or aligned to the selected end. Limited to the available wall or sub-bin width. Full width follows the wall and keeps this setting for when you return to a partial-width style.</HelpHint>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <DraftNumberInput id="bin-label-tab-width" aria-label="Label tab width in millimetres" className="h-8 w-20"
          value={width} min={MIN_LABEL_TAB_WIDTH_MM} max={TAB_WIDTH_NOMINAL_MM} step={1} displayPrecision={2}
          onValueChange={widthMm => onChange({ widthMm }, true)} onValueCommit={widthMm => onChange({ widthMm })} />
        <span className="text-xs text-muted-foreground">mm</span>
      </div>
    </div>}
    {effectiveDepth !== undefined && effectiveDepth < depth - 1e-6 && <p role="status" className="text-xs text-muted-foreground">
      Depth limited to {Number(effectiveDepth.toFixed(2))} mm to fit this bin. Your {depth} mm setting is retained.
    </p>}
    {spec.labelTab.width !== "full" && effectiveWidth !== undefined && effectiveWidth < width - 1e-6 && <p role="status" className="text-xs text-muted-foreground">
      Width limited to {Number(effectiveWidth.toFixed(2))} mm to fit this wall. Your {width} mm setting is retained.
    </p>}
    {(spec.wallSlant || spec.footprint.kind === "custom") && <p className="text-xs text-muted-foreground">
      Sizes and limits are measured before wall slant and custom-footprint clipping.
    </p>}
    {noWritingArea && <p role="status" className="text-xs text-muted-foreground">
      The front rim uses the entire tab depth. Increase Tab depth or turn off Front rim to leave a flat writing surface.
    </p>}
    {spec.surfaceTexts.length > 0 && <p className="text-xs text-muted-foreground">Existing text keeps its size and position. Check that it still fits after resizing tabs.</p>}
    {(depth !== TAB_DEPTH_MM || width !== TAB_WIDTH_NOMINAL_MM) && <Button type="button" size="sm" variant="ghost"
      onClick={() => onChange({ depthMm: undefined, widthMm: undefined })}>Use standard tab size</Button>}
  </div>;
}
