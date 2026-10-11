'use client';
import Link from 'next/link';
import { fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Column, DataTable } from '@/components/DataTable';
import { Badge, PageHeader } from '@/components/ui';
import { rupiah } from '@/components/DocSheet';

export default function Subscriptions() {
  const { user } = useAuth();
  const canWrite = user?.role === 'ADMIN' || user?.role === 'MKT';
  const cols: Column<any>[] = [
    { key: 'regNo', header: 'Reg. No.', sort: 'regNo', className: 'font-mono', render: (s) => <Link href={`/subscriptions/${s.id}`} className="font-medium text-brand-700 hover:underline">{s.regNo}</Link> },
    { key: 'name', header: 'Nama', sort: 'name', render: (s) => s.name ?? <span className="text-slate-400">-</span> },
    { key: 'package', header: 'Paket', render: (s) => s.packageName ?? '-' },
    { key: 'fee', header: 'Biaya/bulan', className: 'whitespace-nowrap text-right', render: (s) => (s.monthlyFee != null ? rupiah(s.monthlyFee) : '-') },
    { key: 'formDate', header: 'Tanggal', sort: 'formDate', render: (s) => fmtDate(s.formDate).split(',')[0] },
    { key: 'by', header: 'Marketing', render: (s) => s.marketingName ?? s.createdBy?.name },
    { key: 'source', header: 'Sumber', className: 'text-xs', render: (s) => (s.source === 'RADIUS' ? <Badge tone="blue">Otomatis (MSRadius)</Badge> : <Badge tone="slate">Manual</Badge>) },
    { key: 'wo', header: 'WO', render: (s) => (s.woId ? <Badge tone="green">sudah jadi WO</Badge> : <Badge tone="slate">belum</Badge>) },
  ];
  return (
    <>
      <PageHeader pretitle="Marketing" title="Formulir Berlangganan" sub="Formulir berlangganan digital (Sunmori Net): tersimpan, dapat dicetak/PDF untuk ditandatangani pelanggan, lalu dijadikan WO Pasang Baru.">
        {canWrite && <Link href="/subscriptions/new" className="btn">+ Formulir baru</Link>}
      </PageHeader>
      <DataTable<any> path="/subscriptions" columns={cols} defaultSort="createdAt" empty="Belum ada formulir berlangganan" searchPlaceholder="Cari reg. no. / nama / telepon…" />
    </>
  );
}
