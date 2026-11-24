import { z } from "zod";
import { dayOfWeekSchema, draftTaskInputSchema } from "@/lib/ai/schemas";
import { proposeDailySchedule } from "@/lib/ai/service";
import { requireAuthContext } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";
import { ValidationError } from "@/lib/errors";

const scheduleRequestSchema = z.object({
  day_of_week: dayOfWeekSchema,
  tasks: z.array(draftTaskInputSchema).min(1, "กรุณาเพิ่มรายการงานอย่างน้อย 1 รายการ").max(40),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireAuthContext();
    const rawBody: unknown = await request.json();
    const input = scheduleRequestSchema.parse(rawBody);
    const byId = new Map(input.tasks.map(task => [task.temp_id, task]));
    if (byId.size !== input.tasks.length) throw new ValidationError("รหัสงานซ้ำ");
    for (const task of input.tasks) {
      const seen = new Set([task.temp_id]); let parentId = task.depends_on_temp_id;
      while (parentId) {
        const parent = byId.get(parentId);
        if (!parent || seen.has(parentId)) throw new ValidationError("ลำดับงานไม่ถูกต้อง กรุณาตรวจงานก่อนหน้า");
        seen.add(parentId); parentId = parent.depends_on_temp_id;
      }
    }
    const settings = await ctx.store.getSettings(ctx.userId);

    const { response, telemetry, failure_reason } = await proposeDailySchedule({
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

    return jsonOk({ ...response, ...(failure_reason ? { fallback_reason: failure_reason } : {}) });
  } catch (err) {
    if (err instanceof SyntaxError) return handleApiError(new ValidationError("ข้อมูล JSON ไม่ถูกต้อง"));
    return handleApiError(err);
  }
}
