import { z } from "zod";
import { dayOfWeekSchema, proposedScheduleTaskSchema } from "@/lib/ai/schemas";
import { requireAuthContext } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";
import { scheduleProblem } from "@/lib/ai/schedule-validation";
import { ValidationError } from "@/lib/errors";

const approveSchema = z.object({
  day_of_week: dayOfWeekSchema,
  effective_from_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD")
    .optional(),
  tasks: z
    .array(
      proposedScheduleTaskSchema.extend({
        rationale: z.string().max(400).optional().default(""),
      })
    )
    .min(1, "ต้องมีอย่างน้อย 1 รายการงาน"),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireAuthContext();
    const rawBody: unknown = await request.json();
    const input = approveSchema.parse(rawBody);
    const problem = scheduleProblem(input.tasks);
    if (problem) throw new ValidationError(problem);
    const result = await ctx.store.approveScheduleTasks(ctx.userId, input);
    return jsonOk(result, 201);
  } catch (err) {
    if (err instanceof SyntaxError) return handleApiError(new ValidationError("ข้อมูล JSON ไม่ถูกต้อง"));
    return handleApiError(err);
  }
}
