import { z } from "zod";
import { hhmmSchema, taskPrioritySchema } from "@/lib/ai/schemas";
import { requireAuthContext } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";

const updateTemplateSchema = z.object({
  title: z.string().min(1, "ชื่องานต้องไม่ว่างเปล่า").max(200).optional(),
  description: z.string().max(1000).optional(),
  scheduled_time: hhmmSchema.optional(),
  duration_minutes: z.number().int().min(5).max(720).optional(),
  priority: taskPrioritySchema.optional(),
  is_fixed_time: z.boolean().optional(),
  is_medically_prescribed: z.boolean().optional(),
  effective_from_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD")
    .optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuthContext();
    const { id } = await context.params;
    const rawBody: unknown = await request.json();
    const patch = updateTemplateSchema.parse(rawBody);
    const result = await ctx.store.updateTemplateForFuture(ctx.userId, id, patch);
    return jsonOk({
      ...result,
      message: `บันทึกแผนฉบับใหม่สำหรับสัปดาห์ถัดไปเรียบร้อย (เริ่มมีผลวันที่ ${result.template.effective_from_date}) โดยไม่กระทบประวัติเดิม`,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
