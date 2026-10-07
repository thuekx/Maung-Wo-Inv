'use client';
import Link from 'next/link';
import { fmtDate, ROLE_LABEL, TYPE_LABEL, useFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, ErrorMsg, PageHeader, Table } from '@/components/ui';

export default function Dashboard() {
  const { user } = useAuth();
  const { data, error } = useFetch<any>('/dashboard');
  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  if (!data) return <p className="text-slate-500">Memuat…</p>;

  return (
    <div className="space-y-6">
      <PageHeader title={`Halo, ${user?.name}`} sub={`${ROLE_LABEL[user?.role ?? ''] ?? ''} · ${data.openTotal} WO terbuka`}>
        <Link href="/work-orders/new" className="btn">+ Buat WO</Link>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {Object.keys(TYPE_LABEL).map((t) => (
          <Link key={t} href={`/work-orders?type=${t}`} className="card hover:border-brand-500">
            <div className="text-2xl font-bold">{data.byType[t] ?? 0}</div>
            <div className="text-xs text-slate-500">{TYPE_LABEL[t]}</div>
          </Link>
        ))}
      </div>

      <section>
        <h2 className="mb-2 font-semibold">Menunggu tindakan Anda ({data.mineTotal})</h2>
        <Table head={['No. WO', 'Jenis', 'Judul', 'Status', 'Jadwal', 'Dibuat']} empty="Tidak ada tugas 🎉">
          {data.mine.map((w: any) => (
            <tr key={w.id} className="hover:bg-slate-50">
              <td className="td"><Link className="font-medium text-brand-700 hover:underline" href={`/work-orders/${w.id}`}>{w.number}</Link></td>
              <td className="td">{TYPE_LABEL[w.type]}</td>
              <td className="td">{w.title}</td>
              <td className="td"><Badge tone="blue">{w.statusLabel}</Badge></td>
              <td className="td">{w.scheduledAt ? fmtDate(w.scheduledAt) : '-'}</td>
              <td className="td">{fmtDate(w.createdAt)}</td>
            </tr>
          ))}
        </Table>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="card">
          <h3 className="mb-2 font-semibold">Stok di bawah minimum</h3>
          {data.lowStock.length === 0 ? <p className="text-sm text-slate-400">Semua stok aman</p> : (
            <ul className="space-y-1 text-sm">
              {data.lowStock.map((s: any) => <li key={s.id} className="flex justify-between"><span>{s.name}</span><span className="text-red-600">{s.total}/{s.minStock} {s.unit}</span></li>)}
            </ul>
          )}
        </div>
        <div className="card">
          <h3 className="mb-2 font-semibold">Maintenance aset ≤ 14 hari</h3>
          {data.maintenanceDue.length === 0 ? <p className="text-sm text-slate-400">Tidak ada</p> : (
            <ul className="space-y-1 text-sm">
              {data.maintenanceDue.map((a: any) => <li key={a.id} className="flex justify-between"><span>{a.assetCode ?? a.serialNumber} · {a.item.name}</span><span>{new Date(a.nextMaintenanceAt).toLocaleDateString('id-ID')}</span></li>)}
            </ul>
          )}
        </div>
        <div className="card">
          <h3 className="mb-2 font-semibold">Ringkasan</h3>
          <ul className="space-y-1 text-sm">
            <li className="flex justify-between"><span>Aset menunggu QC</span><Link className="font-semibold text-brand-700" href="/inventory?tab=qc">{data.pendingQc}</Link></li>
            {data.customers.map((c: any) => <li key={c.status} className="flex justify-between"><span>Pelanggan {c.status}</span><b>{c._count}</b></li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}
