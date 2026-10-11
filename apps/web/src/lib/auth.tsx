'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, getToken, setToken } from './api';

const LAST = 'maung_last_active'; // waktu aktivitas terakhir (dibagi antar tab)
const now = () => Date.now();

export interface Me { id: string; name: string; email: string; role: string; subRole: string; avatarUrl?: string | null; telegramLinked: boolean; mustChangePassword?: boolean; /** fitur yang boleh dipakai (Admin → Hak Akses) */ features?: string[]; /** akun asli Admin yang sedang bertindak sebagai `role` */ realAdmin?: boolean }
interface AuthCtx { user: Me | null; ready: boolean; login(email: string, password: string, remember?: boolean): Promise<void>; logout(): void }

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [sessMin, setSessMin] = useState(30); // batas sesi diam (menit) dari server
  const [warnLeft, setWarnLeft] = useState<number | null>(null); // detik tersisa saat peringatan
  const lastRefresh = useRef(now());

  useEffect(() => {
    if (!getToken()) return setReady(true);
    api<Me & { acting?: { role: string; subRole: string } | null; sessionMinutes?: number }>('/auth/me').then((m) => {
      const { acting, sessionMinutes, ...me } = m;
      if (sessionMinutes) setSessMin(sessionMinutes);
      setUser(acting ? { ...me, role: acting.role, subRole: acting.subRole, realAdmin: true } : me);
    }).catch(() => setToken(null)).finally(() => setReady(true));
  }, []);

  const login = useCallback(async (email: string, password: string, remember = true) => {
    const r = await api<{ token: string; user: Me; sessionMinutes?: number }>('/auth/login', { body: { email, password } });
    setToken(r.token, remember);
    if (r.sessionMinutes) setSessMin(r.sessionMinutes);
    try { localStorage.setItem(LAST, String(now())); } catch { /* abaikan */ }
    lastRefresh.current = now();
    try { const m = await api<Me>('/auth/me'); setUser({ ...r.user, features: m.features }); } catch { setUser(r.user); }
  }, []);
  const logout = useCallback(() => { setToken(null); setUser(null); window.location.href = '/login'; }, []);

  /** Perpanjang token (sesi) — dipanggil otomatis selama pengguna aktif, atau lewat tombol "Tetap masuk". */
  const extend = useCallback(async () => {
    try {
      const inLocal = !!localStorage.getItem('maung_token');
      const r = await api<{ token: string }>('/auth/refresh', { body: {} });
      setToken(r.token, inLocal);
      lastRefresh.current = now();
      try { localStorage.setItem(LAST, String(now())); } catch { /* abaikan */ }
      setWarnLeft(null);
    } catch { /* 401 ditangani api() → ke halaman login */ }
  }, []);

  // Pengaman sesi diam: aktivitas (mouse/ketik/sentuh/scroll) menunda kedaluwarsa; diam ≥ batas → keluar otomatis.
  useEffect(() => {
    if (!user) return;
    const mark = () => { try { localStorage.setItem(LAST, String(now())); } catch { /* abaikan */ } };
    let t = 0; const onAct = () => { const n = now(); if (n - t > 5000) { t = n; mark(); } };
    const evs = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'] as const;
    evs.forEach((e) => window.addEventListener(e, onAct, { passive: true }));
    mark();
    const limit = sessMin * 60_000;
    const id = window.setInterval(() => {
      let last = now(); try { last = Number(localStorage.getItem(LAST)) || last; } catch { /* abaikan */ }
      const idle = now() - last;
      if (idle >= limit) { setToken(null); window.location.href = '/login?expired=1'; return; }
      const left = limit - idle;
      if (left <= 120_000) setWarnLeft(Math.ceil(left / 1000)); else if (warnLeft !== null) setWarnLeft(null);
      // pengguna aktif & token mulai tua (> 1/3 batas) → perpanjang di belakang layar
      if (idle < 60_000 && now() - lastRefresh.current > Math.max(120_000, limit / 3)) void extend();
    }, 15_000);
    return () => { evs.forEach((e) => window.removeEventListener(e, onAct)); window.clearInterval(id); };
  }, [user, sessMin, extend, warnLeft]);

  return (
    <Ctx.Provider value={{ user, ready, login, logout }}>
      {children}
      {user && warnLeft !== null && (
        <div role="alertdialog" aria-live="assertive" className="fixed inset-x-3 bottom-3 z-[100] mx-auto flex max-w-md flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg dark:bg-slate-800 dark:text-amber-200">
          <span>Sesi akan berakhir dalam <b>{Math.floor(warnLeft / 60)}:{String(warnLeft % 60).padStart(2, '0')}</b> karena tidak ada aktivitas.</span>
          <button className="btn !py-1" onClick={() => void extend()}>Tetap masuk</button>
        </div>
      )}
    </Ctx.Provider>
  );
}
