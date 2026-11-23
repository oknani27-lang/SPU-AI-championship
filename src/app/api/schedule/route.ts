import { requireAuthContext } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";

export async function GET() {
  try {
    const ctx = await requireAuthContext();
    const data = await ctx.store.getSchedule(ctx.userId);
    return jsonOk(data);
  } catch (err) {
    return handleApiError(err);
  }
}
