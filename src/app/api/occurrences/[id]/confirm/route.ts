import { requireAuthContext } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuthContext();
    const { id } = await context.params;
    const result = await ctx.store.confirmOccurrenceCompletion(
      ctx.userId,
      id,
      new Date()
    );
    return jsonOk(result);
  } catch (err) {
    return handleApiError(err);
  }
}
