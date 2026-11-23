import { requireAuthContext } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuthContext();
    const { id } = await context.params;
    const link = await ctx.store.revokeShareLink(ctx.userId, id);
    return jsonOk({ link });
  } catch (err) {
    return handleApiError(err);
  }
}
