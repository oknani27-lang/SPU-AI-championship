import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import {
  buildSingleOccurrenceIcs,
  buildWeeklyTemplatesIcs,
} from "@/lib/calendar-ics";
import { UnauthorizedError, ValidationError } from "@/lib/errors";
import { handleApiError } from "@/lib/http";
import { getThaiTodayDate, getThaiWeekDates } from "@/lib/timezone";

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) {
      throw new UnauthorizedError("กรุณาเข้าสู่ระบบก่อนส่งออกไฟล์ปฏิทิน");
    }

    const url = new URL(request.url);
    const occurrenceId = url.searchParams.get("occurrenceId")?.trim();
    const scope = url.searchParams.get("scope") === "day" ? "day" : "week";
    const dateParam = url.searchParams.get("date")?.trim() || getThaiTodayDate();
    const includePrivateNotes = url.searchParams.get("includeNotes") === "1";
    const recurring = url.searchParams.get("recurring") !== "0";

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      throw new ValidationError("รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)");
    }

    const { care_recipient, reminder_preference } = await ctx.store.getSettings(
      ctx.userId
    );
    const reminderMin = reminder_preference.reminders_enabled
      ? reminder_preference.repeat_interval_minutes
      : 0;

    if (occurrenceId) {
      const detail = await ctx.store.getOccurrenceDetail(
        ctx.userId,
        occurrenceId
      );
      const ics = buildSingleOccurrenceIcs({
        occurrence: detail.occurrence,
        careRecipientLabel: care_recipient.display_name,
        includePrivateNotes,
        reminderMinutesBefore: reminderMin,
        recurringWeekly: recurring,
      });

      return new NextResponse(ics, {
        status: 200,
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": `attachment; filename="careplan-event-${detail.occurrence.occurrence_date}.ics"`,
          "Cache-Control": "no-store",
        },
      });
    }

    if (scope === "day") {
      const dayData = await ctx.store.getOccurrencesForDate(
        ctx.userId,
        dateParam
      );
      const { weekly_schedule } = await ctx.store.getSchedule(ctx.userId);
      const ics = buildWeeklyTemplatesIcs({
        templates: dayData.occurrences.map((o) => ({
          id: o.id,
          user_id: o.user_id,
          weekly_schedule_id: o.weekly_schedule_id,
          day_of_week: o.day_of_week,
          title: o.title,
          description: o.description,
          scheduled_time: o.scheduled_time,
          duration_minutes: o.duration_minutes,
          priority: o.priority,
          is_fixed_time: o.is_fixed_time,
          is_medically_prescribed: o.is_medically_prescribed,
          effective_from_date: o.occurrence_date,
          effective_until_date: o.occurrence_date,
          version: 1,
          is_active: true,
          created_at: o.created_at,
          updated_at: o.updated_at,
        })),
        weekDates: [{ day_of_week: dayData.day_of_week, date: dayData.date }],
        restDays: dayData.is_rest_day ? [dayData.day_of_week] : [],
        careRecipientLabel: care_recipient.display_name,
        scheduleTitle: weekly_schedule.title,
        includePrivateNotes,
        reminderMinutesBefore: reminderMin,
      });

      return new NextResponse(ics, {
        status: 200,
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": `attachment; filename="careplan-day-${dateParam}.ics"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const { weekly_schedule, templates } = await ctx.store.getSchedule(
      ctx.userId
    );
    const weekDates = getThaiWeekDates(dateParam);
    const ics = buildWeeklyTemplatesIcs({
      templates,
      weekDates,
      restDays: weekly_schedule.rest_days,
      careRecipientLabel: care_recipient.display_name,
      scheduleTitle: weekly_schedule.title,
      includePrivateNotes,
      reminderMinutesBefore: reminderMin,
    });

    return new NextResponse(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="careplan-weekly-${weekDates[0].date}.ics"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
