import { z } from "zod";
import { getAuthContext, setSessionCookie } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";
import { getDemoStore, getSupabaseStore, isLiveSupabaseReady } from "@/lib/store";
import { AppError } from "@/lib/errors";

const demoBodySchema = z
  .object({
    reset: z.boolean().optional(),
  })
  .optional();

export async function POST(request: Request) {
  try {
    if (process.env.VERCEL === "1") {
      const origin = request.headers.get("origin");
      if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin)) throw new AppError("ไม่อนุญาตคำขอจากเว็บไซต์อื่น", 403, "INVALID_ORIGIN");
      const store = getSupabaseStore();
      if (!store || !await isLiveSupabaseReady()) throw new AppError("ระบบทดลองกำลังเตรียมฐานข้อมูล กรุณาลองใหม่", 503, "HOSTED_DEMO_UNAVAILABLE");
      const existing = await getAuthContext();
      if (existing?.mode === "supabase") {
        const bootstrap = await existing.store.getUserBootstrap(existing.userId);
        if (bootstrap?.user.email.endsWith("@careplan-demo.invalid")) return jsonOk({ user: bootstrap.user, mode: "supabase" });
      }
      const demo = await store.startHostedDemo();
      const response = jsonOk({ user: demo.user, mode: "supabase" });
      setSessionCookie(response, { mode: "supabase", access_token: demo.access_token, refresh_token: demo.refresh_token, issued_at: Date.now() });
      return response;
    }
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
