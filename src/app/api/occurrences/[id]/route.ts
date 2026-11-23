import { requireAuthContext } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuthContext();
    const { id } = await context.params;
    const result = await ctx.store.getOccurrenceDetail(ctx.userId, id);
    return jsonOk(result);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuthContext();
    const { id } = await context.params;
    await ctx.store.rejectOccurrenceEdit(ctx.userId, id);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuthContext();
    const { id } = await context.params;
    await ctx.store.rejectOccurrenceDelete(ctx.userId, id);
  } catch (err) {
    return handleApiError(err);
  }
}
