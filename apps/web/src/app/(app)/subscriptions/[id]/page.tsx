'use client';
import { use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { doDelete, fmtDate, useFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, DataGrid, ErrorMsg, PageHeader } from '@/components/ui';
import { rupiah } from '@/components/DocSheet';

const PAY: Record<string, string> = { CASH: 'Tunai | Cash', TRANSFER: 'Transfer', DEBIT: 'Debet | Debit' };

export default function SubscriptionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user } = useAuth();
  const { data: s, error } = useFetch<any>(`/subscriptions/${id}`);
  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  if (!s) return <p className="text-slate-500">Memuat…</p>;
  const canWrite = user?.role === 'ADMIN' || user?.role === 'MKT';
  return (
    <div className="space-y-4">
      <PageHeader pretitle="Formulir Berlangganan" title={s.regNo} sub={`${s.name ?? 'Tanpa nama'} · diterbitkan ${fmtDate(s.createdAt)} oleh ${s.createdBy.name}`}>
        <Link href={`/doc/form/${id}`} className="btn">🖨 Cetak / PDF</Link>
        {canWrite && <Link href={`/subscriptions/${id}/edit`} className="btn-ghost">✎ Ubah</Link>}
        {canWrite && !s.woId && <Link href={`/work-orders/new?type=NEW_INSTALL&fromForm=${id}`} className="btn-ghost">➜ Buat WO Pasang Baru</Link>}
        {canWrite && !s.woId && <button className="btn-ghost text-red-600" onClick={async () => { if (await doDelete(`/subscriptions/${id}`, `formulir ${s.regNo}`)) router.replace('/subscriptions'); }}>🗑 Hapus</button>}
      </PageHeader>
      {s.wo && <p className="text-sm">Sudah menjadi WO <Link className="text-brand-700 hover:underline" href={`/work-orders/${s.wo.id}`}>{s.wo.number}</Link></p>}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card"><div className="card-header"><h2 className="font-semibold">Pelanggan</h2></div>
          <DataGrid items={[{ label: 'Nama', value: s.name }, { label: 'Alamat', value: s.address }, { label: 'Telepon', value: s.phone }, { label: 'Email', value: s.email }, { label: 'Referral', value: s.referral }]} /></div>
        <div className="card"><div className="card-header"><h2 className="font-semibold">Layanan & tagihan</h2></div>
          <DataGrid items={[{ label: 'Paket', value: s.packageName }, { label: 'Note', value: s.serviceNote }, { label: 'Biaya pemasangan', value: s.installFee != null ? `${rupiah(s.installFee)} (pasca bayar)` : '-' }, { label: 'Biaya per bulan', value: s.monthlyFee != null ? `${rupiah(s.monthlyFee)} (${s.settings.ppnNote})` : '-' }, { label: 'PIC', value: [s.picName, s.picPhone].filter(Boolean).join(' · ') }, { label: 'Pembayaran', value: <Badge>{PAY[s.payment] ?? s.payment}</Badge> }]} /></div>
      </div>
      <p className="text-sm text-slate-600">Tanggal {fmtDate(s.formDate).split(',')[0]} · Marketing: <b>{s.marketingName ?? '-'}</b> · Manager Marketing: <b>{s.managerName ?? '-'}</b></p>
    </div>
  );
}
