/** Minimal color-preview project metadata, independently written from Prusa's
 * file formats. These are display slots, not a physical printer configuration.
 * Prusa 3 requires a registered hardware definition even for a preview; XL is
 * bundled with the tested alpha versions and supports multiple tools.
 * See docs/bambu-3mf-compatibility.md for references and import verification. */
export function prusaColorProject(colors: readonly string[], extent: number): Record<string, string> {
  const name = "Pocketry color preview - choose your printer";
  const repeated = (value: string) => colors.map(() => value).join(",");
  const bed = [[-extent, -extent], [extent, -extent], [extent, extent], [-extent, extent]];
  const preset = (label: string, id: string) => ({ name: label, id, root_id: id, conditions: [] });
  const slots = colors.map((color, index) => preset(`Color ${index + 1} ${color}`, `pocketry-color-${index + 1}`));
  const legacy = [
    "; Pocketry color preview. Select your actual printer and print settings before printing.",
    "; printer_technology = FFF",
    `; printer_settings_id = ${name}`,
    "; print_settings_id = Color preview - choose print settings",
    `; filament_settings_id = ${slots.map(slot => slot.name).join(";")}`,
    `; nozzle_diameter = ${repeated("0.4")}`,
    `; extruder_offset = ${repeated("0x0")}`,
    `; filament_diameter = ${repeated("1.75")}`,
    `; filament_colour = ${colors.join(";")}`,
    `; extruder_colour = ${colors.join(";")}`,
    `; bed_shape = ${bed.map(point => point.join("x")).join(",")}`,
    "; max_print_height = 1000",
    "; single_extruder_multi_material = 0",
    "",
  ].join("\n");
  const project = {
    project: { id: "", version: 1 },
    objects: [],
    config_containers: [{
      preset: {
        hw_config: {
          config_id: `pocketry-color-preview-${colors.length}`,
          config_name: name,
          config_short_name: name,
          printer_id: "xl", vendor_id: "PrusaResearch", repo_id: "prusa-research-fff", repo_version: "1.0.0",
          technology: "fff", model: "XL", base_model: "XL", tool_count: colors.length,
          features: { multi_extruder: colors.length > 1 },
          tools: Object.fromEntries(colors.map((color, index) => [String(index), {
            type: "print_head", id: "0.4", name: `Color ${index + 1}`,
            features: { nozzle_diameter: 0.4, nozzle_high_flow: false },
            slicer_material: { id: slots[index].id, type: "PLA", features: {} },
          }])),
          sheet: { id: "pei_smooth", name: "Color preview", type: "pei_smooth", features: {} },
        },
        printer: preset(name, "pocketry-color-preview-printer"),
        print: preset("Color preview - choose print settings", "pocketry-color-preview-print"),
        tools: colors.map((_, index) => preset("Color preview", `pocketry-color-preview-tool-${index + 1}`)),
        materials: slots,
      },
      configuration: {
        printer_settings: {
          printer_technology: "FFF", bed_shape: bed, max_print_height: 1000,
          single_extruder_multi_material: false,
          extruder_offset: colors.map(() => [0, 0]),
        },
        toolprint_settings: {}, print_settings: {},
        filament_settings: { filament_colour: colors, filament_diameter: colors.map(() => 1.75) },
        project_settings: { extruder_colour: colors },
      },
      beds: [{ position_x: 0, position_y: 0, custom_gcode: null, wipe_tower: null }],
    }],
  };
  return {
    "Metadata/Slic3r_PE.config": legacy,
    "Metadata/PrusaSlicer3_project.json": JSON.stringify(project),
  };
}
