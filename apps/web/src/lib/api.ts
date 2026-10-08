'use client';
import { useCallback, useEffect, useState } from 'react';

export const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export const getToken = () => {
  try { return localStorage.getItem('l1v_token'); } catch { return null; }
};
export const setToken = (t: string | null) => {
  try { t ? localStorage.setItem('l1v_token', t) : localStorage.removeItem('l1v_token'); } catch { /* ignore */ }
};

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API}/api${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    setToken(null);
    if (typeof window !== 'undefined') window.location.href = '/login';
  }
  if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
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

export const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Admin', MKT: 'Marketing', NOC: 'NOC', FOC: 'FOC (Teknisi)', GA: 'GA / Procurement', FIN: 'Finance',
};

export const TYPE_LABEL: Record<string, string> = {
  NEW_INSTALL: 'Pasang Baru', TROUBLE: 'Trouble Ticket', SUSPEND: 'Suspend', UNSUSPEND: 'Unsuspend', TERMINATE: 'Terminate', STOCK_REQUEST: 'Permintaan Barang',
};

export const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-');

/** Hapus data (konfirmasi + notifikasi ke Admin di server). Mengembalikan true bila berhasil. */
export async function doDelete(path: string, label: string): Promise<boolean> {
  if (!window.confirm(`Hapus ${label}?\nTindakan ini tidak dapat dibatalkan dan akan dicatat serta diberitahukan ke Admin.`)) return false;
  try { await api(path, { method: 'DELETE' }); return true; } catch (e) { window.alert((e as Error).message); return false; }
}

/** Unduh file dari API (butuh header Authorization, jadi lewat fetch → blob). */
export async function download(path: string, filename: string) {
  const res = await fetch(`${API}/api${path}`, { headers: { authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Gagal mengunduh (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
