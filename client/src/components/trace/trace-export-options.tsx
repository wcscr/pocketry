import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { exportScale } from "@/lib/export/scale";
import { useTrace, type ExportFormat } from "@/state/trace-store";
import { LabelledSlider } from "./labelled-slider";

/** Physical formats require a scale; SVG can also preserve unscaled image pixels. */
export function TraceExportOptions(): JSX.Element {
  const { dispatch, calibration, imageSize, exportFormat, extrusionHeight } = useTrace();
  const scale = exportScale(calibration, imageSize.height);
  return <>
    <div className="space-y-2">
      <Label htmlFor="trace-export-format">Export format</Label>
      <Select value={exportFormat} onValueChange={value => dispatch({ type: "SET_EXPORT_FORMAT", exportFormat: value as ExportFormat })}>
        <SelectTrigger id="trace-export-format" className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="svg">{scale.mmPerPx ? "SVG — vector outline" : "SVG — image pixels (unscaled)"}</SelectItem>
          <SelectItem value="dxf" disabled={!scale.mmPerPx}>DXF — CAD / CAM</SelectItem>
          <SelectItem value="stl" disabled={!scale.mmPerPx}>STL — 3D print</SelectItem>
        </SelectContent>
      </Select>
    </div>
    {exportFormat === "stl" && <LabelledSlider id="trace-export-extrusion" label="Extrusion height"
      value={extrusionHeight} min={0.5} max={50} step={0.5} format={value => `${value} mm`}
      onChange={value => dispatch({ type: "SET_EXTRUSION_HEIGHT", extrusionHeight: value })} />}
  </>;
}
