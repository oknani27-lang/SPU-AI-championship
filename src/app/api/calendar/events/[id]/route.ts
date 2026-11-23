import { z } from "zod";
import { requireAuthContext } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";

const updateCalendarEventSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่เริ่มต้นต้องอยู่ในรูปแบบ YYYY-MM-DD")
    .optional(),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่สิ้นสุดต้องอยู่ในรูปแบบ YYYY-MM-DD")
    .optional(),
  start_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "เวลาเริ่มต้นต้องอยู่ในรูปแบบ HH:mm")
    .optional(),
  end_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "เวลาสิ้นสุดต้องอยู่ในรูปแบบ HH:mm")
    .optional(),
  is_all_day: z.boolean().optional(),
  recurrence: z.enum(["never", "daily", "weekly", "monthly"]).optional(),
  until_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  reminder_minutes: z.number().int().min(0).max(10080).nullable().optional(),
  edit_scope: z.enum(["all", "single", "future"]).optional(),
  occurrence_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
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
    const input = updateCalendarEventSchema.parse(rawBody);
    const result = await ctx.store.updateCalendarEvent(ctx.userId, id, input);
    return jsonOk(result);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuthContext();
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const scopeParam = searchParams.get("scope");
    const occurrenceDate = searchParams.get("occurrenceDate") ?? undefined;
    const delete_scope = scopeParam === "single" ? "single" : "all";

    const result = await ctx.store.deleteCalendarEvent(ctx.userId, id, {
      delete_scope,
      occurrence_date: occurrenceDate,
    });
    return jsonOk(result);
  } catch (err) {
    return handleApiError(err);
  }
}
