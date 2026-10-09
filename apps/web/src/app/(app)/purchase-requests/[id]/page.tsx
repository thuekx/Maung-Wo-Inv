'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, doDelete, fmtDate, roleText, useFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { toast } from '@/lib/dialog';
import { DynamicForm } from '@/components/DynamicForm';
import { Badge, ErrorMsg, Modal, PageHeader, Table } from '@/components/ui';
import { rupiah } from '@/components/DocSheet';
import { PR_STATUS } from '@/lib/pr';

export default function PrDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user } = useAuth();
  const { data: pr, error, reload } = useFetch<any>(`/purchase-requests/${id}`);
  const [modal, setModal] = useState<'issue' | 'decision' | 'po' | 'cancel' | null>(null);
  const [err, setErr] = useState('');
  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  if (!pr) return <p className="text-slate-500">Memuat…</p>;
  const ga = user?.role === 'ADMIN' || user?.role === 'GA';
  const mine = pr.createdBy.id === user?.id;
  const st = PR_STATUS[pr.status];
  const run = async (fn: () => Promise<unknown>, ok: string) => { setErr(''); try { await fn(); toast.success(ok); setModal(null); await reload(); } catch (e) { setErr((e as Error).message); } };
  const chosen = (l: any) => l.quotes.find((q: any) => q.chosen);
  const editable = (pr.status === 'DRAFT' && (mine || ga)) || (pr.status === 'SUBMITTED' && ga);

  return (
    <div className="space-y-4">
      <PageHeader pretitle="Pengadaan" title={pr.number ? `PR ${pr.number}` : 'Purchase Request (draft)'} sub={`${pr.subject} · dibuat ${fmtDate(pr.createdAt)} oleh ${pr.createdBy.name} (${roleText(pr.createdBy)})`}>
        <Badge tone={st.tone}>{st.label}</Badge>
        {editable && <Link href={`/purchase-requests/${id}/edit`} className="btn-ghost">✎ Ubah</Link>}
        {pr.status === 'DRAFT' && (mine || ga) && <button className="btn" onClick={() => run(() => api(`/purchase-requests/${id}/submit`, { body: {} }), 'PR diajukan ke GA/Procurement.')}>Ajukan ke GA</button>}
        {ga && ['DRAFT', 'SUBMITTED', 'ISSUED'].includes(pr.status) && <button className={pr.status === 'ISSUED' ? 'btn-ghost' : 'btn'} onClick={() => setModal('issue')}>{pr.status === 'ISSUED' ? 'Ubah penandatangan' : 'Terbitkan PDF'}</button>}
        <Link href={`/doc/pr/${id}`} className="btn-ghost">📄 {pr.number ? 'Cetak PDF' : 'Pratinjau'}</Link>
        {ga && pr.status === 'ISSUED' && <button className="btn" onClick={() => setModal('decision')}>Catat keputusan</button>}
        {ga && pr.status === 'APPROVED' && <button className="btn" onClick={() => setModal('po')}>Catat PO dari Accurate</button>}
        {['DRAFT', 'SUBMITTED', 'ISSUED', 'APPROVED'].includes(pr.status) && !pr.pos.length && (mine || ga) && <button className="btn-ghost text-red-600" onClick={() => setModal('cancel')}>Batalkan</button>}
        {['DRAFT', 'SUBMITTED'].includes(pr.status) && (mine || ga) && <button className="btn-ghost text-red-600" onClick={async () => { if (await doDelete(`/purchase-requests/${id}`, 'draft PR ini')) router.replace('/purchase-requests'); }}>🗑 Hapus</button>}
      </PageHeader>
      <ErrorMsg>{err}</ErrorMsg>

      {pr.wo && <p className="text-sm">Dari permintaan barang <Link className="text-brand-700 hover:underline" href={`/work-orders/${pr.wo.id}`}>{pr.wo.number}</Link></p>}
      {pr.approvedAt && <p className="text-sm text-slate-600">Keputusan dicatat {fmtDate(pr.approvedAt)}{pr.approvalRef ? ` · ref ${pr.approvalRef}` : ''}{pr.approvalNote ? ` · ${pr.approvalNote}` : ''}</p>}
      {pr.pos.length > 0 && <p className="text-sm">PO tercatat: {pr.pos.map((p: any) => <Link key={p.id} className="mr-2 text-brand-700 hover:underline" href={`/purchase-orders/${p.id}`}>{p.number} ({p.vendor})</Link>)}</p>}

      <div className="card">
        <h2 className="mb-2 font-semibold">Rincian & perbandingan vendor</h2>
        <Table head={['No', 'Deskripsi', 'Qty', 'Vendor (harga satuan)', 'Dipilih', 'Total', 'PO']}>
          {pr.lines.map((l: any, i: number) => {
            const c = chosen(l);
            return (
              <tr key={l.id}>
                <td className="td">{i + 1}</td>
                <td className="td">{l.description}{l.itemId ? <div className="text-xs text-slate-500">Barang stok: {l.item?.name}</div> : <div className="text-xs text-slate-400">Non-stok / jasa</div>}</td>
                <td className="td whitespace-nowrap">{l.qty} {l.unit}</td>
                <td className="td text-sm">{l.quotes.map((q: any) => <div key={q.id} className={q.chosen ? 'font-semibold text-green-700' : ''}>{q.chosen ? '✓ ' : ''}{q.vendor.name} — {rupiah(q.unitPrice)}</div>)}{!l.quotes.length && <span className="text-amber-600">belum ada</span>}</td>
                <td className="td text-sm">{c?.vendor.name ?? '-'}</td>
                <td className="td whitespace-nowrap text-right">{c ? rupiah(l.qty * Number(c.unitPrice)) : '-'}</td>
                <td className="td text-xs">{l.poLineId ? <Badge tone="green">tercatat</Badge> : '-'}</td>
              </tr>
            );
          })}
        </Table>
        <div className="mt-3 space-y-0.5 text-right text-sm"><div>Subtotal {rupiah(pr.totals.subtotal)}</div><div>PPN {Number(pr.taxPct)}% {rupiah(pr.totals.tax)}</div><div className="font-semibold">Grand Total {rupiah(pr.totals.grandTotal)}</div></div>
      </div>

      {pr.signRequester && <p className="text-sm text-slate-600">Mengajukan: <b>{pr.signRequester}</b>{pr.signRequesterTitle ? ` (${pr.signRequesterTitle})` : ''} · Mengetahui: <b>{pr.signKnow}</b> · Menyetujui: <b>{pr.signApprove}</b></p>}

      {modal === 'issue' && (
        <Modal title="Terbitkan PDF Pengajuan" onClose={() => setModal(null)}>
          <p className="mb-3 text-sm text-slate-500">Nomor surat dibuat otomatis ({pr.number ?? 'saat diterbitkan'}). Isi nama penandatangan sesuai dokumen saat ini; dapat diubah lagi selama belum disetujui.</p>
          <DynamicForm submitLabel={pr.status === 'ISSUED' ? 'Simpan penandatangan' : 'Terbitkan'} initial={{ signRequester: pr.signRequester ?? pr.createdBy.name, signRequesterTitle: pr.signRequesterTitle ?? roleText(pr.createdBy), signKnow: pr.signKnow ?? 'Akhmad Taufik', signApprove: pr.signApprove ?? 'Ayus Fardiaz', docDate: (pr.docDate ?? new Date().toISOString()).slice(0, 16) }}
            fields={[
              { name: 'signRequester', label: 'Mengajukan (nama)', type: 'text', required: true },
              { name: 'signRequesterTitle', label: 'Jabatan pengaju', type: 'text', help: 'mis. Manager' },
              { name: 'signKnow', label: 'Mengetahui (nama)', type: 'text', required: true },
              { name: 'signApprove', label: 'Menyetujui (nama)', type: 'text', required: true },
              { name: 'docDate', label: 'Tanggal surat', type: 'datetime' },
            ]}
            onSubmit={async (v) => { await api(`/purchase-requests/${id}/issue`, { body: v }); toast.success('PR diterbitkan.'); setModal(null); await reload(); router.push(`/doc/pr/${id}`); }} />
        </Modal>
      )}
      {modal === 'decision' && (
        <Modal title="Catat keputusan persetujuan" onClose={() => setModal(null)}>
          <DynamicForm submitLabel="Simpan keputusan" fields={[
            { name: 'decision', label: 'Keputusan', type: 'select', options: ['APPROVED', 'REJECTED'], required: true, help: 'APPROVED = disetujui · REJECTED = ditolak (wajib alasan)' },
            { name: 'approvalRef', label: 'No. referensi persetujuan / PR di Accurate (opsional)', type: 'text' },
            { name: 'note', label: 'Catatan / alasan', type: 'textarea' },
          ]} onSubmit={(v) => run(() => api(`/purchase-requests/${id}/decision`, { body: v }), 'Keputusan dicatat.')} />
        </Modal>
      )}
      {modal === 'cancel' && (
        <Modal title="Batalkan PR" onClose={() => setModal(null)}>
          <DynamicForm danger submitLabel="Batalkan PR" fields={[{ name: 'note', label: 'Alasan pembatalan', type: 'textarea', required: true }]} onSubmit={(v) => run(() => api(`/purchase-requests/${id}/cancel`, { body: v }), 'PR dibatalkan.')} />
        </Modal>
      )}
      {modal === 'po' && <PoEntry pr={pr} onClose={() => setModal(null)} onDone={async (poId) => { toast.success('PO dicatat.'); setModal(null); router.push(`/purchase-orders/${poId}`); }} />}
    </div>
  );
}

/** Catat ulang PO dari Accurate: nomor PO Accurate, vendor (dari penawaran terpilih), item master & harga riil. */
function PoEntry({ pr, onClose, onDone }: { pr: any; onClose: () => void; onDone: (poId: string) => void }) {
  const vendors = [...new Map<string, string>(pr.lines.filter((l: any) => l.itemId && !l.poLineId).map((l: any) => { const c = l.quotes.find((q: any) => q.chosen); return [c?.vendorId, c?.vendor.name]; }).filter(([k]: any) => k)).entries()];
  const { data: whs } = useFetch<any[]>('/warehouses');
  const { data: items } = useFetch<any[]>('/items');
  const [vendorId, setVendorId] = useState<string>(vendors[0]?.[0] ?? '');
  const [number, setNumber] = useState('');
  const [poDate, setPoDate] = useState(new Date().toISOString().slice(0, 10));
  const [wh, setWh] = useState<string>('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [fe, setFe] = useState<Record<string, string>>({});
  const mineLines = pr.lines.filter((l: any) => l.itemId && !l.poLineId && l.quotes.find((q: any) => q.chosen)?.vendorId === vendorId);
  const [rows, setRows] = useState<Record<string, { itemId: string; qty: string; unitPrice: string }>>({});
  const row = (l: any) => rows[l.id] ?? { itemId: l.itemId, qty: String(l.qty), unitPrice: String(Number(l.quotes.find((q: any) => q.chosen).unitPrice)) };
  const setRow = (l: any, patch: object) => setRows({ ...rows, [l.id]: { ...row(l), ...patch } });
  async function save() {
    setErr(''); setFe({});
    try {
      const r = await api<{ id: string }>(`/purchase-requests/${pr.id}/purchase-orders`, { body: { number, vendorId, poDate, toWarehouseId: wh, note: note || null, lines: mineLines.map((l: any) => ({ prLineId: l.id, itemId: row(l).itemId, qty: Number(row(l).qty), unitPrice: Number(row(l).unitPrice) })) } });
      onDone(r.id);
    } catch (e) { setFe((e as any).fields ?? {}); setErr((e as Error).message); }
  }
  return (
    <Modal title="Catat PO dari Accurate" onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-sm text-slate-500">PO diterbitkan di Accurate; di sini dicatat ulang dengan rincian barang & harga sebenarnya agar penerimaan/QC dan stok tersinkron.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="mb-1 block text-sm font-medium">Vendor *</label><select className="input" value={vendorId} onChange={(e) => { setVendorId(e.target.value); setRows({}); }}>{vendors.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>{fe.vendorId && <p className="mt-1 text-xs text-red-600">{fe.vendorId}</p>}</div>
          <div><label className="mb-1 block text-sm font-medium">No. PO (dari Accurate) *</label><input className="input" value={number} maxLength={60} onChange={(e) => setNumber(e.target.value)} />{fe.number && <p className="mt-1 text-xs text-red-600">{fe.number}</p>}</div>
          <div><label className="mb-1 block text-sm font-medium">Tanggal PO *</label><input className="input" type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} /></div>
          <div><label className="mb-1 block text-sm font-medium">Gudang tujuan *</label><select className="input" value={wh} onChange={(e) => setWh(e.target.value)}><option value="">— pilih gudang —</option>{whs?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>{fe.toWarehouseId && <p className="mt-1 text-xs text-red-600">{fe.toWarehouseId}</p>}</div>
        </div>
        <div className="space-y-2">
          {mineLines.map((l: any) => (
            <div key={l.id} className="grid grid-cols-[1fr_6rem_9rem] items-center gap-2 max-md:grid-cols-1">
              <div><div className="text-sm font-medium">{l.description}</div><select className="input mt-1" value={row(l).itemId} onChange={(e) => setRow(l, { itemId: e.target.value })}>{items?.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</select></div>
              <input className="input" type="number" min={1} value={row(l).qty} onChange={(e) => setRow(l, { qty: e.target.value })} aria-label="Qty" />
              <input className="input" type="number" min={0} step="any" value={row(l).unitPrice} onChange={(e) => setRow(l, { unitPrice: e.target.value })} aria-label="Harga satuan" />
            </div>
          ))}
          {!mineLines.length && <p className="text-sm text-slate-500">Tidak ada baris tersisa untuk vendor ini.</p>}
        </div>
        <div><label className="mb-1 block text-sm font-medium">Catatan</label><input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></div>
        <ErrorMsg>{err}</ErrorMsg>
        <button className="btn" disabled={!mineLines.length} onClick={save}>Simpan PO</button>
      </div>
    </Modal>
  );
}
