'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { fmtDate, TYPE_LABEL } from '@/lib/api';
import { Column, DataTable } from '@/components/DataTable';
import { Badge, PageHeader, statusTone, Tabs } from '@/components/ui';

function List() {
  const sp = useSearchParams();
  const overdue = sp.get('overdue');
  const [scope, setScope] = useState(overdue ? 'open' : 'mine');
  const [type, setType] = useState(sp.get('type') ?? '');
  const cols: Column<any>[] = [
    { key: 'number', header: 'No. WO', sort: 'number', render: (w) => <Link href={`/work-orders/${w.id}`} className="font-medium text-brand-700 hover:underline">{w.number}</Link> },
    { key: 'type', header: 'Jenis', sort: 'type', render: (w) => TYPE_LABEL[w.type] },
    { key: 'customer', header: 'Pelanggan', render: (w) => w.customer?.name ?? '-' },
    { key: 'status', header: 'Status', sort: 'status', render: (w) => <Badge tone={statusTone(!!w.closedAt, w.status)}>{w.statusLabel}</Badge> },
    { key: 'assignee', header: 'Teknisi', render: (w) => w.assignee?.name ?? '-' },
    { key: 'createdAt', header: 'Dibuat', sort: 'createdAt', render: (w) => fmtDate(w.createdAt) },
  ];
  return (
    <>
      <PageHeader pretitle="Operasional" title="Work Order"><Link href="/work-orders/new" className="btn">+ Buat WO</Link></PageHeader>
      {overdue && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Menampilkan WO terbuka yang dibuat &gt; {overdue} hari lalu. <Link href="/work-orders" className="underline">Hapus filter</Link></p>}
      <Tabs value={scope} onChange={setScope} tabs={[{ key: 'mine', label: 'Tugas saya' }, { key: 'open', label: 'Semua terbuka' }, { key: 'closed', label: 'Selesai' }, { key: 'all', label: 'Semua' }]} />
      <DataTable<any> path="/work-orders" columns={cols} params={{ scope, type, olderThanDays: overdue ?? undefined }} defaultSort="createdAt" defaultDir={scope === 'mine' || overdue ? 'asc' : 'desc'}
        searchPlaceholder="Cari no. WO / judul / pelanggan…" empty={scope === 'mine' ? 'Tidak ada tugas untuk Anda 🎉' : 'Tidak ada WO'}
        filters={<select className="input w-52" value={type} onChange={(e) => setType(e.target.value)} aria-label="Jenis WO"><option value="">Semua jenis</option>{Object.entries(TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>} />
    </>
  );
}

export default function WorkOrdersPage() {
  return <Suspense fallback={<p>Memuat…</p>}><List /></Suspense>;
}
