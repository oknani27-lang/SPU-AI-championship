import { requireAuthContext } from "@/lib/auth";
import { aftercareRequestSchema, summarizeDoctorVisit } from "@/lib/ai/aftercare";
import { AppError, ForbiddenError, ValidationError } from "@/lib/errors";
import { handleApiError, jsonOk } from "@/lib/http";

export async function POST(request: Request) {
  try {
    await requireAuthContext();
    if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new ForbiddenError("ไม่อนุญาตคำขอจากเว็บไซต์อื่น");
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new AppError("รองรับข้อมูล JSON เท่านั้น", 415, "UNSUPPORTED_MEDIA_TYPE");
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 32768) throw new AppError("ข้อความมีขนาดใหญ่เกินไป", 413, "PAYLOAD_TOO_LARGE");
    let raw: unknown;
    try { raw = JSON.parse(body); } catch { throw new ValidationError("ข้อมูล JSON ไม่ถูกต้อง"); }
    const input = aftercareRequestSchema.parse(raw);
    const result = await summarizeDoctorVisit(input.text);
    const response = jsonOk(result);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const response = handleApiError(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
