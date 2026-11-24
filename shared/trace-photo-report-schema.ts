import { z } from "zod";

// Leave room under Email Service's 25 MiB message limit for MIME encoding and details.
export const TRACE_REPORT_SEND_PHOTO_MAX_BYTES = 15 * 1024 * 1024;
export const TRACE_REPORT_SEND_DETAILS_MAX_BYTES = 1024 * 1024;
export const TRACE_REPORT_SEND_BODY_MAX_BYTES = 22 * 1024 * 1024;

/** Only an explicit Trace submission may include a photo. */
export const tracePhotoSubmissionSchema = z.object({
  photo: z.object({
    type: z.enum(["image/png", "image/jpeg", "image/webp"]),
    content: z.string().min(4).max(Math.ceil(TRACE_REPORT_SEND_PHOTO_MAX_BYTES / 3) * 4),
  }).strict(),
  details: z.string().min(1).max(TRACE_REPORT_SEND_DETAILS_MAX_BYTES),
  replyEmail: z.union([z.literal(""), z.string().trim().email().max(254)]),
  website: z.string().max(200),
}).strict();

export type TracePhotoSubmission = z.infer<typeof tracePhotoSubmissionSchema>;
