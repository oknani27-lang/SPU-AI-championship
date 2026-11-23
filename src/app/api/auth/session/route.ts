import type { SessionState } from "@/types/careplan";
import { getAuthContext } from "@/lib/auth";
import { isGeminiConfigured, isSupabaseConfigured } from "@/lib/env";
import { handleApiError, jsonOk } from "@/lib/http";
import { isLiveSupabaseReady } from "@/lib/store";

export async function GET() {
  try {
    const supabaseConfigured = isSupabaseConfigured();
    const geminiConfigured = isGeminiConfigured();
    const ctx = await getAuthContext();

    if (!ctx) {
      const liveReady = await isLiveSupabaseReady();
      const unauthState: SessionState = {
        authenticated: false,
        mode: liveReady ? "supabase" : "demo",
        supabase_configured: supabaseConfigured,
        gemini_configured: geminiConfigured,
        user: null,
        care_recipient: null,
        weekly_schedule: null,
        reminder_preference: null,
      };
      return jsonOk(unauthState);
    }

    const bootstrap = await ctx.store.getUserBootstrap(ctx.userId);
    if (!bootstrap) {
      const unauthState: SessionState = {
        authenticated: false,
        mode: ctx.mode,
        supabase_configured: supabaseConfigured,
        gemini_configured: geminiConfigured,
        user: null,
        care_recipient: null,
        weekly_schedule: null,
        reminder_preference: null,
      };
      return jsonOk(unauthState);
    }

    const state: SessionState = {
      authenticated: true,
      mode: ctx.mode,
      supabase_configured: supabaseConfigured,
      gemini_configured: geminiConfigured,
      user: bootstrap.user,
      care_recipient: bootstrap.care_recipient,
      weekly_schedule: bootstrap.weekly_schedule,
      reminder_preference: bootstrap.reminder_preference,
    };
    return jsonOk(state);
  } catch (err) {
    return handleApiError(err);
  }
}
