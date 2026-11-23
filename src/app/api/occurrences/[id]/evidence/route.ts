import { requireAuthContext } from "@/lib/auth";
import { ValidationError } from "@/lib/errors";
import { handleApiError, jsonOk } from "@/lib/http";
import {
  ALLOWED_EVIDENCE_MIME_TYPES,
  MAX_EVIDENCE_BYTES,
} from "@/lib/store/types";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuthContext();
    const { id } = await context.params;

    const formData = await request.formData();
    const fileEntry = formData.get("file");

    if (!fileEntry || !(fileEntry instanceof File)) {
      throw new ValidationError(
        "กรุณาแนบไฟล์รูปภาพหลักฐาน (ฟิลด์ file)",
        "MISSING_FILE"
      );
    }

    const mimeType = fileEntry.type.toLowerCase();
    if (!ALLOWED_EVIDENCE_MIME_TYPES.has(mimeType)) {
      throw new ValidationError(
        "รองรับเฉพาะไฟล์รูปภาพ (JPEG, PNG, WebP, GIF, HEIC) เท่านั้น",
        "INVALID_IMAGE_MIME"
      );
    }

    if (fileEntry.size === 0) {
      throw new ValidationError("ไฟล์รูปภาพว่างเปล่า", "EMPTY_FILE");
    }

    if (fileEntry.size > MAX_EVIDENCE_BYTES) {
      throw new ValidationError("ขนาดไฟล์รูปภาพต้องไม่เกิน 5 MB", "FILE_TOO_LARGE");
    }

    const arrayBuffer = await fileEntry.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);

    // IMPORTANT: Never use AI to judge photo validity — only validate genuine image upload & store privately
    const result = await ctx.store.uploadCompletionEvidence(ctx.userId, id, {
      fileName: fileEntry.name || "evidence.jpg",
      mimeType,
      bytes,
    });

    return jsonOk(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
