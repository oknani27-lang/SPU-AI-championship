import { z } from "zod";
import { requireAuthContext } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";
import { handleApiError, jsonOk } from "@/lib/http";

const createShareSchema = z.object({
  scope: z.enum(["day", "week"]),
  target_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD"),
  include_private_notes: z.boolean().default(false),
  expires_in_days: z.number().int().min(1).max(365).nullable().optional(),
});

export async function GET() {
  try {
    const ctx = await requireAuthContext();
    const links = await ctx.store.listShareLinks(ctx.userId);
    return jsonOk({ links });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuthContext();
    const rawBody: unknown = await request.json();
    const input = createShareSchema.parse(rawBody);
    const link = await ctx.store.createShareLink(ctx.userId, input);

    const origin =
      new URL(request.url).origin || getServerEnv().appBaseUrl;
    const shareUrl = `${origin}/share/${link.token}`;

    return jsonOk({ link, share_url: shareUrl }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
