import { requireAuthContext } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";

export async function GET() {
  try {
    const ctx = await requireAuthContext();
    const result = await ctx.store.getReminders(ctx.userId);
    return jsonOk(result);
  } catch (err) {
    return handleApiError(err);
  }
}
