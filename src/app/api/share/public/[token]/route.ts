import { GoneError, NotFoundError } from "@/lib/errors";
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

    const liveReady = await isLiveSupabaseReady();
    if (liveReady) {
      const supa = getSupabaseStore();
      if (supa) {
        try {
          const payload = await supa.getPublicSharedSchedule(token, now);
          return jsonOk(payload);
        } catch (err) {
          if (err instanceof GoneError) {
            throw err;
          }
          if (!(err instanceof NotFoundError)) {
            throw err;
          }
          // Fall through to demo store if token was created during Demo Mode
        }
      }
    }

    const demoStore = getDemoStore();
    const payload = await demoStore.getPublicSharedSchedule(token, now);
    return jsonOk(payload);
  } catch (err) {
    return handleApiError(err);
  }
}
