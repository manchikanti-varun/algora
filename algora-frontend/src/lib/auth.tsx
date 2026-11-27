'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, setCsrfToken, setUnauthorizedHandler } from './api';

export type Role = 'SUPER_ADMIN' | 'TRAINER' | 'STUDENT';
export interface SessionUser {
  id: string; role: Role; email: string; fullName: string; picture?: string;
  trainerId?: string; rollNumber?: string; canManageCourses: boolean;
}
interface Ctx {
  user: SessionUser | null;
  loading: boolean;
  expired: boolean;
  setSession: (user: SessionUser, csrfToken: string) => void;
  logout: () => Promise<void>;
}
const AuthCtx = createContext<Ctx | null>(null);
export const homeFor = (r: Role) => (r === 'STUDENT' ? '/student/dashboard' : '/manage/dashboard');

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const sessionEvents = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    api<{ user: SessionUser; csrfToken: string }>('/auth/me')
      .then((r) => { setCsrfToken(r.csrfToken); setUser(r.user); })
      .catch((e) => { if (!(e instanceof ApiError && e.status === 401)) console.error(e); })
      .finally(() => setLoading(false));
    // Any 401 later (expired, suspended or revoked session) signs the user out of the UI.
    setUnauthorizedHandler(() => { setCsrfToken(null); setUser((u) => { if (u) setExpired(true); return null; }); });
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('algora-session');
    sessionEvents.current = channel;
    // The session cookie is shared across tabs. Reload to discard the previous account's state and rehydrate.
    channel?.addEventListener('message', () => {
      setCsrfToken(null);
      window.location.reload();
    });
    return () => {
      sessionEvents.current = null;
      channel?.close();
      setUnauthorizedHandler(null);
    };
  }, []);

  const setSession = useCallback((u: SessionUser, t: string) => {
    setCsrfToken(t);
    setExpired(false);
    setUser(u);
    sessionEvents.current?.postMessage('changed');
  }, []);
  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' });
    setCsrfToken(null);
    setUser(null);
    sessionEvents.current?.postMessage('changed');
  }, []);
  return <AuthCtx.Provider value={{ user, loading, expired, setSession, logout }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => {
  const c = useContext(AuthCtx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
};
export const isAdmin = (u: SessionUser | null) => u?.role === 'SUPER_ADMIN';
