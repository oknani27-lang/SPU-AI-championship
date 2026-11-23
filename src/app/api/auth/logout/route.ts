import { clearSessionCookie } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";

export async function POST() {
  try {
    const response = jsonOk({ ok: true });
    clearSessionCookie(response);
    return response;
  } catch (err) {
    return handleApiError(err);
  }
}
