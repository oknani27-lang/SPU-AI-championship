import { requireAuthContext } from "@/lib/auth";
import { AppError, ValidationError } from "@/lib/errors";
import { handleApiError, jsonOk } from "@/lib/http";
import { assertPushOrigin, pushAdmin, pushConfig, validateSubscription, validPushEndpoint } from "@/lib/push/server";
export async function POST(request: Request) {
  try {
    assertPushOrigin(request);
    const ctx = await requireAuthContext();
    if (ctx.mode !== "supabase") throw new ValidationError("โหมดสาธิตไม่ลงทะเบียน Push จริง");
    if (!pushConfig().configured) throw new AppError("ยังไม่ได้ตั้งค่า Push ฝั่งเซิร์ฟเวอร์", 503, "PUSH_UNAVAILABLE");
    const raw = await request.text(); if (raw.length > 6000) throw new ValidationError("คำขอมีขนาดใหญ่เกินไป");
    const subscription = validateSubscription(JSON.parse(raw).subscription);
    const { error } = await pushAdmin().rpc("careplan_register_push", { p_user_id: ctx.userId, p_endpoint: subscription.endpoint, p_p256dh: subscription.p256dh, p_auth: subscription.auth });
    if (error) throw new AppError("ลงทะเบียนอุปกรณ์ไม่สำเร็จ อุปกรณ์อาจผูกกับบัญชีอื่น กรุณาปิด Push ในบัญชีเดิมก่อน", 409, "PUSH_REGISTRATION_FAILED");
    return jsonOk({ ok: true }, 201);
  } catch (e) { if (e instanceof SyntaxError) return handleApiError(new ValidationError("ข้อมูล JSON ไม่ถูกต้อง")); return handleApiError(e); }
}
export async function DELETE(request: Request) {
  try {
    assertPushOrigin(request);
    const ctx = await requireAuthContext();
    if (ctx.mode !== "supabase") return jsonOk({ ok: true });
    const raw = await request.text(); if (raw.length > 6000) throw new ValidationError("คำขอมีขนาดใหญ่เกินไป");
    const endpoint = JSON.parse(raw).endpoint;
    if (!validPushEndpoint(endpoint)) throw new ValidationError("อุปกรณ์ไม่ถูกต้อง");
    const { error } = await pushAdmin().from("careplan_push_subscriptions").delete().eq("user_id", ctx.userId).eq("endpoint", endpoint);
    if (error) throw new AppError("ลบอุปกรณ์แจ้งเตือนไม่สำเร็จ", 503, "PUSH_UNAVAILABLE");
    return jsonOk({ ok: true });
  } catch (e) { if (e instanceof SyntaxError) return handleApiError(new ValidationError("ข้อมูล JSON ไม่ถูกต้อง")); return handleApiError(e); }
}
