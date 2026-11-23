import { z } from "zod";
import { dayOfWeekSchema } from "@/lib/ai/schemas";
import { requireAuthContext } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";

const restDaySchema = z.object({
  day_of_week: dayOfWeekSchema,
  is_rest_day: z.boolean(),
});

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuthContext();
    const rawBody: unknown = await request.json();
    const input = restDaySchema.parse(rawBody);
    const result = await ctx.store.setRestDay(
      ctx.userId,
      input.day_of_week,
      input.is_rest_day
    );
    return jsonOk(result);
  } catch (err) {
    return handleApiError(err);
  }
}
