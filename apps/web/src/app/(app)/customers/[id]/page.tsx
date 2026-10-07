'use client';
import { use } from 'react';
import Link from 'next/link';
import { fmtDate, TYPE_LABEL, useFetch } from '@/lib/api';
import { Badge, custTone, ErrorMsg, PageHeader, Table } from '@/components/ui';

export default function CustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: c, error } = useFetch<any>(`/customers/${id}`);
  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  if (!c) return <p className="text-slate-500">Memuat…</p>;
  return (
    <div className="space-y-4">
      <PageHeader title={`${c.name}`} sub={c.code}><Badge tone={custTone(c.status)}>{c.status}</Badge></PageHeader>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card space-y-1 text-sm">
          <div>📞 {c.phone}{c.email && ` · ${c.email}`}</div>
          <div>📍 {c.address}</div>
          {c.lat != null && <a className="text-brand-700 hover:underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${c.lat},${c.lng}`}>Buka peta</a>}
          <div>Paket: {c.packageName}</div>
          <div>Gudang: {c.warehouse?.name ?? '-'}</div>
        </div>
        <div className="card space-y-1 text-sm">
          <div className="font-semibold">Jaringan</div>
          <div>ODP / Port: {c.odp ?? '-'} / {c.port ?? '-'}</div>
          <div>VLAN: {c.vlan ?? '-'}</div>
          <div>IP: <span className="font-mono">{c.ip ?? '-'}</span></div>
          <div>Aktif sejak: {fmtDate(c.activatedAt)}</div>
        </div>
      </div>
      <section>
        <h2 className="mb-2 font-semibold">Perangkat milik ISP di lokasi pelanggan</h2>
        <Table head={['Item', 'Serial Number', 'Status']} empty="Belum ada perangkat terpasang">
          {c.assets.map((a: any) => <tr key={a.id}><td className="td">{a.item.name}</td><td className="td font-mono">{a.serialNumber}</td><td className="td"><Badge>{a.status}</Badge></td></tr>)}
        </Table>
      </section>
      <section>
        <h2 className="mb-2 font-semibold">Riwayat WO</h2>
        <Table head={['No. WO', 'Jenis', 'Judul', 'Status', 'Dibuat']}>
          {c.workOrders.map((w: any) => (
            <tr key={w.id}>
              <td className="td"><Link className="text-brand-700 hover:underline" href={`/work-orders/${w.id}`}>{w.number}</Link></td>
              <td className="td">{TYPE_LABEL[w.type]}</td><td className="td">{w.title}</td><td className="td">{w.status}</td><td className="td">{fmtDate(w.createdAt)}</td>
            </tr>
          ))}
        </Table>
      </section>
    </div>
  );
}
