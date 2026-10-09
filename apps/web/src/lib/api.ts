'use client';
import { useCallback, useEffect, useState } from 'react';
import { confirmDialog, toast } from './dialog';

export const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const TOK = 'maung_token';
const OLD_TOK = 'l1v_token'; // nama lama; dibaca sekali agar pengguna tidak keluar saat pembaruan

export const getToken = () => {
  try {
    const t = localStorage.getItem(TOK) ?? sessionStorage.getItem(TOK) ?? localStorage.getItem(OLD_TOK);
    if (t && !localStorage.getItem(TOK) && !sessionStorage.getItem(TOK)) { localStorage.setItem(TOK, t); localStorage.removeItem(OLD_TOK); }
    return t;
  } catch { return null; }
};
/** remember=true → bertahan setelah browser ditutup (localStorage); false → hanya sesi ini (sessionStorage). */
export const setToken = (t: string | null, remember = true) => {
  try {
    localStorage.removeItem(TOK); sessionStorage.removeItem(TOK); localStorage.removeItem(OLD_TOK);
    if (t) (remember ? localStorage : sessionStorage).setItem(TOK, t);
  } catch { /* ignore */ }
};

/** Galat API; `fields` berisi pesan per-isian (untuk galat inline di form). */
export class ApiError extends Error {
  constructor(message: string, public fields?: Record<string, string>, public status?: number) { super(message); }
}

/** Admin "bertindak sebagai" peran lain (untuk uji alur): disimpan di browser, dikirim sebagai header ke API. */
const ACT = 'maung_act';
export const getAct = (): { role: string; sub: string } | null => {
  try { const v = localStorage.getItem(ACT); if (!v) return null; const [role, sub] = v.split(':'); return { role, sub: sub || 'SUPERVISOR' }; } catch { return null; }
};
export const setAct = (a: { role: string; sub: string } | null) => {
  try { if (a) localStorage.setItem(ACT, `${a.role}:${a.sub}`); else localStorage.removeItem(ACT); } catch { /* ignore */ }
};
const actHeaders = (): Record<string, string> => { const a = getAct(); return a ? { 'x-act-as': a.role, 'x-act-sub': a.sub } : {}; };

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API}/api${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}), ...actHeaders() },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    setToken(null);
    if (typeof window !== 'undefined') window.location.href = '/login';
  }
  if (!res.ok) throw new ApiError(json.error ?? `Error ${res.status}`, json.fields, res.status);
  return json as T;
}

export const fileUrl = (u: string) => (u.startsWith('http') ? u : `${API}${u}`);

export function useFetch<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try { setData(await api<T>(path)); setError(null); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [path]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}

export const SUBROLE_LABEL: Record<string, string> = { MANAGER: 'Manager', SUPERVISOR: 'Supervisor', STAFF: 'Staff' };

/** "Marketing · Supervisor" (Admin tanpa sub-role). */
export const roleText = (u: { role: string; subRole?: string }) => `${ROLE_LABEL[u.role] ?? u.role}${u.role !== 'ADMIN' && u.subRole ? ` · ${SUBROLE_LABEL[u.subRole] ?? u.subRole}` : ''}`;

export const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Admin', MKT: 'Marketing', NOC: 'NOC', FOC: 'FOC (Teknisi)', GA: 'GA / Procurement', FIN: 'Finance',
};

export const TYPE_LABEL: Record<string, string> = {
  NEW_INSTALL: 'Pasang Baru', TROUBLE: 'Trouble Ticket', SUSPEND: 'Suspend', UNSUSPEND: 'Unsuspend', TERMINATE: 'Terminate', STOCK_REQUEST: 'Permintaan Barang', STOCK_RETURN: 'Serah-terima Sisa',
};

/** "5 mnt lalu", "kemarin", atau tanggal bila lebih dari seminggu. */
export function timeAgo(d: string | Date) {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 45) return 'baru saja';
  if (s < 3600) return `${Math.round(s / 60)} mnt lalu`;
  if (s < 86400) return `${Math.round(s / 3600)} jam lalu`;
  if (s < 172800) return 'kemarin';
  if (s < 7 * 86400) return `${Math.round(s / 86400)} hari lalu`;
  return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-');

/** Hapus data (konfirmasi + notifikasi ke Admin di server). Mengembalikan true bila berhasil. */
export async function doDelete(path: string, label: string): Promise<boolean> {
  if (!(await confirmDialog(`Hapus ${label}?\nTindakan ini akan dicatat dan diberitahukan ke Admin.`, { danger: true }))) return false;
  try {
    const r = await api<{ mode?: string }>(path, { method: 'DELETE' });
    toast.success(r?.mode === 'archived' ? `${label} diarsipkan (masih punya riwayat Work Order, jadi tidak dihapus permanen).` : `${label} dihapus.`);
    return true;
  } catch (e) { toast.error((e as Error).message); return false; }
}

/** Unduh file dari API (butuh header Authorization, jadi lewat fetch → blob). */
export async function download(path: string, filename: string) {
  const res = await fetch(`${API}/api${path}`, { headers: { authorization: `Bearer ${getToken()}`, ...actHeaders() } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Gagal mengunduh (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
