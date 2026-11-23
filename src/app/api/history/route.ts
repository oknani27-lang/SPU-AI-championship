import { requireAuthContext } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const ctx = await requireAuthContext();
    const url = new URL(request.url);
    const rawLimit = Number(url.searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(rawLimit) ? rawLimit : 50;
    const result = await ctx.store.getHistory(ctx.userId, limit);
    return jsonOk(result);
  } catch (err) {
    return handleApiError(err);
  }
}
