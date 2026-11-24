import type { ZodType } from "zod";
import { getServerEnv } from "@/lib/env";

export interface GeminiJsonResult<T> {
  ok: true;
  data: T;
  model: string;
  latencyMs: number;
}

export interface GeminiJsonFailure {
  ok: false;
  reason: string;
  model: string;
  latencyMs: number;
}

function extractJsonString(rawText: string): string {
  const trimmed = rawText.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fenced) {
    return fenced[1].trim();
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

/**
 * Calls Google Gemini REST API server-side with structured JSON output
 * and strict Zod validation. Never logs or leaks GEMINI_API_KEY.
 */
export async function callGeminiJson<T>(options: {
  systemInstruction: string;
  userPrompt: string;
  schema: ZodType<T>;
  timeoutMs?: number;
  forceFallback?: boolean;
  thinkingLevel?: "minimal" | "low";
  maxOutputTokens?: number;
}): Promise<GeminiJsonResult<T> | GeminiJsonFailure> {
  const env = getServerEnv();
  const model = env.geminiModel;
  const startedAt = Date.now();

  if (options.forceFallback || !env.geminiApiKey) {
    return {
      ok: false,
      reason: options.forceFallback
        ? "fallback_forced"
        : "gemini_api_key_not_configured",
      model,
      latencyMs: Date.now() - startedAt,
    };
  }


  const failure = (reason: string): GeminiJsonFailure => ({ ok: false, reason, model, latencyMs: Date.now() - startedAt });
  const deadline = startedAt + (options.timeoutMs ?? 12000);
  // Retry only transient provider failures once. Never retry auth/quota/validation errors.
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.geminiApiKey },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: options.systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: options.userPrompt }] }],
          generationConfig: {
            temperature: 0.2, responseMimeType: "application/json",
            ...(options.thinkingLevel ? { thinkingConfig: { thinkingLevel: options.thinkingLevel } } : {}),
            ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
          },
        }),
      });
      if (!response.ok) {
        if (attempt === 0 && [500,502,503,504].includes(response.status) && deadline - Date.now() > 1200) {
          clearTimeout(timeout);
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
        return failure(`gemini_http_${response.status}`);
      }
      const payload = await response.json() as {
        promptFeedback?: { blockReason?: string };
        candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
      };
      const candidate = payload.candidates?.[0];
      if (payload.promptFeedback?.blockReason || (candidate?.finishReason && !["STOP","MAX_TOKENS"].includes(candidate.finishReason))) return failure("gemini_blocked");
      if (candidate?.finishReason === "MAX_TOKENS") return failure("gemini_truncated_response");
      const rawText = candidate?.content?.parts?.filter(part => !part.thought && typeof part.text === "string").map(part => part.text).join("\n").trim();
      if (!rawText) return failure("gemini_empty_response");
      let json: unknown;
      try { json = JSON.parse(extractJsonString(rawText)); } catch { return failure("gemini_invalid_json"); }
      const validated = options.schema.safeParse(json);
      if (!validated.success) return failure("gemini_schema_validation_failed");
      return { ok: true, data: validated.data, model, latencyMs: Date.now() - startedAt };
    } catch (error) {
      // Do not turn blocked/invalid/truncated provider output into a success.
      return failure(error instanceof Error && error.name === "AbortError" ? "gemini_timeout" : "gemini_network_error");
    } finally { clearTimeout(timeout); }
  }
  return failure("gemini_unavailable");
}
