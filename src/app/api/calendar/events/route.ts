import { z } from "zod";
import { requireAuthContext } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";

const createCalendarEventSchema = z.object({
  title: z.string().trim().min(1, "กรุณาระบุชื่อกิจกรรม").max(200),
  description: z.string().max(1000).optional(),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่เริ่มต้นต้องอยู่ในรูปแบบ YYYY-MM-DD"),
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
});

export async function GET(request: Request) {
  try {
    const ctx = await requireAuthContext();
    const { searchParams } = new URL(request.url);
    const start = searchParams.get("start") ?? undefined;
    const end = searchParams.get("end") ?? undefined;

    const result = await ctx.store.listCalendarEvents(ctx.userId, start, end);
    return jsonOk(result);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuthContext();
    const rawBody: unknown = await request.json();
    const input = createCalendarEventSchema.parse(rawBody);
    const event = await ctx.store.createCalendarEvent(ctx.userId, input);
    return jsonOk({ event }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
