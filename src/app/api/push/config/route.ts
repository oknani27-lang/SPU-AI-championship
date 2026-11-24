import { requireAuthContext } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";
import { pushConfig } from "@/lib/push/server";
export async function GET() {
  try {
    const ctx = await requireAuthContext();
    if (ctx.mode === "demo") return jsonOk({ configured: false, publicKey: null, reason: "โหมดสาธิตไม่ส่ง Push จริง" });
    return jsonOk(pushConfig());
  } catch (e) { return handleApiError(e); }
}
