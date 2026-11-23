import { z } from "zod";
import { buildRestSuggestions } from "@/lib/ai/service";
import { requireAuthContext } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";
import { getThaiTodayDate } from "@/lib/timezone";

const restBodySchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD")
      .optional(),
  })
  .optional();

export async function GET(request: Request) {
  try {
    const ctx = await requireAuthContext();
    const url = new URL(request.url);
    const date = url.searchParams.get("date") ?? getThaiTodayDate();
    const suggestions = await ctx.store.getRestSuggestions(ctx.userId, date);
    return jsonOk({ suggestions });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuthContext();
    let date = getThaiTodayDate();

    try {
      const text = await request.text();
      if (text.trim()) {
        const parsed = restBodySchema.parse(JSON.parse(text));
        if (parsed?.date) date = parsed.date;
      }
    } catch (err) {
      if (err instanceof z.ZodError) throw err;
    }

    const [dayData, settings] = await Promise.all([
      ctx.store.getOccurrencesForDate(ctx.userId, date),
      ctx.store.getSettings(ctx.userId),
    ]);

    const { suggestions: draftSuggestions, telemetry } =
      await buildRestSuggestions({
        date,
        occurrences: dayData.occurrences,
        careRecipient: settings.care_recipient,
      });

    const saved = await ctx.store.replaceRestSuggestions(
      ctx.userId,
      date,
      draftSuggestions
    );

    await ctx.store.logAiOperation(ctx.userId, {
      operation_type: "rest_suggestions",
      ...telemetry,
    });

    return jsonOk({ suggestions: saved });
  } catch (err) {
    return handleApiError(err);
  }
}
