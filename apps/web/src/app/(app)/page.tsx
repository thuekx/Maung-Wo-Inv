'use client';
import Link from 'next/link';
import { fmtDate, ROLE_LABEL, TYPE_LABEL, useFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, ErrorMsg, Table } from '@/components/ui';
import { Donut, Legend, ProgressBar, StackedBars, TrendChart } from '@/components/charts';

const TYPE_COLOR: Record<string, string> = {
  NEW_INSTALL: '#2563eb', TROUBLE: '#e11d48', SUSPEND: '#d97706', UNSUSPEND: '#059669', TERMINATE: '#7c3aed', STOCK_REQUEST: '#0891b2',
};
const C = { done: '#10b981', open: '#3b82f6', cancel: '#94a3b8', out: '#ef4444', low: '#f59e0b', ok: '#10b981', warn: '#f97316' };

function Kpi({ href, value, label, color, hint }: { href?: string; value: number | string; label: string; color: string; hint?: string }) {
  const body = (
    <div className="kpi h-full" style={{ ['--accent' as string]: color, background: `${color}14`, borderColor: `${color}44`, borderLeft: `4px solid ${color}` }}>
      <div className="text-3xl font-bold" style={{ color }}>{value}</div>
      <div className="text-xs font-medium text-slate-600">{label}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

const Panel = ({ title, right, children, className = '' }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) => (
  <section className={`card ${className}`}>
    <div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-semibold">{title}</h3>{right}</div>
    {children}
  </section>
);

export default function Dashboard() {
  const { user } = useAuth();
  const { data, error } = useFetch<any>('/dashboard');
  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  if (!data) return <p className="text-slate-500">Memuat…</p>;

  const p = data.progress;
  const stockTotal = data.stockSummary.out + data.stockSummary.low + data.stockSummary.ok;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 p-5 text-white shadow-md">
        <div>
          <h1 className="text-xl font-bold">Halo, {user?.name} 👋</h1>
          <p className="text-sm text-blue-100">{ROLE_LABEL[user?.role ?? ''] ?? ''} · {data.openTotal} WO terbuka · {data.mineTotal} menunggu tindakan Anda</p>
        </div>
        <Link href="/work-orders/new" className="rounded-lg bg-white/15 px-4 py-2 text-sm font-semibold backdrop-blur hover:bg-white/25">+ Buat WO</Link>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {Object.keys(TYPE_LABEL).map((t) => (
          <Kpi key={t} href={`/work-orders?type=${t}`} value={data.byType[t] ?? 0} label={TYPE_LABEL[t]} color={TYPE_COLOR[t]} hint="terbuka" />
        ))}
        <Kpi value={data.overdue.total} label="WO > 7 hari" color={data.overdue.total ? C.out : C.ok} hint="belum tertangani" />
        <Kpi href="/inventory" value={data.stockSummary.out + data.stockSummary.low} label="Stok kritis" color={data.stockSummary.out ? C.out : data.stockSummary.low ? C.low : C.ok} hint={`${data.stockSummary.out} habis · ${data.stockSummary.low} menipis`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Penyelesaian WO (30 hari)">
          <div className="flex items-center gap-5">
            <Donut pct={p.pct} sub="selesai" />
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: C.done }} /> Selesai <b>{p.done}</b></div>
              <div className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: C.open }} /> Belum selesai <b>{p.open}</b></div>
              <div className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: C.cancel }} /> Batal/ditolak <b>{p.cancelled}</b></div>
              <div className="text-xs text-slate-500">dari {p.created} WO dibuat</div>
            </div>
          </div>
        </Panel>

        <Panel title="Tren 14 hari" className="lg:col-span-2">
          <TrendChart data={data.trend} series={[{ key: 'created', color: C.open, name: 'Dibuat' }, { key: 'done', color: C.done, name: 'Selesai' }]} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Selesai vs belum per jenis" right={<Legend items={[{ name: 'Selesai', color: C.done }, { name: 'Belum', color: C.open }]} />}>
          <StackedBars rows={Object.keys(TYPE_LABEL).map((t) => ({ label: TYPE_LABEL[t], segments: [{ name: 'Selesai', value: data.byTypeProgress[t]?.done ?? 0, color: C.done }, { name: 'Belum', value: data.byTypeProgress[t]?.open ?? 0, color: C.open }] }))} />
        </Panel>

        <Panel title="Stok menipis / habis" right={<span className="text-xs text-slate-500">{stockTotal} item dipantau</span>}>
          <div className="mb-3 flex gap-2 text-xs">
            <Badge tone="red">Habis {data.stockSummary.out}</Badge><Badge tone="amber">Menipis {data.stockSummary.low}</Badge><Badge tone="green">Aman {data.stockSummary.ok}</Badge>
          </div>
          {data.lowStock.length === 0 ? <p className="text-sm text-emerald-600">✔ Semua stok aman</p> : (
            <ul className="space-y-3">
              {data.lowStock.map((s: any) => (
                <li key={s.id}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span>{s.name}</span>
                    <span className="flex items-center gap-2">{s.level === 'OUT' ? <Badge tone="red">HABIS</Badge> : <Badge tone="amber">MENIPIS</Badge>}<b>{s.total}</b><span className="text-xs text-slate-500">/ min {s.minStock} {s.unit}</span></span>
                  </div>
                  <ProgressBar value={s.total} max={s.minStock} color={s.level === 'OUT' ? C.out : C.low} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="WO belum tertangani > 7 hari" right={<Badge tone={data.overdue.total ? 'red' : 'green'}>{data.overdue.total}</Badge>}>
          {data.overdue.items.length === 0 ? <p className="text-sm text-emerald-600">✔ Tidak ada yang tertunda</p> : (
            <ul className="space-y-2 text-sm">
              {data.overdue.items.map((w: any) => (
                <li key={w.id} className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><Link href={`/work-orders/${w.id}`} className="font-medium text-brand-700 hover:underline">{w.number}</Link><div className="truncate text-xs text-slate-500">{w.title} · {w.statusLabel}</div></div>
                  <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ background: w.ageDays > 14 ? C.out : C.warn }}>{w.ageDays} hr</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <section>
        <h2 className="mb-2 font-semibold">Menunggu tindakan Anda ({data.mineTotal})</h2>
        <Table head={['No. WO', 'Jenis', 'Judul', 'Status', 'Jadwal', 'Dibuat']} empty="Tidak ada tugas 🎉">
          {data.mine.map((w: any) => (
            <tr key={w.id} className="hover:bg-slate-50">
              <td className="td"><Link className="font-medium text-brand-700 hover:underline" href={`/work-orders/${w.id}`}>{w.number}</Link></td>
              <td className="td"><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: TYPE_COLOR[w.type] }} />{TYPE_LABEL[w.type]}</td>
              <td className="td">{w.title}</td>
              <td className="td"><Badge tone="blue">{w.statusLabel}</Badge></td>
              <td className="td">{w.scheduledAt ? fmtDate(w.scheduledAt) : '-'}</td>
              <td className="td">{fmtDate(w.createdAt)}</td>
            </tr>
          ))}
        </Table>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Maintenance aset ≤ 14 hari">
          {data.maintenanceDue.length === 0 ? <p className="text-sm text-slate-400">Tidak ada</p> : (
            <ul className="space-y-1 text-sm">
              {data.maintenanceDue.map((a: any) => <li key={a.id} className="flex justify-between"><span>{a.assetCode ?? a.serialNumber} · {a.item.name}</span><span>{new Date(a.nextMaintenanceAt).toLocaleDateString('id-ID')}</span></li>)}
            </ul>
          )}
        </Panel>
        <Panel title="Ringkasan">
          <ul className="space-y-1.5 text-sm">
            <li className="flex justify-between"><span>Aset menunggu QC</span><Link className="font-semibold text-brand-700" href="/inventory?tab=qc">{data.pendingQc}</Link></li>
            {data.customers.map((c: any) => <li key={c.status} className="flex justify-between"><span>Pelanggan {c.status}</span><b>{c._count}</b></li>)}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
