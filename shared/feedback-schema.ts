import { z } from "zod";

/** Explicit feedback only: no project, photo, URL, or device data is collected. */
export const feedbackSchema = z.object({
  kind: z.enum(["problem", "suggestion"]),
  subject: z.string().trim().min(1, "Add a short summary.").max(120).regex(/^[^\r\n]+$/),
  message: z.string().trim().min(10, "Please include a little more detail (at least 10 characters).").max(5000),
  replyEmail: z.union([z.literal(""), z.string().trim().email().max(254)]),
  website: z.string().max(200),
  turnstileToken: z.string().min(1, "Complete the spam check before sending.").max(2048),
}).strict();

export type Feedback = z.infer<typeof feedbackSchema>;
