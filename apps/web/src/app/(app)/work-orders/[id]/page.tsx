'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, doDelete, fmtDate, ROLE_LABEL, roleText, TYPE_LABEL, useFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DynamicForm } from '@/components/DynamicForm';
import { toast } from '@/lib/dialog';
import { Badge, DataView, ErrorMsg, Modal, PageHeader, RefsContext, statusTone } from '@/components/ui';
import { fileUrl, imgUrl } from '@/lib/api';

export default function WoDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: wo, error, reload } = useFetch<any>(`/work-orders/${id}`);
  const { data: meta } = useFetch<any[]>('/work-orders/meta');
  const { user: me } = useAuth();
  const { data: stock } = useFetch<any>(wo && wo.type === 'STOCK_REQUEST' && wo.status === 'PROC_REVIEW' && ['GA', 'ADMIN'].includes(me?.role ?? '') ? `/work-orders/${id}/stock-check` : null);
  const [active, setActive] = useState<string | null>(null);
  const [editWo, setEditWo] = useState(false);
  const { user } = useAuth();
  const router = useRouter();

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
  const { events, customer, createdBy, assignee, parent, children, purchase, data, attachments, refs, team: _team, docs: _docs, ...rest } = wo;
  const photos: any[] = (attachments ?? []).filter((a: any) => a.kind !== 'LOGO');
  void rest;

  return (
    <div className="space-y-4">
      <PageHeader title={`${wo.number} · ${wo.title}`} sub={`${TYPE_LABEL[wo.type]} · dibuat ${fmtDate(wo.createdAt)} oleh ${createdBy.name}${wo.source === 'BILLING' ? ' (otomatis dari Billing)' : ''}`}>
        <Badge tone={statusTone(wo.final, wo.status)}>{wo.statusLabel}</Badge>
        {wo.source === 'CRM_DEMO' && <Badge tone="amber">UJI SAMBUNG (demo) — tidak ada pengiriman keluar</Badge>}
        {wo.type === 'NEW_INSTALL' && data?.activation && ['MKT', 'ADMIN'].includes(user?.role ?? '') && <Link href={`/doc/ba/${wo.id}`} className="btn-ghost">📄 {data?.ba ? 'Cetak BA' : 'Pratinjau BA'}</Link>}
        {wo.type === 'SERVICE_ORDER' && wo.docs?.soBa && <Link href={`/doc/ba/${wo.id}`} className="btn-ghost">📄 {data?.ba ? 'Cetak BA' : 'Pratinjau BA'}</Link>}
        {wo.docs?.reportNumber && <Link href={`/doc/report/${wo.id}`} className="btn-ghost">📄 {wo.docs.reportKind === 'INS' ? 'Laporan Instalasi (PDF)' : 'Laporan Troubleshooting (PDF)'}</Link>}
        {!wo.closedAt && (user?.role === 'ADMIN' || wo.createdById === user?.id) && <button className="btn-ghost" onClick={() => setEditWo(true)}>✎ Edit</button>}
        {user?.role === 'ADMIN' && <button className="btn-ghost !border-red-300 !text-red-600 hover:!bg-red-50" onClick={async () => { if (await doDelete(`/work-orders/${wo.id}`, `WO ${wo.number}`)) router.replace('/work-orders'); }}>🗑 Hapus</button>}
      </PageHeader>

      {wf && (
        <ol className="flex flex-wrap gap-1 text-xs">
          {Object.entries<any>(wf.statuses).filter(([k]) => !['REJECTED', 'SO_SOURCE_CHECK', 'SO_CANCELLED'].includes(k)).map(([k, s]) => (
            <li key={k} className={`rounded-full px-2 py-1 ${k === wo.status ? 'bg-brand-900 font-semibold text-white dark:bg-accent-500 dark:text-brand-900' : 'bg-slate-100 text-slate-500'}`}>{s.label}</li>
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
                      <button key={a.key} className={active === a.key ? (a.danger ? 'btn-danger' : 'btn') : 'btn-ghost'} onClick={() => setActive(a.key)}>{a.label}</button>
                    ))}
                  </div>
                  {current && (
                    <div className="rounded-lg border bg-slate-50 p-3">
                      <div className="mb-2 flex items-center justify-between text-sm"><b>{current.label}</b><button type="button" className="text-slate-500 hover:underline" onClick={() => setActive(null)}>Tutup form</button></div>
                      <DynamicForm key={current.key} fields={current.fields} initial={wo.prefill?.[current.key]} woId={wo.id} woNumber={wo.number} danger={current.danger} submitLabel={`✔ Submit: ${current.label}`}
                        onSubmit={async (input) => { await api(`/work-orders/${wo.id}/actions/${current.key}`, { body: input }); setActive(null); toast.success(`${current.label} berhasil.`); await reload(); }} />
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {stock && (
            <div className="card">
              <h2 className="mb-1 font-semibold">Cek stok</h2>
              <p className="mb-2 text-sm text-slate-500">Ketersediaan di gudang tujuan{stock.toWarehouse ? ` (${stock.toWarehouse})` : ''} dan gudang lain. Bila stok tujuan cukup, pilih <b>Stok tersedia di gudang tujuan → selesai</b>.</p>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b text-left text-slate-500"><th className="py-1 pr-3">Barang</th><th className="py-1 pr-3 text-right">Diminta</th><th className="py-1 pr-3 text-right">Di gudang tujuan</th><th className="py-1">Di gudang lain</th></tr></thead>
                <tbody>{stock.lines.map((l: any, i: number) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1.5 pr-3">{l.item}</td>
                    <td className="py-1.5 pr-3 text-right">{l.requested} {l.unit}</td>
                    <td className={`py-1.5 pr-3 text-right font-semibold ${l.enough ? 'text-green-700' : 'text-red-600'}`}>{l.atDestination} {l.unit} {l.enough ? '✓ cukup' : '✗ kurang'}</td>
                    <td className="py-1.5 text-slate-600">{l.others.length ? l.others.map((o: any) => `${o.warehouse}: ${o.qty}`).join(' · ') : '-'}</td>
                  </tr>))}</tbody>
              </table></div>
            </div>
          )}

          {wo.type === 'SERVICE_ORDER' && Array.isArray(data?.lines) && (
            <div className="card">
              <h2 className="mb-1 font-semibold">Form Penawaran {data.crmQuotation?.number && <span className="text-sm font-normal text-slate-500">· {data.crmQuotation.number} rev {data.crmQuotation.rev}</span>}</h2>
              <p className="mb-2 text-sm text-slate-500">
                Marketing: <b>{data.marketing?.name ?? '-'}</b>{data.mktOwner ? <> · pemegang order: <b>{data.mktOwner.name}</b></> : ' · antrean Marketing (belum ada pemegang)'}
                {data.prNumber && <> · PR proyek: <b>{data.prNumber}</b></>}{data.stockRequest && <> · Permintaan barang: <b>{data.stockRequest}</b></>}
              </p>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b text-left text-slate-500"><th className="py-1 pr-3">Item</th><th className="py-1 pr-3 text-right">Qty</th><th className="py-1 pr-3 text-right">Harga</th><th className="py-1">Sumber barang</th></tr></thead>
                <tbody>{data.lines.map((l: any, i: number) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1.5 pr-3">{l.name} <span className="text-xs text-slate-500">{l.kind === 'SERVICE' ? 'Jasa' : 'Produk'}{l.sku ? ` · SKU ${l.sku}` : ''}</span></td>
                    <td className="py-1.5 pr-3 text-right">{l.qty} {l.unit ?? ''}</td>
                    <td className="py-1.5 pr-3 text-right">Rp {Math.round(l.unitPrice).toLocaleString('id-ID')}</td>
                    <td className="py-1.5"><Badge tone={l.source === 'STOCK' ? 'green' : l.source === 'PROJECT' ? 'amber' : 'slate'}>{l.source === 'STOCK' ? 'Pakai stok' : l.source === 'PROJECT' ? 'PR proyek' : 'Tanpa barang'}</Badge></td>
                  </tr>))}</tbody>
              </table></div>
              <p className="mt-2 text-right text-sm font-semibold">Total Rp {Math.round(data.crmQuotation?.total ?? 0).toLocaleString('id-ID')} {data.crmQuotation?.taxNote && <span className="font-normal text-slate-500">({data.crmQuotation.taxNote})</span>}</p>
            </div>
          )}

          {wo.canProgress && (
            <div className="card">
              <h2 className="mb-1 font-semibold">Update progres lapangan</h2>
              <p className="mb-2 text-sm text-slate-500">Kirim foto progres (GPS + logo otomatis) tanpa mengubah tahap WO. NOC dan pembuat WO diberi tahu.</p>
              <DynamicForm key={`progress-${events.length}`} woId={wo.id} woNumber={wo.number} photoKind="PROGRESS" submitLabel="Kirim progres"
                fields={[{ name: 'photos', label: 'Foto progres', type: 'photos', required: true }, { name: 'note', label: 'Catatan progres', type: 'textarea' }]}
                onSubmit={async (v) => { await api(`/work-orders/${wo.id}/progress`, { body: v }); toast.success('Progres disimpan.'); await reload(); }} />
            </div>
          )}

          {photos.length > 0 && (
            <div className="card">
              <h2 className="mb-2 font-semibold">Foto lapangan ({photos.length})</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {photos.map((a: any) => (
                  <figure key={a.id} className="overflow-hidden rounded-lg border text-xs">
                    <a href={fileUrl(a.url)} target="_blank" rel="noreferrer"><img src={imgUrl(a.url, { w: 560 })} alt="" className="aspect-[4/3] w-full object-cover" /></a>
                    <figcaption className="space-y-0.5 p-2">
                      <div className="flex items-center justify-between"><Badge tone={a.kind === 'PROGRESS' ? 'violet' : 'blue'}>{a.kind === 'PROGRESS' ? 'Progres' : 'Laporan'}</Badge><span className="text-slate-500">{fmtDate(a.takenAt ?? a.createdAt)}</span></div>
                      <div className="text-slate-600">{a.uploaderName}{a.note ? ` — ${a.note}` : ''}</div>
                      {a.lat != null ? <a className="text-brand-700 hover:underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${a.lat},${a.lng}`}>📍 {a.lat.toFixed(5)}, {a.lng.toFixed(5)}{a.accuracy ? ` (±${Math.round(a.accuracy)} m)` : ''}</a> : <span className="text-amber-600">Tanpa GPS</span>}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <h2 className="mb-2 font-semibold">Detail & laporan</h2>
            <RefsContext.Provider value={refs ?? {}}><DataView value={wo.type === 'SERVICE_ORDER' ? Object.fromEntries(Object.entries(data ?? {}).filter(([k]) => !['lines', 'crmQuotation', 'marketing', 'mktOwner', 'newCustomer', 'confirmedBy', 'stockOk', 'prReceived'].includes(k))) : data} /></RefsContext.Provider>
          </div>

          <div className="card">
            <h2 className="mb-3 font-semibold">Riwayat</h2>
            <ol className="space-y-3 border-l-2 border-slate-200 pl-4">
              {events.map((e: any) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-accent-500" />
                  <div className="text-sm"><b>{e.actorName ?? 'Sistem'}</b>{e.actorRole && <span className="text-xs text-slate-500"> ({roleText({ role: e.actorRole, subRole: e.actorSubRole ?? undefined })})</span>} · {e.action} → <span className="text-brand-700">{wf.statuses[e.toStatus]?.label ?? e.toStatus}</span></div>
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
                {c.lat != null && <a className="text-brand-700 hover:underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${c.lat},${c.lng}`}>📍 Buka peta ({Number(c.lat).toFixed(5)}, {Number(c.lng).toFixed(5)})</a>}
                <div>Paket: {c.packageName}</div>
                <div>Status: <Badge>{c.status}</Badge></div>
                {c.odp && <div>ODP/Port: {c.odp} / {c.port} · VLAN {c.vlan} · IP {c.ip}</div>}
                {c.warehouse && <div>Gudang: {c.warehouse.name}</div>}
              </div>
            </div>
          )}
          <div className="card text-sm">
            <h2 className="mb-2 font-semibold">Penugasan</h2>
            <div>{(wo.team?.length ?? 0) > 1 ? 'Tim pelaksana' : 'Teknisi'}: {wo.team?.length ? wo.team.map((t: any) => t.name).join(', ') : assignee?.name ?? '-'}</div>
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
      {editWo && (
        <Modal title={`Edit ${wo.number}`} onClose={() => setEditWo(false)}>
          <p className="mb-2 text-xs text-slate-500">Hanya judul dan catatan. Perubahan tahap dilakukan lewat tombol Tindakan.</p>
          <DynamicForm fields={[{ name: 'title', label: 'Judul WO', type: 'text', required: true }, { name: 'notes', label: 'Catatan', type: 'textarea' }]} initial={{ title: wo.title, notes: (data as any)?.notes }} submitLabel="Simpan" onSubmit={async (v) => { await api(`/work-orders/${wo.id}`, { method: 'PATCH', body: v }); setEditWo(false); await reload(); }} />
        </Modal>
      )}
    </div>
  );
}
