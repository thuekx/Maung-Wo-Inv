'use client';
import Link from 'next/link';
import { fmtDate, ROLE_LABEL, TYPE_LABEL, useFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, ErrorMsg, MetricCard, Table } from '@/components/ui';
import { useBranding } from '@/lib/brand';
import type { IconName } from '@/components/icons';
import { Donut, Legend, ProgressBar, StackedBars, TrendChart } from '@/components/charts';

const TYPE_KEYS = ['NEW_INSTALL', 'TROUBLE', 'SUSPEND', 'UNSUSPEND', 'TERMINATE', 'STOCK_REQUEST', 'STOCK_RETURN'];
const TYPE_ICON: Record<string, IconName> = { NEW_INSTALL: 'users', TROUBLE: 'alert', SUSPEND: 'clock', UNSUSPEND: 'check', TERMINATE: 'logout', STOCK_REQUEST: 'box', STOCK_RETURN: 'box' };
// warna status tetap (semantik); warna jenis WO mengikuti palet grafik brand dari Admin
const C = { done: '#10b981', cancel: '#94a3b8', out: '#ef4444', low: '#f59e0b', ok: '#10b981', warn: '#f97316' };

const Panel = ({ title, right, children, className = '' }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) => (
  <section className={`card ${className}`}>
    <div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-semibold">{title}</h3>{right}</div>
    {children}
  </section>
);

export default function Dashboard() {
  const { user } = useAuth();
  const brand = useBranding();
  const TYPE_COLOR: Record<string, string> = Object.fromEntries(TYPE_KEYS.map((t, i) => [t, brand.colors.charts[i % brand.colors.charts.length]]));
  const OPEN = brand.colors.charts[0];
  const { data, error } = useFetch<any>('/dashboard');
  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  if (!data) return <p className="text-slate-500">Memuat…</p>;

  const p = data.progress;
  const stockTotal = data.stockSummary.out + data.stockSummary.low + data.stockSummary.ok;

  return (
    <div className="space-y-5">
      <div className="relative isolate overflow-hidden rounded-2xl bg-brand-900 p-5 text-white shadow-card dark:border dark:border-white/10 sm:p-6">
        <div className="contour absolute inset-0 -z-10 opacity-70" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="subheader !text-accent-400">Dashboard</div>
            <h1 className="mt-1 font-display text-2xl font-bold sm:text-3xl">Halo, {user?.name}</h1>
            <p className="mt-1 text-sm text-slate-300">{ROLE_LABEL[user?.role ?? ''] ?? ''} · {data.openTotal} WO terbuka · {data.mineTotal} menunggu tindakan Anda</p>
            {brand.tagline && <p className="mt-3 font-display text-lg italic text-accent-400">{brand.tagline}</p>}
          </div>
          <Link href="/work-orders/new" className="btn !px-5">+ Buat WO</Link>
        </div>
      </div>

      {/* kartu ditata 2 baris seimbang di layar lebar (baris bawah diratakan ke tengah) */}
      {(() => {
        const cards = [
          ...TYPE_KEYS.map((t) => <MetricCard href={`/work-orders?type=${t}`} icon={TYPE_ICON[t]} color={TYPE_COLOR[t]} value={data.byType[t] ?? 0} label={TYPE_LABEL[t]} hint="terbuka" />),
          <MetricCard href="/work-orders?overdue=7" icon="clock" color={data.overdue.total ? C.out : C.ok} value={data.overdue.total} label="WO > 7 hari" hint="belum tertangani" />,
          <MetricCard href="/inventory" icon="inbox" color={data.stockSummary.out ? C.out : data.stockSummary.low ? C.low : C.ok} value={data.stockSummary.out + data.stockSummary.low} label="Stok kritis" hint={`${data.stockSummary.out} habis · ${data.stockSummary.low} menipis`} />,
        ];
        const top = Math.ceil(cards.length / 2), bottom = cards.length - top;
        return (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:[grid-template-columns:repeat(var(--cols),minmax(0,1fr))]" style={{ '--cols': top * 2 } as React.CSSProperties}>
            {cards.map((c, i) => (
              <div key={i} className="xl:[grid-column-end:span_2] xl:[grid-column-start:var(--cs,auto)]" style={i === top && bottom < top ? ({ '--cs': top - bottom + 1 } as React.CSSProperties) : undefined}>{c}</div>
            ))}
          </div>
        );
      })()}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Penyelesaian WO (30 hari)">
          <div className="flex items-center gap-5">
            <Donut pct={p.pct} sub="selesai" />
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: C.done }} /> Selesai <b>{p.done}</b></div>
              <div className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: OPEN }} /> Belum selesai <b>{p.open}</b></div>
              <div className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: C.cancel }} /> Batal/ditolak <b>{p.cancelled}</b></div>
              <div className="text-xs text-slate-500">dari {p.created} WO dibuat</div>
            </div>
          </div>
        </Panel>

        <Panel title="Tren 14 hari" className="lg:col-span-2">
          <TrendChart data={data.trend} series={[{ key: 'created', color: OPEN, name: 'Dibuat' }, { key: 'done', color: C.done, name: 'Selesai' }]} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Selesai vs belum per jenis" right={<Legend items={[{ name: 'Selesai', color: C.done }, { name: 'Belum', color: OPEN }]} />}>
          <StackedBars rows={Object.keys(TYPE_LABEL).map((t) => ({ label: TYPE_LABEL[t], segments: [{ name: 'Selesai', value: data.byTypeProgress[t]?.done ?? 0, color: C.done }, { name: 'Belum', value: data.byTypeProgress[t]?.open ?? 0, color: OPEN }] }))} />
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

        <Panel title="WO tertunda > 7 hari" right={<Link href="/work-orders?overdue=7" className="text-xs text-brand-700 hover:underline">Lihat semua ({data.overdue.total}) →</Link>}>
          {data.overdue.total > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {Object.entries(data.overdue.byOwner ?? {}).map(([r, n]) => <Badge key={r} tone="red">{ROLE_LABEL[r] ?? r}: {n as number}</Badge>)}
            </div>
          )}
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
        <Panel title="Aset perlu perawatan (≤ 14 hari / lewat jadwal)">
          {data.maintenanceDue.length === 0 ? <p className="text-sm text-slate-400">Tidak ada</p> : (
            <ul className="space-y-1 text-sm">
              {data.maintenanceDue.map((a: any) => {
                const d = a.nextMaintenanceAt ? new Date(a.nextMaintenanceAt) : null;
                const late = d && d.getTime() < Date.now();
                return <li key={a.id} className="flex justify-between gap-2"><span className="truncate">{a.assetCode ?? a.serialNumber} · {a.item.name}{a.plateNumber ? ` (${a.plateNumber})` : ''}</span><span className={`shrink-0 ${late || !d ? 'font-semibold text-red-600' : ''}`}>{d ? `${late ? 'Lewat ' : ''}${d.toLocaleDateString('id-ID')}` : 'Belum dijadwalkan'}</span></li>;
              })}
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
