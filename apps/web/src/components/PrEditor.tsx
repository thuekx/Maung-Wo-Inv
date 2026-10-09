'use client';
import { useState } from 'react';
import { api, useFetch } from '@/lib/api';
import { ErrorMsg } from './ui';
import { toast } from '@/lib/dialog';
import { Select } from '@/components/Select';
import { useAuth } from '@/lib/auth';

export interface PrLineDraft { description: string; qty: number | string; unit: string; itemId: string; note: string; quotes: { vendorId: string; unitPrice: number | string; note: string; chosen: boolean }[] }
export interface PrDraft { subject: string; note: string; taxPct: number | string; areaId?: string; lines: PrLineDraft[] }

export const emptyLine = (): PrLineDraft => ({ description: '', qty: 1, unit: 'Unit', itemId: '', note: '', quotes: [{ vendorId: '', unitPrice: '', note: '', chosen: false }, { vendorId: '', unitPrice: '', note: '', chosen: false }] });

const rp = (n: number) => `Rp. ${Math.round(n).toLocaleString('id-ID')}`;

/** Editor Purchase Request: baris barang + penawaran ≥ N vendor per baris (pilih satu) → total & PPN dihitung otomatis. */
export function PrEditor({ initial, prId, onSaved, minVendors = 2 }: { initial: PrDraft; prId?: string; onSaved: (id: string, opts?: { issue?: boolean }) => void; minVendors?: number }) {
  const { user } = useAuth();
  /** GA/Procurement (dan Admin) mengisi perbandingan harga & PPN; pengaju lain hanya mengisi barang. */
  const compare = user?.role === 'GA' || user?.role === 'ADMIN';
  const { data: areas } = useFetch<any[]>('/areas');
  const [v, setV] = useState<PrDraft>(initial);
  const [err, setErr] = useState('');
  const [fe, setFe] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { data: vendors } = useFetch<any[]>('/vendors');
  const { data: items } = useFetch<any[]>('/items');
  const setLine = (i: number, patch: Partial<PrLineDraft>) => setV((p) => ({ ...p, lines: p.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) }));
  const setQuote = (i: number, j: number, patch: Partial<PrLineDraft['quotes'][0]>) => setV((p) => ({ ...p, lines: p.lines.map((l, k) => (k === i ? { ...l, quotes: l.quotes.map((q, m) => (m === j ? { ...q, ...patch } : patch.chosen ? { ...q, chosen: false } : q)) } : l)) }));

  const sub = v.lines.reduce((n, l) => n + (Number(l.qty) || 0) * (Number(l.quotes.find((q) => q.chosen)?.unitPrice) || 0), 0);
  const tax = (sub * (Number(v.taxPct) || 0)) / 100;

  async function save(issue = false) {
    setErr(''); setFe({}); setBusy(true);
    try {
      const body = {
        subject: v.subject, note: v.note || null, areaId: v.areaId || null, ...(compare ? { taxPct: v.taxPct === '' ? undefined : Number(v.taxPct) } : {}),
        lines: v.lines.map((l) => ({ description: l.description, qty: Number(l.qty), unit: l.unit || 'Unit', itemId: l.itemId || null, note: l.note || null, quotes: l.quotes.filter((q) => q.vendorId).map((q) => ({ vendorId: q.vendorId, unitPrice: Number(q.unitPrice) || 0, note: q.note || null, chosen: q.chosen })) })),
      };
      const r = prId ? await api<any>(`/purchase-requests/${prId}`, { method: 'PUT', body }).then(() => ({ id: prId })) : await api<{ id: string }>('/purchase-requests', { body });
      toast.success(issue ? 'PR disimpan — lanjut terbitkan.' : 'PR disimpan.');
      onSaved(r.id, { issue });
    } catch (e) {
      const f = (e as any).fields as Record<string, string> | undefined;
      if (f) setFe(f);
      setErr((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div><label className="mb-1 block text-sm font-medium">Perihal <span className="text-red-500">*</span></label><input className="input" value={v.subject} maxLength={200} onChange={(e) => setV({ ...v, subject: e.target.value })} placeholder="mis. Pengajuan Operasional – pembelian ATK Oktober" />{fe.subject && <p className="mt-1 text-xs text-red-600">{fe.subject}</p>}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="mb-1 block text-sm font-medium">Area <span className="text-red-500">*</span></label>
            <Select className="input" value={v.areaId ?? ''} onChange={(e) => setV({ ...v, areaId: e.target.value })}><option value="">— pilih area —</option>{areas?.map((a) => <option key={a.id} value={a.id}>{a.name}{a.alias ? ` (${a.alias})` : ''}</option>)}</Select>
            <p className="mt-0.5 text-xs text-slate-500">Singkatan area dipakai pada nomor surat PR.</p>{fe.areaId && <p className="mt-1 text-xs font-medium text-red-600">{fe.areaId}</p>}</div>
          {compare && <div><label className="mb-1 block text-sm font-medium">PPN (%)</label><input className="input" type="number" min={0} max={100} step="any" value={v.taxPct} onChange={(e) => setV({ ...v, taxPct: e.target.value })} /></div>}
          <div className={compare ? 'sm:col-span-2' : ''}><label className="mb-1 block text-sm font-medium">Catatan internal</label><input className="input" value={v.note} maxLength={500} onChange={(e) => setV({ ...v, note: e.target.value })} /></div>
        </div>
      </div>

      {v.lines.map((l, i) => (
        <div key={i} className="card space-y-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold">Item {i + 1}</h3>
            {v.lines.length > 1 && <button type="button" className="btn-ghost !px-2.5 !py-1 !text-xs !border-red-300 !text-red-600 hover:!bg-red-50" onClick={() => setV({ ...v, lines: v.lines.filter((_, k) => k !== i) })}>Hapus item</button>}
          </div>
          <div className="grid gap-3 md:grid-cols-6">
            <div className="md:col-span-3"><label className="mb-1 block text-xs font-medium">Deskripsi *</label><input className="input" value={l.description} maxLength={200} onChange={(e) => setLine(i, { description: e.target.value })} /></div>
            <div><label className="mb-1 block text-xs font-medium">Qty *</label><input className="input" type="number" min={1} value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></div>
            <div><label className="mb-1 block text-xs font-medium">Satuan</label><input className="input" value={l.unit} maxLength={20} onChange={(e) => setLine(i, { unit: e.target.value })} /></div>
            <div><label className="mb-1 block text-xs font-medium">Barang stok?</label>
              <Select className="input" value={l.itemId} onChange={(e) => { const it = items?.find((x) => x.id === e.target.value); setLine(i, { itemId: e.target.value, ...(it && !l.description ? { description: it.name, unit: it.unit } : {}) }); }}>
                <option value="">Non-stok / jasa</option>
                {items?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select></div>
          </div>
          {compare && <div>
            <div className="mb-1 flex items-center justify-between text-xs font-medium"><span>Perbandingan vendor (min. {minVendors}, pilih satu) — harga per satuan</span><span className={l.quotes.filter((q) => q.vendorId).length >= minVendors ? 'text-green-700' : 'text-amber-700'}>{l.quotes.filter((q) => q.vendorId).length} vendor</span></div>
            <div className="space-y-2">
              {l.quotes.map((q, j) => (
                <div key={j} className="grid grid-cols-[auto_1fr_9rem_1fr_auto] items-center gap-2 max-md:grid-cols-[auto_1fr_auto]">
                  <input type="radio" name={`ch-${i}`} checked={q.chosen} disabled={!q.vendorId} onChange={() => setQuote(i, j, { chosen: true })} aria-label="Pilih vendor ini" />
                  <Select className="input" value={q.vendorId} onChange={(e) => setQuote(i, j, { vendorId: e.target.value })}>
                    <option value="">— pilih vendor —</option>
                    {vendors?.filter((x) => x.id === q.vendorId || !l.quotes.some((o) => o.vendorId === x.id)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </Select>
                  <input className="input" type="number" min={0} step="any" placeholder="Harga satuan" value={q.unitPrice} onChange={(e) => setQuote(i, j, { unitPrice: e.target.value })} />
                  <input className="input max-md:col-span-3" placeholder="Keterangan (opsional)" value={q.note} maxLength={200} onChange={(e) => setQuote(i, j, { note: e.target.value })} />
                  <button type="button" className="text-red-600" aria-label="Hapus vendor" onClick={() => setLine(i, { quotes: l.quotes.filter((_, m) => m !== j) })}>✕</button>
                </div>
              ))}
            </div>
            <button type="button" className="btn-ghost mt-2" onClick={() => setLine(i, { quotes: [...l.quotes, { vendorId: '', unitPrice: '', note: '', chosen: false }] })}>+ Vendor</button>
            {!vendors?.length && vendors && <p className="mt-1 text-xs text-amber-700">Belum ada vendor — tambahkan dulu di Master Data → Vendor.</p>}
          </div>}
          {compare && <div><label className="mb-1 block text-xs font-medium">Keterangan baris (tampil di tabel perbandingan)</label><input className="input" value={l.note} maxLength={200} onChange={(e) => setLine(i, { note: e.target.value })} /></div>}
        </div>
      ))}
      {fe.lines && <p className="text-sm font-medium text-red-600">{fe.lines}</p>}
      <button type="button" className="btn-ghost" onClick={() => setV({ ...v, lines: [...v.lines, emptyLine()] })}>+ Tambah item</button>

      <div className="card flex flex-wrap items-center justify-between gap-3">
        {compare ? <div className="text-sm"><div>Subtotal (vendor terpilih): <b>{rp(sub)}</b></div><div>PPN {Number(v.taxPct) || 0}%: <b>{rp(tax)}</b></div><div>Grand Total: <b>{rp(sub + tax)}</b></div></div>
          : <p className="text-sm text-slate-500">Perbandingan harga vendor & PPN diisi GA/Procurement setelah PR diajukan.</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => save(false)}>{busy ? 'Menyimpan…' : 'Simpan draft'}</button>
          {compare && <button type="button" className="btn" disabled={busy} onClick={() => save(true)}>Simpan & terbitkan PR</button>}
        </div>
      </div>
      <ErrorMsg>{err}</ErrorMsg>
    </div>
  );
}
