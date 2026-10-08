'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { fmtDate, TYPE_LABEL, useFetch } from '@/lib/api';
import { Badge, ErrorMsg, PageHeader, statusTone, Table, Tabs } from '@/components/ui';

function List() {
  const sp = useSearchParams();
  const overdue = sp.get('overdue');
  const [scope, setScope] = useState(overdue ? 'open' : 'mine');
  const [type, setType] = useState(sp.get('type') ?? '');
  const [q, setQ] = useState('');
  const params = new URLSearchParams({ scope, ...(type ? { type } : {}), ...(q ? { q } : {}), ...(overdue ? { olderThanDays: overdue } : {}) });
  const { data, error, loading } = useFetch<any[]>(`/work-orders?${params}`);

  return (
    <>
      <PageHeader title="Work Order"><Link href="/work-orders/new" className="btn">+ Buat WO</Link></PageHeader>
      {overdue && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Menampilkan WO terbuka yang dibuat &gt; {overdue} hari lalu. <Link href="/work-orders" className="underline">Hapus filter</Link></p>}
      <Tabs value={scope} onChange={setScope} tabs={[{ key: 'mine', label: 'Tugas saya' }, { key: 'open', label: 'Semua terbuka' }, { key: 'closed', label: 'Selesai' }, { key: 'all', label: 'Semua' }]} />
      <div className="mb-3 flex flex-wrap gap-2">
        <select className="input w-52" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Semua jenis</option>
          {Object.entries(TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input className="input w-64" placeholder="Cari no. WO / pelanggan…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ErrorMsg>{error}</ErrorMsg>
      {loading && !data ? <p className="text-slate-500">Memuat…</p> : (
        <Table head={['No. WO', 'Jenis', 'Pelanggan', 'Status', 'Teknisi', 'Dibuat']}>
          {data?.map((w) => (
            <tr key={w.id} className="hover:bg-slate-50">
              <td className="td"><Link href={`/work-orders/${w.id}`} className="font-medium text-brand-700 hover:underline">{w.number}</Link></td>
              <td className="td">{TYPE_LABEL[w.type]}</td>
              <td className="td">{w.customer?.name ?? '-'}</td>
              <td className="td"><Badge tone={statusTone(!!w.closedAt, w.status)}>{w.statusLabel}</Badge></td>
              <td className="td">{w.assignee?.name ?? '-'}</td>
              <td className="td">{fmtDate(w.createdAt)}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

export default function WorkOrdersPage() {
  return <Suspense fallback={<p>Memuat…</p>}><List /></Suspense>;
}
