import type { BinSpecInput } from "../../shared/gridfinity/types";
import type { SvgBinOptionsInput } from "../../shared/gridfinity/svg-bin";

export const EXPORT_USAGE = `Usage:
  npm run export:bin -- [GRIDXxGRIDYxUNITS] [--fill none|solid] [--no-lip] [--out DIR]
  npm run export:bin -- --svg FILE --object-depth MM [--object-height MM] [--finger-access sides|ends|both|none|custom] [--out DIR]
  npm run export:bin -- --project FILE [--out DIR]

SVG options: --svg-width MM, --clearance MM, --depth-clearance MM,
  --stacking-clearance MM, --floor MM, --rotation DEGREES, --no-auto-rotate,
  --finger-diameter MM, --finger-extension MM, --finger-depth MM,
  --finger-center X,Y (repeat for custom positions in bin-local mm, y-up).
Supply GRIDXxGRIDYxUNITS to fix all dimensions; otherwise SVG bins auto-size.
Use --plan to inspect an SVG design without writing files, --json for JSON,
  --name STEM to name artifacts. --help shows this message.`;

export interface ExportArgs {
  svgPath?: string;
  projectPath?: string;
  svgWidthMm?: number;
  svgOptions: SvgBinOptionsInput;
  spec: BinSpecInput;
  outDir: string;
  name?: string;
  planOnly: boolean;
  json: boolean;
}

/** Parse syntax once; shared schemas and geometry remain the semantic gate. */
export function parseExportArgs(argv: readonly string[]): ExportArgs {
  const options: ExportArgs = {
    svgOptions: { objectDepthMm: 0 },
    spec: { gridX: 2, gridY: 3, heightUnits: 6, fill: "none", lip: "standard" },
    outDir: "exports", planOnly: false, json: false,
  };
  const svgOnly = new Set<string>();
  let depthProvided = false;
  let fixedDimensions = false;
  let fillProvided = false;
  let lipProvided = false;
  const seen = new Set<string>();
  const legacyDuplicates = new Set<string>();
  const legacyRepeatable = new Set(["--fill", "--no-lip", "--out"]);
  const numberValue = (raw: string, flag: string) => {
    const value = Number(raw);
    if (!raw.trim() || !Number.isFinite(value)) throw new Error(`${flag} requires a finite number.`);
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined || next.startsWith("--") || !next.trim()) throw new Error(`${arg} requires a value.`);
      return next;
    };
    if (arg.startsWith("--") && arg !== "--finger-center") {
      if (seen.has(arg)) {
        if (!legacyRepeatable.has(arg)) throw new Error(`Duplicate argument: ${arg}`);
        legacyDuplicates.add(arg);
      }
      seen.add(arg);
    }
    if (arg === "--svg") options.svgPath = value();
    else if (arg === "--project") options.projectPath = value();
    else if (arg === "--out") options.outDir = value();
    else if (arg === "--name") options.name = value();
    else if (arg === "--json") options.json = true;
    else if (arg === "--plan") { options.planOnly = true; svgOnly.add(arg); }
    else if (arg === "--svg-width") { options.svgWidthMm = numberValue(value(), arg); svgOnly.add(arg); }
    else if (arg === "--fill") {
      const fill = value();
      if (fill !== "solid" && fill !== "none") throw new Error("--fill must be solid or none.");
      options.spec.fill = fill; fillProvided = true;
    } else if (arg === "--no-lip") {
      options.spec.lip = "none"; options.svgOptions.lip = "none"; lipProvided = true;
    } else if (arg === "--no-auto-rotate") {
      options.svgOptions.autoRotate = false; svgOnly.add(arg);
    } else if (arg === "--finger-access") {
      const placement = value();
      if (!["sides", "ends", "both", "none", "custom"].includes(placement)) throw new Error("Unknown finger-access placement.");
      options.svgOptions.fingerAccess = { ...options.svgOptions.fingerAccess, placement: placement as NonNullable<SvgBinOptionsInput["fingerAccess"]>["placement"] };
      svgOnly.add(arg);
    } else if (arg === "--finger-center") {
      const coordinates = value().split(",");
      if (coordinates.length !== 2) throw new Error("--finger-center requires X,Y in millimeters.");
      const center = { x: numberValue(coordinates[0], arg), y: numberValue(coordinates[1], arg) };
      const access = options.svgOptions.fingerAccess;
      options.svgOptions.fingerAccess = { ...access, centers: [...(access?.centers ?? []), center] };
      svgOnly.add(arg);
    } else if (arg.startsWith("--finger-")) {
      const key = { "--finger-diameter": "diameterMm", "--finger-extension": "extensionMm", "--finger-depth": "depthMm" }[arg] as "diameterMm" | "extensionMm" | "depthMm" | undefined;
      if (!key) throw new Error(`Unknown argument: ${arg}`);
      options.svgOptions.fingerAccess = { ...options.svgOptions.fingerAccess, [key]: numberValue(value(), arg) };
      svgOnly.add(arg);
    } else if (arg.startsWith("--")) {
      const key = { "--object-depth": "objectDepthMm", "--object-height": "objectHeightMm", "--clearance": "clearanceMm", "--depth-clearance": "depthClearanceMm", "--stacking-clearance": "stackingClearanceMm", "--floor": "minimumFloorMm", "--rotation": "rotationDeg" }[arg] as "objectDepthMm" | "objectHeightMm" | "clearanceMm" | "depthClearanceMm" | "stackingClearanceMm" | "minimumFloorMm" | "rotationDeg" | undefined;
      if (!key) throw new Error(`Unknown argument: ${arg}`);
      options.svgOptions[key] = numberValue(value(), arg);
      if (key === "objectDepthMm") depthProvided = true;
      svgOnly.add(arg);
    } else if (/^\d+x\d+x\d+(?:\.5)?$/i.test(arg)) {
      if (fixedDimensions) legacyDuplicates.add("dimensions");
      const [gridX, gridY, heightUnits] = arg.toLowerCase().split("x").map(Number);
      Object.assign(options.spec, { gridX, gridY, heightUnits });
      Object.assign(options.svgOptions, { gridX, gridY, heightUnits });
      fixedDimensions = true;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.svgPath && options.projectPath) throw new Error("Choose either --svg or --project.");
  // Original empty-bin commands use the last supplied legacy option. Preserve
  // that contract while keeping the new SVG/project modes unambiguous.
  if ((options.svgPath || options.projectPath) && legacyDuplicates.size) {
    throw new Error(`Duplicate argument: ${[...legacyDuplicates].join(", ")}`);
  }
  if (!options.svgPath && svgOnly.size) throw new Error("SVG options require --svg.");
  if (options.svgPath && !depthProvided) throw new Error("--svg requires --object-depth in millimeters.");
  if (options.svgPath && fillProvided && options.spec.fill !== "solid") throw new Error("SVG pockets require solid fill.");
  if (options.projectPath && (fixedDimensions || fillProvided || lipProvided)) throw new Error("Project exports use their saved bin dimensions and settings.");
  if (options.svgOptions.fingerAccess?.centers?.length && !options.svgOptions.fingerAccess.placement) {
    options.svgOptions.fingerAccess.placement = "custom";
  }
  return options;
}
