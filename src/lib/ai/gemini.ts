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

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 12_000
  );

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.geminiApiKey,
      },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: options.systemInstruction }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: options.userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        reason: `gemini_http_${response.status}`,
        model,
        latencyMs: Date.now() - startedAt,
      };
    }

    const payload = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const rawText = payload.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("\n")
      .trim();

    if (!rawText) {
      return {
        ok: false,
        reason: "gemini_empty_response",
        model,
        latencyMs: Date.now() - startedAt,
      };
    }

    const jsonStr = extractJsonString(rawText);
    const parsedJson: unknown = JSON.parse(jsonStr);
    const validated = options.schema.safeParse(parsedJson);

    if (!validated.success) {
      return {
        ok: false,
        reason: "gemini_schema_validation_failed",
        model,
        latencyMs: Date.now() - startedAt,
      };
    }

    return {
      ok: true,
      data: validated.data,
      model,
      latencyMs: Date.now() - startedAt,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      reason: isAbort ? "gemini_timeout" : "gemini_network_or_parse_error",
      model,
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}
