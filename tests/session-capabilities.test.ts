import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ getAuthContext: vi.fn(async () => null) }));
vi.mock("@/lib/store", () => ({ isLiveSupabaseReady: vi.fn(async () => false) }));
vi.mock("@/lib/env", () => ({ isGeminiConfigured: () => true, isSupabaseConfigured: () => true }));
import { GET } from "@/app/api/auth/session/route";
afterEach(() => vi.unstubAllEnvs());
describe("session deployment capabilities", () => {
  it("does not advertise a file-backed demo or ready database on Vercel", async () => {
    vi.stubEnv("VERCEL", "1");
    expect(await (await GET()).json()).toMatchObject({ authenticated: false, demo_available: false, live_ready: false });
  });
  it("keeps local demo available when the hosted database is not ready", async () => {
    vi.stubEnv("VERCEL", "");
    expect(await (await GET()).json()).toMatchObject({ demo_available: true, live_ready: false });
  });
});
