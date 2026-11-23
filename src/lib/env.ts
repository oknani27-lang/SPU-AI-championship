import crypto from "crypto";

export interface ServerEnv {
  geminiApiKey: string | null;
  geminiModel: string;
  supabaseUrl: string | null;
  supabasePublishableKey: string | null;
  supabaseSecretKey: string | null;
  appBaseUrl: string;
  cronSecret: string | null;
  demoModeForced: boolean;
  sessionSecret: string;
  demoStoreDir: string | null;
}

function readClean(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.startsWith("your_") ||
    trimmed.startsWith("replace_with_")
  ) {
    return null;
  }
  return trimmed;
}

export function getServerEnv(): ServerEnv {
  const geminiApiKey = readClean(process.env.GEMINI_API_KEY);
  const geminiModel = readClean(process.env.GEMINI_MODEL) ?? "gemini-2.5-flash";
  const supabaseUrl =
    readClean(process.env.SUPABASE_URL) ??
    readClean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabasePublishableKey =
    readClean(process.env.SUPABASE_PUBLISHABLE_KEY) ??
    readClean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const supabaseSecretKey =
    readClean(process.env.SUPABASE_SECRET_KEY) ??
    readClean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const appBaseUrl =
    readClean(process.env.APP_BASE_URL) ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  const cronSecret = readClean(process.env.CRON_SECRET);
  const demoModeForced = process.env.CAREPLAN_DEMO_MODE === "true";
  const demoStoreDir = readClean(process.env.CAREPLAN_DEMO_STORE_DIR);

  // Derive a stable signing secret without exposing any raw env key
  const rawSeed =
    cronSecret ??
    supabaseSecretKey ??
    geminiApiKey ??
    "careplan-local-demo-signing-seed-v1";
  const sessionSecret = crypto
    .createHash("sha256")
    .update(`careplan-session:${rawSeed}`)
    .digest("hex");

  return {
    geminiApiKey,
    geminiModel,
    supabaseUrl,
    supabasePublishableKey,
    supabaseSecretKey,
    appBaseUrl: appBaseUrl.replace(/\/+$/, ""),
    cronSecret,
    demoModeForced,
    sessionSecret,
    demoStoreDir,
  };
}

export function isSupabaseConfigured(): boolean {
  const env = getServerEnv();
  return Boolean(
    env.supabaseUrl && env.supabasePublishableKey && env.supabaseSecretKey
  );
}

export function isGeminiConfigured(): boolean {
  return Boolean(getServerEnv().geminiApiKey);
}
