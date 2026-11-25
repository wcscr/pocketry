import { z } from "zod";

// Keep the upload within the Pages Function's processing budget, well below the email size limit.
const MIB = 1024 * 1024;
export const TRACE_REPORT_SEND_PHOTO_MAX_MIB = 5;
export const TRACE_REPORT_SEND_PHOTO_MAX_BYTES = TRACE_REPORT_SEND_PHOTO_MAX_MIB * MIB;
export const TRACE_REPORT_SEND_DETAILS_MAX_BYTES = MIB;
export const TRACE_REPORT_SEND_BODY_MAX_BYTES = 9 * MIB;

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
