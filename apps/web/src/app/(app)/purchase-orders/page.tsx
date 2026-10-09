'use client';
import Link from 'next/link';
import { useState } from 'react';
import { fmtDate } from '@/lib/api';
import { Column, DataTable } from '@/components/DataTable';
import { Badge, PageHeader } from '@/components/ui';
import { Select } from '@/components/Select';

export default function PurchaseOrders() {
  const [status, setStatus] = useState('');
  const cols: Column<any>[] = [
    { key: 'number', header: 'No. PO', sort: 'number', render: (p) => <Link className="font-medium text-brand-700 hover:underline" href={`/purchase-orders/${p.id}`}>{p.number}</Link> },
    { key: 'vendor', header: 'Vendor', sort: 'vendor' },
    { key: 'lines', header: 'Barang', className: 'text-xs', render: (p) => p.lines.map((l: any) => `${l.item.name} ${l.receivedQty}/${l.qty}`).join(', ') },
    { key: 'wo', header: 'WO', render: (p) => (p.wo ? <Link className="text-brand-700 hover:underline" href={`/work-orders/${p.wo.id}`}>{p.wo.number}</Link> : '-') },
    { key: 'status', header: 'Status', sort: 'status', render: (p) => <Badge tone={p.status === 'RECEIVED' ? 'green' : p.status === 'PARTIAL' ? 'amber' : 'blue'}>{p.status}</Badge> },
    { key: 'createdAt', header: 'Tanggal', sort: 'createdAt', render: (p) => fmtDate(p.createdAt) },
  ];
  return (
    <>
      <PageHeader pretitle="Pengadaan" title="Purchase Order" sub="PO diterbitkan GA/Procurement dari WO Permintaan Barang" />
      <DataTable<any> path="/purchase-orders" columns={cols} params={{ status }} defaultSort="createdAt" searchPlaceholder="Cari no. PO / vendor…"
        filters={<Select className="input w-44" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Semua status</option>{['ISSUED', 'PARTIAL', 'RECEIVED'].map((x) => <option key={x}>{x}</option>)}</Select>} />
    </>
  );
}
