import { serveWorker } from "../worker/host";
import { createWorkerOpenCVLoader } from "./opencv-worker";
import { createDetectionHandlers } from "./worker-handlers";

serveWorker(createDetectionHandlers(createWorkerOpenCVLoader()));
