'use client';
import Link from 'next/link';
import { fmtDate, useFetch } from '@/lib/api';
import { Badge, ErrorMsg, PageHeader, Table } from '@/components/ui';

export default function PurchaseOrders() {
  const { data, error } = useFetch<any[]>('/purchase-orders');
  return (
    <>
      <PageHeader title="Purchase Order" sub="PO diterbitkan Procurement dari WO Permintaan Barang" />
      <ErrorMsg>{error}</ErrorMsg>
      <Table head={['No. PO', 'Vendor', 'Barang', 'WO', 'Status', 'Tanggal']}>
        {data?.map((p) => (
          <tr key={p.id}>
            <td className="td"><Link className="font-medium text-brand-700 hover:underline" href={`/purchase-orders/${p.id}`}>{p.number}</Link></td>
            <td className="td">{p.vendor}</td>
            <td className="td text-xs">{p.lines.map((l: any) => `${l.item.name} ${l.receivedQty}/${l.qty}`).join(', ')}</td>
            <td className="td">{p.wo ? <Link className="text-brand-700 hover:underline" href={`/work-orders/${p.wo.id}`}>{p.wo.number}</Link> : '-'}</td>
            <td className="td"><Badge tone={p.status === 'RECEIVED' ? 'green' : p.status === 'PARTIAL' ? 'amber' : 'blue'}>{p.status}</Badge></td>
            <td className="td">{fmtDate(p.createdAt)}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
