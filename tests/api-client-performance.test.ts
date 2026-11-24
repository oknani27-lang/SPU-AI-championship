import { afterEach, describe, expect, it, vi } from "vitest";
import { getSession, logoutAccount } from "@/lib/api-client";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

describe("concurrent browser reads", () => {
  it("shares only in-flight reads and fetches fresh data after completion", async () => {
    vi.stubGlobal("window", {});
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ authenticated: true }));
    const [first, second] = await Promise.all([getSession(), getSession()]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    await getSession();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not reuse a pending read across logout and does not let old cleanup delete a new read", async () => {
    vi.stubGlobal("window", {});
    let finishOld!: (response: Response) => void;
    let finishNew!: (response: Response) => void;
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
      .mockResolvedValueOnce(json({ ok: true }))
      .mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
    const old = getSession();
    await logoutAccount();
    const fresh = getSession();
    finishOld(json({ user: { id: "old-account" } })); await old;
    const shared = getSession();
    expect(fetch).toHaveBeenCalledTimes(3);
    finishNew(json({ authenticated: false }));
    expect(await fresh).toEqual(await shared);
  });
});
