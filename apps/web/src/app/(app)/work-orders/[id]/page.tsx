'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { api, fmtDate, ROLE_LABEL, TYPE_LABEL, useFetch } from '@/lib/api';
import { DynamicForm } from '@/components/DynamicForm';
import { Badge, DataView, ErrorMsg, PageHeader, statusTone } from '@/components/ui';

export default function WoDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: wo, error, reload } = useFetch<any>(`/work-orders/${id}`);
  const { data: meta } = useFetch<any[]>('/work-orders/meta');
  const [active, setActive] = useState<string | null>(null);

  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  if (!wo || !meta) return <p className="text-slate-500">Memuat…</p>;

  const wf = meta.find((m) => m.type === wo.type);
  const actionDefs: any[] = wf.statuses[wo.status]?.actions ?? [];
  const available = [
    ...actionDefs.filter((a) => wo.allowed.includes(a.key)),
    ...(wo.allowed.includes('cancel') ? [{ key: 'cancel', label: 'Batalkan WO', danger: true, fields: [{ name: 'note', label: 'Alasan pembatalan', type: 'textarea', required: true }] }] : []),
  ];
  const current = available.find((a) => a.key === active);
  const c = wo.customer;
  const { events, customer, createdBy, assignee, parent, children, purchase, data, ...rest } = wo;
  void rest;

  return (
    <div className="space-y-4">
      <PageHeader title={`${wo.number} · ${wo.title}`} sub={`${TYPE_LABEL[wo.type]} · dibuat ${fmtDate(wo.createdAt)} oleh ${createdBy.name}${wo.source === 'BILLING' ? ' (otomatis dari Billing)' : ''}`}>
        <Badge tone={statusTone(wo.final, wo.status)}>{wo.statusLabel}</Badge>
      </PageHeader>

      {wf && (
        <ol className="flex flex-wrap gap-1 text-xs">
          {Object.entries<any>(wf.statuses).filter(([k]) => !['REJECTED'].includes(k)).map(([k, s]) => (
            <li key={k} className={`rounded-full px-2 py-1 ${k === wo.status ? 'bg-brand-600 font-semibold text-white' : 'bg-slate-100 text-slate-500'}`}>{s.label}</li>
          ))}
        </ol>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {!wo.final && (
            <div className="card">
              <h2 className="mb-2 font-semibold">Tindakan {wo.owner && <span className="text-sm font-normal text-slate-500">— menunggu {ROLE_LABEL[wo.owner]}</span>}</h2>
              {available.length === 0 ? (
                <p className="text-sm text-slate-500">Tidak ada tindakan untuk peran Anda pada tahap ini.</p>
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap gap-2">
                    {available.map((a) => (
                      <button key={a.key} className={active === a.key ? (a.danger ? 'btn-danger' : 'btn') : 'btn-ghost'} onClick={() => setActive(active === a.key ? null : a.key)}>{a.label}</button>
                    ))}
                  </div>
                  {current && (
                    <div className="rounded-lg border bg-slate-50 p-3">
                      <DynamicForm key={current.key} fields={current.fields} woId={wo.id} danger={current.danger} submitLabel={current.label}
                        onSubmit={async (input) => { await api(`/work-orders/${wo.id}/actions/${current.key}`, { body: input }); setActive(null); await reload(); }} />
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="card">
            <h2 className="mb-2 font-semibold">Detail & laporan</h2>
            <DataView value={data} />
          </div>

          <div className="card">
            <h2 className="mb-3 font-semibold">Riwayat</h2>
            <ol className="space-y-3 border-l-2 border-slate-200 pl-4">
              {events.map((e: any) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-500" />
                  <div className="text-sm"><b>{e.actorName ?? 'Sistem'}</b> · {e.action} → <span className="text-brand-700">{wf.statuses[e.toStatus]?.label ?? e.toStatus}</span></div>
                  {e.note && <div className="text-sm text-slate-600">{e.note}</div>}
                  <div className="text-xs text-slate-400">{fmtDate(e.createdAt)}</div>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="space-y-4">
          {c && (
            <div className="card text-sm">
              <h2 className="mb-2 font-semibold">Pelanggan</h2>
              <Link href={`/customers/${c.id}`} className="font-medium text-brand-700 hover:underline">{c.name}</Link> <span className="text-slate-500">({c.code})</span>
              <div className="mt-1 space-y-0.5 text-slate-600">
                <div>{c.phone}{c.email && ` · ${c.email}`}</div>
                <div>{c.address}</div>
                {c.lat != null && <a className="text-brand-700 hover:underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${c.lat},${c.lng}`}>📍 Buka peta ({c.lat}, {c.lng})</a>}
                <div>Paket: {c.packageName}</div>
                <div>Status: <Badge>{c.status}</Badge></div>
                {c.odp && <div>ODP/Port: {c.odp} / {c.port} · VLAN {c.vlan} · IP {c.ip}</div>}
                {c.warehouse && <div>Gudang: {c.warehouse.name}</div>}
              </div>
            </div>
          )}
          <div className="card text-sm">
            <h2 className="mb-2 font-semibold">Penugasan</h2>
            <div>Teknisi: {assignee?.name ?? '-'}</div>
            <div>Jadwal: {fmtDate(wo.scheduledAt)}</div>
          </div>
          {(parent || children.length > 0 || purchase.length > 0) && (
            <div className="card text-sm">
              <h2 className="mb-2 font-semibold">Terkait</h2>
              {parent && <div>Induk: <Link className="text-brand-700 hover:underline" href={`/work-orders/${parent.id}`}>{parent.number}</Link></div>}
              {children.map((k: any) => <div key={k.id}>Anak: <Link className="text-brand-700 hover:underline" href={`/work-orders/${k.id}`}>{k.number}</Link> <Badge>{k.status}</Badge></div>)}
              {purchase.map((p: any) => <div key={p.id}>PO: <Link className="text-brand-700 hover:underline" href={`/purchase-orders/${p.id}`}>{p.number}</Link> <Badge>{p.status}</Badge></div>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
