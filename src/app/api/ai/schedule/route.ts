import { z } from "zod";
import { dayOfWeekSchema, draftTaskInputSchema } from "@/lib/ai/schemas";
import { proposeDailySchedule } from "@/lib/ai/service";
import { requireAuthContext } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";

const scheduleRequestSchema = z.object({
  day_of_week: dayOfWeekSchema,
  tasks: z.array(draftTaskInputSchema).min(1, "กรุณาเพิ่มรายการงานอย่างน้อย 1 รายการ"),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireAuthContext();
    const rawBody: unknown = await request.json();
    const input = scheduleRequestSchema.parse(rawBody);
    const settings = await ctx.store.getSettings(ctx.userId);

    const { response, telemetry } = await proposeDailySchedule({
      day_of_week: input.day_of_week,
      tasks: input.tasks.map((t) => ({
        ...t,
        preferred_time: t.preferred_time ? t.preferred_time : undefined,
      })),
      careRecipientName: settings.care_recipient.display_name,
    });

    await ctx.store.logAiOperation(ctx.userId, {
      operation_type: "schedule_generator",
      ...telemetry,
    });

    return jsonOk(response);
  } catch (err) {
    return handleApiError(err);
  }
}
