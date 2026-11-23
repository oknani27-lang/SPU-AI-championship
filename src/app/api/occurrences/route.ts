import { requireAuthContext } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";
import { getThaiTodayDate } from "@/lib/timezone";

export async function GET(request: Request) {
  try {
    const ctx = await requireAuthContext();
    const url = new URL(request.url);
    const weekStart = url.searchParams.get("weekStart");
    const dateParam = url.searchParams.get("date");

    if (weekStart) {
      const result = await ctx.store.getOccurrencesForWeek(ctx.userId, weekStart);
      return jsonOk(result);
    }

    const targetDate = dateParam ?? getThaiTodayDate();
    const result = await ctx.store.getOccurrencesForDate(ctx.userId, targetDate);
    return jsonOk(result);
  } catch (err) {
    return handleApiError(err);
  }
}
