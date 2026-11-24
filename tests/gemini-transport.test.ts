import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callGeminiJson } from "@/lib/ai/gemini";

const options = { systemInstruction: "Return JSON", userPrompt: "test", schema: z.object({ ok: z.literal(true) }) };
const reply = (candidate: unknown) => new Response(JSON.stringify({ candidates: [candidate] }), { status: 200 });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe("Gemini transport reliability", () => {
  it("retries a transient provider failure once and returns validated output", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-only-key");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("busy", { status: 503 })).mockResolvedValueOnce(reply({ finishReason: "STOP", content: { parts: [{ text: '{"ok":true}' }] } }));
    expect((await callGeminiJson(options)).ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1]?.cache).toBe("no-store");
  });
  it("does not retry quota or invalid credentials", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-only-key");
    const fetch = vi.spyOn(globalThis, "fetch");
    for (const status of [429, 401, 403, 404]) {
      fetch.mockClear(); fetch.mockResolvedValue(new Response("denied", { status }));
      expect(await callGeminiJson(options)).toMatchObject({ ok: false, reason: `gemini_http_${status}` });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  it("ignores thought text and rejects truncated, blocked and invalid JSON output", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-only-key");
    const fetch = vi.spyOn(globalThis, "fetch");
    fetch.mockResolvedValueOnce(reply({ finishReason: "STOP", content: { parts: [{ text: "private reasoning", thought: true }, { text: '{"ok":true}' }] } }));
    expect((await callGeminiJson(options)).ok).toBe(true);
    fetch.mockResolvedValueOnce(reply({ finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"ok":true}' }] } }));
    expect(await callGeminiJson(options)).toMatchObject({ ok: false, reason: "gemini_truncated_response" });
    fetch.mockResolvedValueOnce(reply({ finishReason: "SAFETY" }));
    expect(await callGeminiJson(options)).toMatchObject({ ok: false, reason: "gemini_blocked" });
    fetch.mockResolvedValueOnce(reply({ content: { parts: [{ text: "not JSON" }] } }));
    expect(await callGeminiJson(options)).toMatchObject({ ok: false, reason: "gemini_invalid_json" });
  });
});
