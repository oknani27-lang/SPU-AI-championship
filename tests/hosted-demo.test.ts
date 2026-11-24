import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ start: vi.fn(), context: vi.fn(), cookie: vi.fn(), bootstrap: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthContext: mocks.context, setSessionCookie: mocks.cookie }));
vi.mock("@/lib/store", () => ({ getSupabaseStore: () => ({ startHostedDemo: mocks.start }), isLiveSupabaseReady: async () => true, getDemoStore: () => { throw new Error("Hosted demo must not use files"); } }));
import { POST } from "@/app/api/auth/demo/route";
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
describe("hosted demo sessions", () => {
  it("uses real Supabase session cookies without exposing tokens in the response", async () => {
    vi.stubEnv("VERCEL", "1"); mocks.context.mockResolvedValue(null);
    mocks.start.mockResolvedValue({ user: { id: "new-demo" }, access_token: "private-test-token", refresh_token: "private-refresh" });
    const response = await POST(new Request("https://app.test/api/auth/demo", { method: "POST", headers: { origin: "https://app.test" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: { id: "new-demo" }, mode: "supabase" });
    expect(mocks.cookie).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mode: "supabase", access_token: "private-test-token" }));
  });
  it("resumes the same browser's demo without creating another account", async () => {
    vi.stubEnv("VERCEL", "1");
    mocks.bootstrap.mockResolvedValue({ user: { id: "existing-demo", email: "example@careplan-demo.invalid" } });
    mocks.context.mockResolvedValue({ mode: "supabase", userId: "existing-demo", store: { getUserBootstrap: mocks.bootstrap } });
    expect((await POST(new Request("https://app.test/api/auth/demo", { method: "POST" }))).status).toBe(200);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("rejects cross-site demo creation before allocating an account", async () => {
    vi.stubEnv("VERCEL", "1");
    expect((await POST(new Request("https://app.test/api/auth/demo", { method: "POST", headers: { origin: "https://other.test" } }))).status).toBe(403);
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
