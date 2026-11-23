import type { StorageMode } from "@/types/careplan";
import { getServerEnv, isSupabaseConfigured } from "@/lib/env";
import { DemoFileStore } from "@/lib/store/demo-store";
import { SupabaseStore } from "@/lib/store/supabase-store";
import type { CarePlanStore } from "@/lib/store/types";

let demoStoreSingleton: DemoFileStore | null = null;
let supabaseStoreSingleton: SupabaseStore | null = null;
let cachedSupabaseReady: { ready: boolean; checkedAt: number } | null = null;

export function getDemoStore(): DemoFileStore {
  if (!demoStoreSingleton) {
    demoStoreSingleton = new DemoFileStore();
  }
  return demoStoreSingleton;
}

export function getSupabaseStore(): SupabaseStore | null {
  if (!isSupabaseConfigured()) {
    return null;
  }
  if (!supabaseStoreSingleton) {
    supabaseStoreSingleton = new SupabaseStore();
  }
  return supabaseStoreSingleton;
}

/**
 * Checks whether Supabase is configured AND the CarePlan schema migration
 * has been applied (cached for 60 seconds to avoid repeated metadata pings).
 */
export async function isLiveSupabaseReady(): Promise<boolean> {
  const env = getServerEnv();
  if (env.demoModeForced) {
    return false;
  }
  const supa = getSupabaseStore();
  if (!supa) {
    return false;
  }
  const now = Date.now();
  if (cachedSupabaseReady && now - cachedSupabaseReady.checkedAt < 60_000) {
    return cachedSupabaseReady.ready;
  }
  try {
    const ready = await supa.isSchemaReady();
    cachedSupabaseReady = { ready, checkedAt: now };
    return ready;
  } catch {
    cachedSupabaseReady = { ready: false, checkedAt: now };
    return false;
  }
}

export function getStoreByMode(mode: StorageMode): CarePlanStore {
  if (mode === "supabase") {
    const supa = getSupabaseStore();
    if (supa) return supa;
  }
  return getDemoStore();
}

export async function getDefaultAuthStore(): Promise<CarePlanStore> {
  const ready = await isLiveSupabaseReady();
  if (ready) {
    const supa = getSupabaseStore();
    if (supa) return supa;
  }
  return getDemoStore();
}
