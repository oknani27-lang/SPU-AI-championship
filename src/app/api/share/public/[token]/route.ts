import { NotFoundError } from "@/lib/errors";
import { handleApiError, jsonOk } from "@/lib/http";
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

    // Strict Demo vs Live token isolation: demo_* tokens ONLY resolve from DemoFileStore
    if (token.startsWith("demo_")) {
      const payload = await getDemoStore().getPublicSharedSchedule(token, now);
      return jsonOk(payload);
    }

    const liveReady = await isLiveSupabaseReady();
    if (liveReady) {
      const supa = getSupabaseStore();
      if (supa) {
        const payload = await supa.getPublicSharedSchedule(token, now);
        return jsonOk(payload);
      }
    }

    throw new NotFoundError("ไม่พบลิงก์ตารางดูแลที่ระบุ");
  } catch (err) {
    return handleApiError(err);
  }
}
