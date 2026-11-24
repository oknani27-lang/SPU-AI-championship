import { z } from "zod";
import { buildDailySummary } from "@/lib/ai/service";
import { requireAuthContext } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";
import { computeDailyMetrics } from "@/lib/store/types";
import { getThaiTodayDate, isValidDateString } from "@/lib/timezone";
import { ValidationError } from "@/lib/errors";

const dailySummaryBodySchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD")
      .refine(isValidDateString, "วันที่ไม่ถูกต้อง")
      .optional(),
  })
  .optional();

export async function GET(request: Request) {
  try {
    const ctx = await requireAuthContext();
    const url = new URL(request.url);
    const date = url.searchParams.get("date") ?? getThaiTodayDate();
    if (!isValidDateString(date)) throw new ValidationError("วันที่ไม่ถูกต้อง");
    const result = await ctx.store.getDailySummary(ctx.userId, date);
    return jsonOk(result);
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
        const parsed = dailySummaryBodySchema.parse(JSON.parse(text));
        if (parsed?.date) date = parsed.date;
      }
    } catch (err) {
      if (err instanceof SyntaxError) throw new ValidationError("ข้อมูล JSON ไม่ถูกต้อง");
      throw err;
    }

    const [dayData, settings] = await Promise.all([
      ctx.store.getOccurrencesForDate(ctx.userId, date),
      ctx.store.getSettings(ctx.userId),
    ]);

    // Always compute verified metrics strictly from DB occurrences
    const metrics = computeDailyMetrics(date, dayData.occurrences);

    const { summaryInput, telemetry, failure_reason } = await buildDailySummary({
      date,
      metrics,
      isRestDay: dayData.is_rest_day,
      caregiverName: settings.profile.full_name,
      careRecipientName: settings.care_recipient.display_name,
    });

    const summary = await ctx.store.saveDailySummary(ctx.userId, summaryInput);

    await ctx.store.logAiOperation(ctx.userId, {
      operation_type: "daily_summary",
      ...telemetry,
    });

    return jsonOk({ summary, ...(failure_reason ? { fallback_reason: failure_reason } : {}) });
  } catch (err) {
    return handleApiError(err);
  }
}
