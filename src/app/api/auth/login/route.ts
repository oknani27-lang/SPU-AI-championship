import { z } from "zod";
import { setSessionCookie } from "@/lib/auth";
import { handleApiError, jsonOk } from "@/lib/http";
import { getDefaultAuthStore } from "@/lib/store";

const loginSchema = z.object({
  email: z.string().email("รูปแบบอีเมลไม่ถูกต้อง"),
  password: z.string().min(1, "กรุณากรอกรหัสผ่าน"),
});

export async function POST(request: Request) {
  try {
    const rawBody: unknown = await request.json();
    const input = loginSchema.parse(rawBody);
    const store = await getDefaultAuthStore();
    const result = await store.loginUser(input);

    const response = jsonOk({
      user: result.user,
      mode: result.mode,
    });

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
