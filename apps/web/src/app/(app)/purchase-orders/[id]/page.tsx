'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { useRouter } from 'next/navigation';
import { api, doDelete, useFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { BrandModelInput, DynamicForm, SerialInput } from '@/components/DynamicForm';
import { Badge, ErrorMsg, Modal, PageHeader } from '@/components/ui';

export default function PoDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const { data: po, error, reload } = useFetch<any>(`/purchase-orders/${id}`);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string[]>>({});
  const [err, setErr] = useState('');
  const [labels, setLabels] = useState<any[]>([]);
  const [bm, setBm] = useState<Record<string, { brandId?: string; modelId?: string }>>({});
  const [edit, setEdit] = useState(false);
  const router = useRouter();
  const canReceive = ['ADMIN', 'GA'].includes(user?.role ?? '');

  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  if (!po) return <p className="text-slate-500">Memuat…</p>;

  async function receive() {
    setErr('');
    try {
      const lines = po.lines.map((l: any) => ({ lineId: l.id, qty: Number(qty[l.id] || 0), serials: serials[l.id] ?? [], brandId: bm[l.id]?.brandId, modelId: bm[l.id]?.modelId })).filter((l: any) => l.qty > 0);
      if (!lines.length) return setErr('Isi qty yang diterima (hanya yang lolos QC)');
      const r = await api<{ assets: any[] }>(`/purchase-orders/${po.id}/receive`, { body: { lines } });
      setLabels(r.assets); setQty({}); setSerials({}); await reload();
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="space-y-4">
      <PageHeader title={po.number} sub={`Vendor ${po.vendor} · tujuan ${po.warehouse?.name}`}><Badge tone={po.status === 'RECEIVED' ? 'green' : 'blue'}>{po.status}</Badge>
        {canReceive && po.status === 'ISSUED' && <button className="btn-ghost" onClick={() => setEdit(true)}>✎ Edit</button>}
        {canReceive && po.status === 'ISSUED' && <button className="btn-ghost text-red-600" onClick={async () => { if (await doDelete(`/purchase-orders/${po.id}`, `PO ${po.number}`)) router.replace('/purchase-orders'); }}>🗑 Hapus</button>}
      </PageHeader>
      {po.note && <p className="text-sm text-slate-500">Catatan: {po.note}</p>}
      {po.wo && <p className="text-sm">Dari WO <Link className="text-brand-700 hover:underline" href={`/work-orders/${po.wo.id}`}>{po.wo.number}</Link></p>}

      <div className="card space-y-4">
        <h2 className="font-semibold">Penerimaan & QC barang</h2>
        {po.lines.map((l: any) => {
          const remain = l.qty - l.receivedQty;
          return (
            <div key={l.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><b>{l.item.name}</b> <span className="text-sm text-slate-500">diterima {l.receivedQty}/{l.qty} {l.item.unit}</span></div>
                {canReceive && remain > 0 && <input className="input w-36" type="number" min={0} max={remain} placeholder={`Qty lolos QC (≤${remain})`} value={qty[l.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />}
              </div>
              {canReceive && remain > 0 && l.item.category === 'NETWORK' && (
                <div className="mt-2 space-y-2"><div className="max-w-md"><div className="mb-1 text-xs text-slate-500">Merk & tipe (opsional, berlaku untuk unit yang diterima sekarang)</div><BrandModelInput value={bm[l.id] ?? {}} onChange={(v) => setBm({ ...bm, [l.id]: v })} canCreate /></div><div className="mb-1 text-xs text-slate-500">Scan SN tiap unit yang diterima</div>
                  <SerialInput value={serials[l.id] ?? []} onChange={(v) => setSerials({ ...serials, [l.id]: v })} /></div>
              )}
            </div>
          );
        })}
        <ErrorMsg>{err}</ErrorMsg>
        {canReceive && po.status !== 'RECEIVED' && <button className="btn" onClick={receive}>Terima barang & buat label QR</button>}
      </div>

      {labels.length > 0 && (
        <div className="card">
          <div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">Label QR ({labels.length})</h2><div className="flex gap-2"><button className="btn-ghost" onClick={() => window.print()}>Cetak cepat</button><button className="btn" onClick={() => { try { sessionStorage.setItem('qr_print_ids', JSON.stringify(labels.map((a) => a.id))); } catch { /* ignore */ } window.open('/qr-print', '_blank'); }}>Cetak A4 (pilih ukuran label)</button></div></div>
          <div className="print-area grid grid-cols-2 gap-3 md:grid-cols-4">
            {labels.map((a) => (
              <div key={a.id} className="rounded border p-2 text-center"><QRCodeSVG value={a.serialNumber} size={96} className="mx-auto" /><div className="mt-1 font-mono text-xs">{a.serialNumber}</div>{a.assetCode && <div className="text-[10px]">{a.assetCode}</div>}</div>
            ))}
          </div>
        </div>
      )}
      {edit && (
        <Modal title={`Edit ${po.number}`} onClose={() => setEdit(false)}>
          <DynamicForm fields={[{ name: 'vendor', label: 'Vendor', type: 'text', required: true }, { name: 'note', label: 'Catatan', type: 'textarea' }]} initial={po} sendEmpty submitLabel="Simpan" onSubmit={async (v) => { await api(`/purchase-orders/${po.id}`, { method: 'PATCH', body: v }); setEdit(false); await reload(); }} />
        </Modal>
      )}
    </div>
  );
}
