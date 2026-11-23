import { NextResponse } from "next/server";
import { requireAuthContext } from "@/lib/auth";
import { handleApiError } from "@/lib/http";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuthContext();
    const { id } = await context.params;
    const { evidence, bytes } = await ctx.store.getEvidenceFile(ctx.userId, id);

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": evidence.mime_type,
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `inline; filename="${evidence.file_name.replace(/"/g, "")}"`,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
