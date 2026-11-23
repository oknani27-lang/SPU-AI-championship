import { z } from "zod";
import { requireAuthContext } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";

const updateStatusSchema = z.object({
  status: z.enum(["accepted", "dismissed", "ignored"]),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuthContext();
    const { id } = await context.params;
    const rawBody: unknown = await request.json();
    const input = updateStatusSchema.parse(rawBody);
    const suggestion = await ctx.store.updateRestSuggestionStatus(
      ctx.userId,
      id,
      input.status
    );
    return jsonOk({ suggestion });
  } catch (err) {
    return handleApiError(err);
  }
}
