'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, fmtDate, useFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ErrorMsg, PageHeader } from '@/components/ui';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const fmt = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('id-ID') : v === null || v === undefined || v === '' ? '-' : String(v));

/** Laporan dari data yang ada (khusus Admin): pilih laporan, atur periode, lihat tabel, unduh CSV. */
export default function Laporan() {
  const { user } = useAuth();
  const { data: list, error } = useFetch<any[]>(user?.role === 'ADMIN' ? '/admin/reports' : null);
  const [key, setKey] = useState('wo-per-jenis');
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86400_000)));
  const [to, setTo] = useState(iso(new Date()));
  const [rep, setRep] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const cur = list?.find((r) => r.key === key);
  const groups = useMemo(() => [...new Set((list ?? []).map((r) => r.group))], [list]);
  useEffect(() => {
    if (!cur) return;
    setBusy(true); setErr('');
    api<any>(`/admin/reports/${key}?from=${from}&to=${to}`).then(setRep).catch((e) => { setRep(null); setErr(e.message); }).finally(() => setBusy(false));
  }, [key, from, to, !!list]); // eslint-disable-line react-hooks/exhaustive-deps
  if (user && user.role !== 'ADMIN') return <ErrorMsg>Khusus Admin</ErrorMsg>;
  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  if (!list) return <p className="text-slate-500">Memuat…</p>;
  const csv = () => {
    if (!rep) return;
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const body = [rep.columns.map((c: any) => esc(c.label)).join(','), ...rep.rows.map((r: any) => rep.columns.map((c: any) => esc(r[c.key])).join(','))].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' }));
    a.download = `${key}-${iso(new Date())}.csv`; a.click();
  };
  const totals = rep ? rep.columns.map((c: any) => (c.align === 'right' && rep.rows.length > 1 && rep.rows.every((r: any) => typeof r[c.key] === 'number') && !/rata|terlama|umur/i.test(c.label) ? rep.rows.reduce((n: number, r: any) => n + r[c.key], 0) : null)) : [];
  return (
    <>
      <PageHeader pretitle="Sistem" title="Laporan" sub="Ringkasan dari data yang ada — saat ini hanya dapat dilihat Admin" />
      <div className="grid items-start gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <nav className="space-y-3" aria-label="Daftar laporan">
          {groups.map((g) => (
            <div key={g}><div className="subheader mb-1 px-2">{g}</div>
              <div className="flex flex-wrap gap-1 lg:flex-col">{list.filter((r) => r.group === g).map((r) => (
                <button key={r.key} onClick={() => setKey(r.key)} className={`rounded-lg px-3 py-2 text-left text-sm transition ${key === r.key ? 'bg-accent-100 font-semibold text-brand-900 dark:bg-slate-700 dark:text-white' : 'text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{r.title}</button>
              ))}</div></div>
          ))}
        </nav>
        <div className="min-w-0 space-y-3">
          <div className="card space-y-2">
            <h2 className="font-semibold">{cur?.title}</h2>
            <p className="text-sm text-slate-500">{cur?.description}</p>
            <div className="flex flex-wrap items-end gap-3">
              {cur?.timed ? <>
                <label className="text-sm">Dari<input className="input mt-1" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
                <label className="text-sm">Sampai<input className="input mt-1" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
                <div className="flex gap-1">{[['7 hari', 7], ['30 hari', 30], ['90 hari', 90]].map(([l, n]) => <button key={l as string} className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={() => { setTo(iso(new Date())); setFrom(iso(new Date(Date.now() - (n as number) * 86400_000))); }}>{l}</button>)}</div>
              </> : <span className="text-xs text-slate-500">Laporan kondisi saat ini (tidak memakai periode).</span>}
              <button className="btn-ghost ml-auto" disabled={!rep?.rows.length} onClick={csv}>⬇ Unduh CSV</button>
            </div>
          </div>
          <ErrorMsg>{err}</ErrorMsg>
          <div className={`card overflow-x-auto p-0 ${busy ? 'opacity-60' : ''}`}>
            {rep && (
              <table className="w-full text-sm">
                <thead className="border-b bg-slate-50 dark:bg-slate-800"><tr>{rep.columns.map((c: any) => <th key={c.key} className={`th ${c.align === 'right' ? 'text-right' : ''}`}>{c.label}</th>)}</tr></thead>
                <tbody className="divide-y">
                  {rep.rows.map((r: any, i: number) => <tr key={i}>{rep.columns.map((c: any) => <td key={c.key} className={`td ${c.align === 'right' ? 'text-right tabular-nums' : ''} ${/^(HABIS|MENIPIS)$/.test(String(r[c.key])) ? 'font-semibold text-red-600' : ''}`}>{fmt(r[c.key])}</td>)}</tr>)}
                  {totals.some((t: unknown) => t !== null) && <tr className="bg-slate-50 font-semibold dark:bg-slate-800">{rep.columns.map((c: any, i: number) => <td key={c.key} className={`td ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>{i === 0 ? 'Total' : totals[i] !== null ? fmt(totals[i]) : ''}</td>)}</tr>}
                </tbody>
              </table>
            )}
            {rep && !rep.rows.length && <p className="p-6 text-center text-sm text-slate-400">Tidak ada data pada periode ini</p>}
          </div>
          {rep && <p className="text-xs text-slate-400">Dibuat {fmtDate(rep.generatedAt)}{cur?.timed ? ` · periode ${rep.from.slice(0, 10)} s/d ${rep.to.slice(0, 10)}` : ''}</p>}
        </div>
      </div>
    </>
  );
}
