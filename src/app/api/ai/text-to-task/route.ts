import { z } from "zod";
import { dayOfWeekSchema } from "@/lib/ai/schemas";
import { parseTextToTasks } from "@/lib/ai/service";
import { requireAuthContext } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";
import { ValidationError } from "@/lib/errors";

const textToTaskRequestSchema = z.object({
  text: z
    .string()
    .trim()
    .min(2, "กรุณาพิมพ์ข้อความรายการดูแลที่ต้องการแปลงเป็นงาน")
    .max(2000),
  default_day_of_week: dayOfWeekSchema.optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireAuthContext();
    const rawBody: unknown = await request.json();
    const input = textToTaskRequestSchema.parse(rawBody);

    const { response, telemetry, failure_reason } = await parseTextToTasks({
      text: input.text,
      default_day_of_week: input.default_day_of_week,
    });

    await ctx.store.logAiOperation(ctx.userId, {
      operation_type: "text_to_task",
      ...telemetry,
    });

    return jsonOk({ ...response, ...(failure_reason ? { fallback_reason: failure_reason } : {}) });
  } catch (err) {
    if (err instanceof SyntaxError) return handleApiError(new ValidationError("ข้อมูล JSON ไม่ถูกต้อง"));
    return handleApiError(err);
  }
}
