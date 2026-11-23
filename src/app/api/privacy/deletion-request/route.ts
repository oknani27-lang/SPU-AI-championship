import { z } from "zod";
import { requireAuthContext } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";

const deletionRequestSchema = z
  .object({
    reason: z.string().max(1000).optional(),
    confirm_email: z.string().max(200).optional(),
  })
  .optional();

export async function POST(request: Request) {
  try {
    const ctx = await requireAuthContext();
    let reason = "";
    try {
      const text = await request.text();
      if (text.trim()) {
        const parsed = deletionRequestSchema.parse(JSON.parse(text));
        reason = parsed?.reason ?? "";
      }
    } catch (err) {
      if (err instanceof z.ZodError) throw err;
    }

    const result = await ctx.store.createPrivacyDeletionRequest(
      ctx.userId,
      reason
    );
    return jsonOk(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
