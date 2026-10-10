'use client';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Select } from '@/components/Select';

/**
 * Tabel data dengan paginasi, pencarian, dan pengurutan di SERVER.
 * Hanya satu halaman yang diunduh/dirender sekali waktu, sehingga tetap cepat walau datanya ratusan ribu baris.
 * Memakai respons paged API: { rows, total, page, pageSize, pageCount }.
 */
export interface Column<T> {
  key: string;
  header: string;
  /** kunci `sort` di API; kosong = kolom tidak bisa diurutkan */
  sort?: string;
  render?: (row: T) => ReactNode;
  className?: string;
}

interface Paged<T> { rows: T[]; total: number; page: number; pageSize: number; pageCount: number }

const SIZES = [10, 25, 50, 100];
const SIZE_KEY = 'maung_pagesize';
const OLD_SIZE_KEY = 'l1v_pagesize'; // nama lama; dibaca sekali agar pilihan pengguna tidak hilang

export function DataTable<T extends { id: string }>({
  path, columns, params, initialQ = '', search = true, searchPlaceholder = 'Cari…', defaultSort, defaultDir = 'desc',
  filters, toolbar, empty = 'Tidak ada data', refreshKey = 0, selectable, selected, onSelectedChange, selectionBar, rowKey, onLoaded,
}: {
  path: string;
  columns: Column<T>[];
  /** parameter tetap (filter) — ubah nilainya untuk memuat ulang dari halaman 1 */
  params?: Record<string, string | undefined>;
  /** isi awal kotak cari (mis. dari pencarian global di header) */
  initialQ?: string;
  search?: boolean;
  searchPlaceholder?: string;
  defaultSort?: string;
  defaultDir?: 'asc' | 'desc';
  filters?: ReactNode;
  toolbar?: ReactNode;
  empty?: string;
  refreshKey?: number;
  selectable?: boolean;
  selected?: string[];
  onSelectedChange?: (ids: string[]) => void;
  /** area di bawah tabel saat ada pilihan; menerima total hasil */
  selectionBar?: (info: { total: number; pageIds: string[]; q: string }) => ReactNode;
  rowKey?: (r: T) => string;
  onLoaded?: (d: Paged<T>) => void;
}) {
  const [q, setQ] = useState(initialQ);
  const [dq, setDq] = useState(initialQ.trim());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<string | undefined>(defaultSort);
  const [dir, setDir] = useState<'asc' | 'desc'>(defaultDir);
  const [data, setData] = useState<Paged<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [jump, setJump] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(SIZE_KEY) ?? localStorage.getItem(OLD_SIZE_KEY));
      if (SIZES.includes(v)) { setPageSize(v); localStorage.setItem(SIZE_KEY, String(v)); }
      localStorage.removeItem(OLD_SIZE_KEY);
    } catch { /* ignore */ }
  }, []);
  // urutan bawaan berubah (mis. pindah tab "Tugas saya" → "Semua terbuka") → kembali ke urutan bawaan yang baru
  useEffect(() => { setSort(defaultSort); setDir(defaultDir); }, [defaultSort, defaultDir]);
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const paramsKey = JSON.stringify(params ?? {});
  useEffect(() => { setPage(1); }, [dq, paramsKey, pageSize, sort, dir]);

  const url = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params ?? {})) if (v) p.set(k, v);
    if (dq) p.set('q', dq);
    p.set('page', String(page)); p.set('pageSize', String(pageSize));
    if (sort) { p.set('sort', sort); p.set('dir', dir); }
    return `${path}?${p}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, paramsKey, dq, page, pageSize, sort, dir]);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await api<Paged<T>>(url);
      if (my !== seq.current) return; // respons lama (pengguna sudah mengubah filter) diabaikan
      setData(d); setError(''); onLoaded?.(d);
      if (d.page > d.pageCount) setPage(d.pageCount); // mis. setelah data dihapus
    } catch (e) { if (my === seq.current) setError((e as Error).message); } finally { if (my === seq.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = data?.pageCount ?? 1;
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  const pageIds = rows.map((r) => r.id);
  const sel = selected ?? [];
  const allOnPage = !!rows.length && pageIds.every((id) => sel.includes(id));

  const toggleSort = (s: string) => { if (sort === s) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(s); setDir('asc'); } };
  const window_: (number | '…')[] = useMemo(() => {
    const set = new Set([1, pageCount, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pageCount));
    const list = [...set].sort((a, b) => a - b);
    const out: (number | '…')[] = [];
    list.forEach((n, i) => { if (i && n - list[i - 1] > 1) out.push('…'); out.push(n); });
    return out;
  }, [page, pageCount]);

  return (
    <div className="space-y-3">
      {(search || filters || toolbar) && (
        <div className="flex flex-wrap items-center gap-2">
          {search && <input className="input w-72" placeholder={searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari" />}
          {filters}
          <div className="ml-auto flex flex-wrap items-center gap-2">{toolbar}</div>
        </div>
      )}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="card relative overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b bg-slate-50">
            <tr>
              {selectable && <th className="th w-8"><input type="checkbox" aria-label="Pilih semua di halaman ini" checked={allOnPage} onChange={() => onSelectedChange?.(allOnPage ? sel.filter((id) => !pageIds.includes(id)) : [...new Set([...sel, ...pageIds])])} /></th>}
              {columns.map((c) => (
                <th key={c.key} className={`th ${c.className ?? ''}`} aria-sort={c.sort && sort === c.sort ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {c.sort ? (
                    <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-slate-800" onClick={() => toggleSort(c.sort!)}>
                      {c.header}<span className={sort === c.sort ? 'text-accent-600' : 'text-slate-300'}>{sort === c.sort ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                    </button>
                  ) : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={`divide-y ${loading ? 'opacity-50' : ''}`}>
            {rows.map((r) => (
              <tr key={rowKey ? rowKey(r) : r.id} className="hover:bg-slate-50">
                {selectable && <td className="td"><input type="checkbox" aria-label="Pilih baris" checked={sel.includes(r.id)} onChange={() => onSelectedChange?.(sel.includes(r.id) ? sel.filter((x) => x !== r.id) : [...sel, r.id])} /></td>}
                {columns.map((c) => <td key={c.key} className={`td ${c.className ?? ''}`}>{c.render ? c.render(r) : String((r as any)[c.key] ?? '-')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="p-6 text-center text-sm text-slate-400">{loading ? 'Memuat…' : dq ? `Tidak ada hasil untuk “${dq}”` : empty}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
        <span>{total ? `${from.toLocaleString('id-ID')}–${to.toLocaleString('id-ID')} dari ${total.toLocaleString('id-ID')}` : '0 data'}{loading && ' · memuat…'}</span>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1">Baris
            <Select className="input !w-auto !py-1" value={pageSize} onChange={(e) => { const v = Number(e.target.value); setPageSize(v); try { localStorage.setItem(SIZE_KEY, String(v)); } catch { /* ignore */ } }}>{SIZES.map((s) => <option key={s}>{s}</option>)}</Select>
          </label>
          <nav className="flex items-center gap-1" aria-label="Halaman">
            <button className="btn-ghost !px-2 !py-1" disabled={page <= 1} onClick={() => setPage(1)} aria-label="Halaman pertama">«</button>
            <button className="btn-ghost !px-2 !py-1" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Sebelumnya">‹</button>
            {window_.map((n, i) => n === '…' ? <span key={`e${i}`} className="px-1">…</span> : (
              <button key={n} onClick={() => setPage(n)} aria-current={n === page ? 'page' : undefined} className={`rounded-lg border px-2.5 py-1 ${n === page ? 'border-accent-500 bg-accent-500 font-semibold text-brand-900' : 'border-slate-300 hover:bg-slate-50'}`}>{n}</button>
            ))}
            <button className="btn-ghost !px-2 !py-1" disabled={page >= pageCount} onClick={() => setPage(page + 1)} aria-label="Berikutnya">›</button>
            <button className="btn-ghost !px-2 !py-1" disabled={page >= pageCount} onClick={() => setPage(pageCount)} aria-label="Halaman terakhir">»</button>
          </nav>
          {pageCount > 5 && (
            <form onSubmit={(e) => { e.preventDefault(); const n = Math.min(pageCount, Math.max(1, Number(jump) || 1)); setPage(n); setJump(''); }} className="flex items-center gap-1">
              ke <input className="input !w-16 !py-1" inputMode="numeric" value={jump} onChange={(e) => setJump(e.target.value)} aria-label="Ke halaman" />
            </form>
          )}
        </div>
      </div>
      {selectable && selectionBar?.({ total, pageIds, q: dq })}
    </div>
  );
}
