import { requireAuthContext } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";

export async function PATCH(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuthContext();
    const { id } = await context.params;
    const notification = await ctx.store.markNotificationRead(ctx.userId, id);
    return jsonOk({ notification });
  } catch (err) {
    return handleApiError(err);
  }
}
