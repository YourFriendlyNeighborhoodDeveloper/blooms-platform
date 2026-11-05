import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '../lib/api';

export type StaffUser = { id: string; email: string; display_name: string; staff_id: string | null; roles: string[]; permissions: string[] };

type SessionState = { user: StaffUser | null; loading: boolean; signIn: (email: string, password: string) => Promise<void>; signOut: () => Promise<void>; refresh: () => Promise<void>; can: (...p: string[]) => boolean };

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<StaffUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api<{ user: StaffUser }>('/api/admin/auth/me');
      setUser(res.user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setUser(null);
      else throw err;
    }
  }, []);

  useEffect(() => {
    refresh()
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [refresh]);

  const value: SessionState = {
    user,
    loading,
    refresh,
    signIn: async (email, password) => {
      const res = await api<{ user: StaffUser }>('/api/admin/auth/login', { body: { email, password } });
      setUser(res.user);
    },
    signOut: async () => {
      await api('/api/admin/auth/logout', { body: {} });
      setUser(null);
    },
    can: (...p) => Boolean(user) && p.every((x) => user?.permissions.includes(x)),
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
