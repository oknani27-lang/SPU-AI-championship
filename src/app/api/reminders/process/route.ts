import crypto from "crypto";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";
import { UnauthorizedError, ValidationError } from "@/lib/errors";
import { handleApiError, jsonOk } from "@/lib/http";
import { processRemindersForUser } from "@/lib/reminders";
import { getDefaultAuthStore } from "@/lib/store";

const processBodySchema = z
  .object({
    simulate_now: z.string().datetime({ offset: true }).optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD")
      .optional(),
  })
  .optional();

function isValidCronRequest(request: Request): boolean {
  const { cronSecret } = getServerEnv();
  if (!cronSecret) return false;

  const authHeader = request.headers.get("authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  const headerSecret = request.headers.get("x-cron-secret")?.trim() ?? "";
  const candidate = bearer || headerSecret;
  if (!candidate) return false;

  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(cronSecret, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function runCronForAllUsers(now: Date) {
  const store = await getDefaultAuthStore();
  const userIds = await store.listAllActiveUserIds();
  const deliveredAll = [];

  for (const userId of userIds) {
    const res = await processRemindersForUser(store, userId, {
      now,
      channel: "cron_queue",
    });
    deliveredAll.push(...res.delivered);
  }

  return jsonOk({
    delivered: deliveredAll,
    processed_users: userIds.length,
  });
}

// Vercel Cron invokes GET /api/reminders/process with Authorization: Bearer <CRON_SECRET>
export async function GET(request: Request) {
  try {
    if (!isValidCronRequest(request)) {
      throw new UnauthorizedError("ต้องระบุ CRON_SECRET ที่ถูกต้อง");
    }
    return await runCronForAllUsers(new Date());
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const isCron = isValidCronRequest(request);
    let simulateNow: Date = new Date();
    let targetDate: string | undefined;

    try {
      const text = await request.text();
      if (text.trim()) {
        const parsed = processBodySchema.parse(JSON.parse(text));
        if (parsed?.simulate_now) {
          const dt = new Date(parsed.simulate_now);
          if (Number.isNaN(dt.getTime())) {
            throw new ValidationError("รูปแบบเวลา simulate_now ไม่ถูกต้อง");
          }
          simulateNow = dt;
        }
        if (parsed?.date) {
          targetDate = parsed.date;
        }
      }
    } catch (err) {
      if (err instanceof z.ZodError || err instanceof ValidationError) {
        throw err;
      }
    }

    if (isCron) {
      return await runCronForAllUsers(simulateNow);
    }

    const ctx = await getAuthContext();
    if (!ctx) {
      throw new UnauthorizedError("กรุณาเข้าสู่ระบบก่อนใช้งานระบบแจ้งเตือน");
    }

    const result = await processRemindersForUser(ctx.store, ctx.userId, {
      now: simulateNow,
      date: targetDate,
      channel: "in_app",
    });

    return jsonOk(result);
  } catch (err) {
    return handleApiError(err);
  }
}
