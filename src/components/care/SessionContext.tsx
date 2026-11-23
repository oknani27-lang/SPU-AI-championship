"use client";

import * as React from "react";
import {
  getSession,
  logoutAccount,
  startDemoSession,
} from "@/lib/api-client";
import type { SessionState } from "@/types/careplan";

interface SessionContextValue {
  session: SessionState | null;
  loading: boolean;
  error: string | null;
  refreshSession: () => Promise<SessionState | null>;
  startDemo: (reset?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  demoVersion: number;
}

const SessionContext = React.createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<SessionState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [demoVersion, setDemoVersion] = React.useState(0);

  const refreshSession = React.useCallback(async () => {
    try {
      setError(null);
      const data = await getSession();
      setSession(data);
      return data;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "ไม่สามารถโหลดข้อมูลเซสชันได้";
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const startDemo = React.useCallback(
    async (reset = false) => {
      setLoading(true);
      setError(null);
      try {
        await startDemoSession(reset);
        await refreshSession();
        if (reset) {
          setDemoVersion((v) => v + 1);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "ไม่สามารถเริ่มโหมดสาธิตได้"
        );
        setLoading(false);
        throw err;
      }
    },
    [refreshSession]
  );

  const logout = React.useCallback(async () => {
    try {
      await logoutAccount();
    } finally {
      await refreshSession();
    }
  }, [refreshSession]);

  const value = React.useMemo<SessionContextValue>(
    () => ({
      session,
      loading,
      error,
      refreshSession,
      startDemo,
      logout,
      demoVersion,
    }),
    [session, loading, error, refreshSession, startDemo, logout, demoVersion]
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = React.useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return ctx;
}
