'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api';

export interface Me { id: string; name: string; email: string; role: string; subRole: string; telegramLinked: boolean; mustChangePassword?: boolean; /** akun asli Admin yang sedang bertindak sebagai `role` */ realAdmin?: boolean }
interface AuthCtx { user: Me | null; ready: boolean; login(email: string, password: string, remember?: boolean): Promise<void>; logout(): void }

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) return setReady(true);
    api<Me & { acting?: { role: string; subRole: string } | null }>('/auth/me').then((m) => {
      const { acting, ...me } = m;
      setUser(acting ? { ...me, role: acting.role, subRole: acting.subRole, realAdmin: true } : me);
    }).catch(() => setToken(null)).finally(() => setReady(true));
  }, []);

  const login = useCallback(async (email: string, password: string, remember = true) => {
    const r = await api<{ token: string; user: Me }>('/auth/login', { body: { email, password } });
    setToken(r.token, remember);
    setUser(r.user);
  }, []);
  const logout = useCallback(() => { setToken(null); setUser(null); window.location.href = '/login'; }, []);

  return <Ctx.Provider value={{ user, ready, login, logout }}>{children}</Ctx.Provider>;
}
