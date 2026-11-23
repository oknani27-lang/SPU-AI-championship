import crypto from "crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import type { StorageMode } from "@/types/careplan";
import { getServerEnv } from "@/lib/env";
import { UnauthorizedError } from "@/lib/errors";
import { getDemoStore, getSupabaseStore } from "@/lib/store";
import type { CarePlanStore } from "@/lib/store/types";

export const SESSION_COOKIE_NAME = "careplan_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14 days

export interface DemoSessionPayload {
  mode: "demo";
  demo_user_id: string;
  issued_at: number;
}

export interface SupabaseSessionPayload {
  mode: "supabase";
  access_token: string;
  refresh_token?: string;
  issued_at: number;
}

export type SessionCookiePayload = DemoSessionPayload | SupabaseSessionPayload;

export interface AuthenticatedContext {
  userId: string;
  mode: StorageMode;
  store: CarePlanStore;
}

function signData(encodedPayload: string): string {
  const { sessionSecret } = getServerEnv();
  return crypto
    .createHmac("sha256", sessionSecret)
    .update(encodedPayload)
    .digest("base64url");
}

export function createSignedSessionToken(payload: SessionCookiePayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = signData(encoded);
  return `${encoded}.${sig}`;
}

export function verifySignedSessionToken(
  token: string | undefined
): SessionCookiePayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, providedSig] = parts;
  if (!encoded || !providedSig) return null;

  const expectedSig = signData(encoded);
  const a = Buffer.from(providedSig, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const json = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as Partial<SessionCookiePayload>;
    if (
      parsed.mode === "demo" &&
      typeof parsed.demo_user_id === "string" &&
      parsed.demo_user_id.length > 0
    ) {
      return {
        mode: "demo",
        demo_user_id: parsed.demo_user_id,
        issued_at: typeof parsed.issued_at === "number" ? parsed.issued_at : Date.now(),
      };
    }
    if (
      parsed.mode === "supabase" &&
      typeof parsed.access_token === "string" &&
      parsed.access_token.length > 0
    ) {
      return {
        mode: "supabase",
        access_token: parsed.access_token,
        refresh_token:
          typeof parsed.refresh_token === "string"
            ? parsed.refresh_token
            : undefined,
        issued_at: typeof parsed.issued_at === "number" ? parsed.issued_at : Date.now(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function shouldUseSecureCookie(): boolean {
  if (process.env.VERCEL === "1") return true;
  const { appBaseUrl } = getServerEnv();
  return appBaseUrl.startsWith("https://");
}

export function setSessionCookie(
  response: NextResponse,
  payload: SessionCookiePayload
): void {
  const signed = createSignedSessionToken(payload);
  response.cookies.set(SESSION_COOKIE_NAME, signed, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: shouldUseSecureCookie(),
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: shouldUseSecureCookie(),
    maxAge: 0,
  });
}

export async function getAuthContext(): Promise<AuthenticatedContext | null> {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const payload = verifySignedSessionToken(rawToken);
  if (!payload) {
    return null;
  }

  if (payload.mode === "demo") {
    const store = getDemoStore();
    const bootstrap = await store.getUserBootstrap(payload.demo_user_id);
    if (!bootstrap) {
      return null;
    }
    return {
      userId: bootstrap.user.id,
      mode: "demo",
      store,
    };
  }

  const supa = getSupabaseStore();
  if (!supa) {
    return null;
  }
  const verifiedUser = await supa.verifyAccessToken(payload.access_token);
  if (!verifiedUser) {
    return null;
  }

  return {
    userId: verifiedUser.id,
    mode: "supabase",
    store: supa,
  };
}

export async function requireAuthContext(): Promise<AuthenticatedContext> {
  const ctx = await getAuthContext();
  if (!ctx) {
    throw new UnauthorizedError("กรุณาเข้าสู่ระบบก่อนดำเนินการ");
  }
  return ctx;
}
