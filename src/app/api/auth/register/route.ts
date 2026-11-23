import { z } from "zod";
import { setSessionCookie } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";
import { getDefaultAuthStore } from "@/lib/store";

const registerSchema = z.object({
  email: z.string().email("รูปแบบอีเมลไม่ถูกต้อง"),
  password: z.string().min(6, "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร"),
  full_name: z.string().min(1, "กรุณากรอกชื่อผู้ดูแล").max(120),
  care_recipient_name: z.string().max(120).optional(),
  care_recipient_age: z.number().int().min(0).max(130).nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const rawBody: unknown = await request.json();
    const input = registerSchema.parse(rawBody);
    const store = await getDefaultAuthStore();
    const result = await store.registerUser(input);

    const response = jsonOk(
      {
        user: result.user,
        mode: result.mode,
        requires_email_confirmation: result.requires_email_confirmation ?? false,
      },
      201
    );

    if (result.mode === "demo") {
      setSessionCookie(response, {
        mode: "demo",
        demo_user_id: result.user.id,
        issued_at: Date.now(),
      });
    } else if (result.access_token) {
      setSessionCookie(response, {
        mode: "supabase",
        access_token: result.access_token,
        refresh_token: result.refresh_token,
        issued_at: Date.now(),
      });
    }

    return response;
  } catch (err) {
    return handleApiError(err);
  }
}
