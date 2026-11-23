import { NextResponse } from "next/server";
import { buildSharedScheduleIcs } from "@/lib/calendar-ics";
import { NotFoundError } from "@/lib/errors";
import { handleApiError } from "@/lib/http";
import {
  getDemoStore,
  getSupabaseStore,
  isLiveSupabaseReady,
} from "@/lib/store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const now = new Date();

    let payload;
    if (token.startsWith("demo_")) {
      payload = await getDemoStore().getPublicSharedSchedule(token, now);
    } else {
      const liveReady = await isLiveSupabaseReady();
      if (liveReady) {
        const supa = getSupabaseStore();
        if (supa) {
          payload = await supa.getPublicSharedSchedule(token, now);
        }
      }
      if (!payload) {
        throw new NotFoundError("ไม่พบลิงก์ตารางดูแลที่ระบุ");
      }
    }

    const ics = buildSharedScheduleIcs({
      payload,
      reminderMinutesBefore: 15,
      now,
    });

    return new NextResponse(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="careplan-shared-${payload.target_date}.ics"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
