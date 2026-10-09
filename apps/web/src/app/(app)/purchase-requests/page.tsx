'use client';
import Link from 'next/link';
import { useState } from 'react';
import { fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Column, DataTable } from '@/components/DataTable';
import { Badge, PageHeader } from '@/components/ui';
import { rupiah } from '@/components/DocSheet';
import { PR_STATUS } from '@/lib/pr';
import { Select } from '@/components/Select';

export default function PrList() {
  const { user } = useAuth();
  const [status, setStatus] = useState('');
  const canCreate = user?.role === 'ADMIN' || user?.role === 'GA' || user?.subRole === 'SUPERVISOR' || user?.subRole === 'MANAGER';
  const cols: Column<any>[] = [
    { key: 'number', header: 'No. PR', sort: 'number', render: (p) => <Link href={`/purchase-requests/${p.id}`} className="font-medium text-brand-700 hover:underline">{p.number ?? '(draft)'}</Link> },
    { key: 'subject', header: 'Perihal', sort: 'subject' },
    { key: 'by', header: 'Pembuat', render: (p) => p.createdBy?.name },
    { key: 'total', header: 'Grand total', className: 'whitespace-nowrap text-right', render: (p) => rupiah(p.totals.grandTotal) },
    { key: 'status', header: 'Status', sort: 'status', render: (p) => <Badge tone={PR_STATUS[p.status]?.tone}>{PR_STATUS[p.status]?.label ?? p.status}</Badge> },
    { key: 'createdAt', header: 'Dibuat', sort: 'createdAt', render: (p) => fmtDate(p.createdAt) },
  ];
  return (
    <>
      <PageHeader pretitle="Pengadaan" title="Purchase Request" sub="Pengajuan pembelian dengan perbandingan harga vendor. PO diterbitkan di Accurate lalu dicatat di sini untuk penerimaan & QC.">
        {canCreate && <Link href="/purchase-requests/new" className="btn">+ Buat PR</Link>}
      </PageHeader>
      <DataTable<any> path="/purchase-requests" columns={cols} params={{ status }} defaultSort="createdAt" empty="Belum ada Purchase Request" searchPlaceholder="Cari no. PR / perihal…"
        filters={<Select className="input w-56" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Semua status</option>{Object.entries(PR_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>} />
    </>
  );
}
