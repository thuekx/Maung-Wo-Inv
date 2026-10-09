'use client';
import Link from 'next/link';
import { useState } from 'react';
import { fmtDate, TYPE_LABEL, useFetch } from '@/lib/api';
import { Column, DataTable } from '@/components/DataTable';
import { Badge, ErrorMsg, PageHeader, Table, statusTone } from '@/components/ui';

/** Teknisi: Stok Berjalan milik sendiri + riwayat permintaan material & serah-terima sisa. */
export default function MyStock() {
  const { data, error } = useFetch<any>('/stock/mine');
  const [type, setType] = useState('');
  const cols: Column<any>[] = [
    { key: 'number', header: 'No. WO', sort: 'number', render: (w) => <Link href={`/work-orders/${w.id}`} className="font-medium text-brand-700 hover:underline">{w.number}</Link> },
    { key: 'type', header: 'Jenis', sort: 'type', render: (w) => TYPE_LABEL[w.type] },
    { key: 'title', header: 'Keterangan', sort: 'title' },
    { key: 'status', header: 'Status', sort: 'status', render: (w) => <Badge tone={statusTone(!!w.closedAt, w.status)}>{w.statusLabel}</Badge> },
    { key: 'createdAt', header: 'Diajukan', sort: 'createdAt', render: (w) => fmtDate(w.createdAt) },
  ];
  return (
    <>
      <PageHeader pretitle="Gudang" title="Stok Saya" sub="Stok Berjalan: material & perangkat yang Anda bawa. Sisa tetap atas nama Anda sampai diterima GA.">
        <Link href="/work-orders/new?type=STOCK_REQUEST" className="btn">+ Minta material</Link>
        <Link href="/work-orders/new?type=STOCK_RETURN" className="btn-ghost">↩ Kembalikan sisa</Link>
      </PageHeader>
      <ErrorMsg>{error}</ErrorMsg>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 font-semibold">Material habis pakai</h2>
          <Table head={['Item', 'Jumlah']}>
            {data?.stock.map((s: any) => <tr key={s.id}><td className="td">{s.item.name}{s.item.coreCount ? <span className="ml-1 text-xs text-slate-500">· {s.item.coreCount} core</span> : null}</td><td className="td">{s.qty} {s.item.unit}</td></tr>)}
            {data && data.stock.length === 0 && <tr><td className="td text-slate-400" colSpan={2}>Kosong</td></tr>}
          </Table>
        </div>
        <div>
          <h2 className="mb-2 font-semibold">Perangkat ber-SN</h2>
          <Table head={['Serial', 'Item', 'Status']}>
            {data?.assets.map((a: any) => <tr key={a.id}><td className="td font-mono text-xs">{a.serialNumber}</td><td className="td">{a.item.name}</td><td className="td"><Badge>{a.status}</Badge></td></tr>)}
            {data && data.assets.length === 0 && <tr><td className="td text-slate-400" colSpan={3}>Tidak ada</td></tr>}
          </Table>
        </div>
      </div>
      <h2 className="mb-2 mt-6 font-semibold">Riwayat permintaan material & serah-terima</h2>
      <DataTable<any> path="/work-orders" columns={cols} params={{ scope: 'created', type: type || undefined }} defaultSort="createdAt" empty="Belum ada pengajuan"
        searchPlaceholder="Cari no. WO / keterangan…"
        filters={<select className="input w-52" value={type} onChange={(e) => setType(e.target.value)} aria-label="Jenis"><option value="">Semua</option><option value="STOCK_REQUEST">Permintaan Barang</option><option value="STOCK_RETURN">Serah-terima Sisa</option></select>} />
    </>
  );
}
