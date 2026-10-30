import type { WorkerClient } from "@/lib/worker/client";
import { cadJobs } from "./client";

/** UI lanes keep their display queues; all native jobs share one worker.
 * Unsupported methods fail explicitly in the CAD worker, never use Manifold. */
export function createUnifiedBinClient(_lane:"detail"|"interactive"):WorkerClient {
  return cadJobs;
}
