import { z } from "zod";
import { hhmmSchema } from "@/lib/ai/schemas";
import { requireAuthContext } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";

const updateSettingsSchema = z.object({
  profile: z
    .object({
      full_name: z.string().min(1).max(120).optional(),
      timezone: z.string().min(1).max(60).optional(),
    })
    .optional(),
  care_recipient: z
    .object({
      display_name: z.string().min(1).max(120).optional(),
      age_years: z.number().int().min(0).max(130).nullable().optional(),
      mobility_level: z.enum(["independent", "homebound", "bedbound"]).optional(),
      care_notes: z.string().max(1500).optional(),
      requires_supervision: z.boolean().optional(),
    })
    .optional(),
  reminder_preference: z
    .object({
      reminders_enabled: z.boolean().optional(),
      repeat_interval_minutes: z.number().int().min(5).max(120).optional(),
      quiet_hours_enabled: z.boolean().optional(),
      quiet_hours_start: hhmmSchema.optional(),
      quiet_hours_end: hhmmSchema.optional(),
      browser_notifications_granted: z.boolean().optional(),
    })
    .optional(),
});

export async function GET() {
  try {
    const ctx = await requireAuthContext();
    const result = await ctx.store.getSettings(ctx.userId);
    return jsonOk(result);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuthContext();
    const rawBody: unknown = await request.json();
    const patch = updateSettingsSchema.parse(rawBody);
    const result = await ctx.store.updateSettings(ctx.userId, patch);
    return jsonOk(result);
  } catch (err) {
    return handleApiError(err);
  }
}
