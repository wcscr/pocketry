import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { photoBoardCalibrationScad, photoBoardManifest } from "../client/src/lib/calibrate/photo-board-export";

const directory = resolve("models/h2d-photo-board");
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, "calibration.scad"), photoBoardCalibrationScad());
await writeFile(resolve(directory, "calibration.json"), `${JSON.stringify(photoBoardManifest(), null, 2)}\n`);
