import { z } from "zod";
import { setSessionCookie } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";
import { getDemoStore } from "@/lib/store";
import { AppError } from "@/lib/errors";

const demoBodySchema = z
  .object({
    reset: z.boolean().optional(),
  })
  .optional();

export async function POST(request: Request) {
  try {
    if (process.env.VERCEL === "1") throw new AppError("โหมดสาธิตเก็บข้อมูลในเครื่อง ใช้บน Vercel ไม่ได้ กรุณาเชื่อม Supabase แล้วเข้าสู่ระบบด้วยบัญชีผู้ใช้", 503, "HOSTED_DEMO_UNAVAILABLE");
    const url = new URL(request.url);
    const resetParam =
      url.searchParams.get("reset") === "1" ||
      url.searchParams.get("reset") === "true";

    let resetFromBody = false;
    try {
      const text = await request.text();
      if (text.trim()) {
        const parsed = demoBodySchema.parse(JSON.parse(text));
        resetFromBody = Boolean(parsed?.reset);
      }
    } catch {
      // Allow empty body cleanly
    }

    const demoStore = getDemoStore();
    const { user } = await demoStore.ensureDemoUser({
      reset: resetParam || resetFromBody,
    });

    const response = jsonOk({
      user,
      mode: "demo" as const,
    });

    setSessionCookie(response, {
      mode: "demo",
      demo_user_id: user.id,
      issued_at: Date.now(),
    });

    return response;
  } catch (err) {
    return handleApiError(err);
  }
}
