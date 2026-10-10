'use client';
import { useState } from 'react';
import Link from 'next/link';
import { fmtDate, TYPE_LABEL, useFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CustomerSelect } from '@/components/DynamicForm';
import { Badge, ErrorMsg, PageHeader } from '@/components/ui';

/** Riwayat troubleshoot per pelanggan (khusus Admin dulu): tiket gangguan + maintenance beserta isi laporannya. */
export default function RiwayatGangguan() {
  const { user } = useAuth();
  const [cid, setCid] = useState('');
  const { data, error, loading } = useFetch<any>(user?.role === 'ADMIN' && cid ? `/admin/trouble-history?customerId=${cid}` : null);
  if (user && user.role !== 'ADMIN') return <ErrorMsg>Khusus Admin</ErrorMsg>;
  return (
    <>
      <PageHeader title="Riwayat Gangguan" sub="Semua troubleshoot & maintenance satu pelanggan, lengkap dengan temuan, tindakan, hasil, signal dan redaman" />
      <div className="card mb-4 max-w-xl p-4">
        <label className="label">Pilih pelanggan</label>
        <CustomerSelect value={cid} onChange={setCid} />
      </div>
      {error && <ErrorMsg>{error}</ErrorMsg>}
      {cid && loading && <p className="text-slate-500">Memuat…</p>}
      {data && (
        <>
          <p className="mb-3 text-sm text-slate-600"><b>{data.customer.name}</b> ({data.customer.code}) · {data.customer.packageName ?? '-'} · {data.total} catatan</p>
          {!data.rows.length && <p className="text-slate-500">Belum ada riwayat gangguan / maintenance untuk pelanggan ini.</p>}
          <ol className="space-y-3">
            {data.rows.map((r: any) => (
              <li key={r.id} className="card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Link className="font-semibold text-brand-700 hover:underline" href={`/work-orders/${r.id}`}>{r.number}</Link>
                  <Badge>{TYPE_LABEL[r.type] ?? r.type}</Badge>
                  <Badge tone={r.closedAt ? 'green' : 'amber'}>{r.closedAt ? 'Selesai' : 'Berjalan'}</Badge>
                  <span className="text-xs text-slate-500">{fmtDate(r.createdAt)}{r.closedAt ? ` → ${fmtDate(r.closedAt)}` : ''}</span>
                  {r.hasReport && <Link className="ml-auto text-xs text-brand-700 hover:underline" href={`/doc/report/${r.id}`} target="_blank">Lihat laporan PDF</Link>}
                </div>
                <p className="mt-1 text-sm text-slate-700">{r.title}</p>
                {r.issue && <p className="text-xs text-slate-500">Keluhan: {r.issue}</p>}
                {r.hasReport ? (
                  <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                    {[['Temuan', r.findings], ['Tindakan', r.actions], ['Hasil', r.result]].map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="whitespace-pre-wrap">{v || '-'}</dd></div>)}
                    <div><dt className="text-xs text-slate-500">Signal</dt><dd>{r.signalDbm != null ? `${r.signalDbm} dBm` : '-'}</dd></div>
                    <div><dt className="text-xs text-slate-500">Redaman</dt><dd>{r.attenuationDb != null ? `${Math.abs(Number(r.attenuationDb))} dB` : '-'}</dd></div>
                    <div><dt className="text-xs text-slate-500">Teknisi</dt><dd>{[...(r.team ?? [])].join(', ') || r.submittedBy || '-'}</dd></div>
                  </dl>
                ) : <p className="mt-2 text-xs text-slate-400">Laporan belum dikirim.</p>}
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}
