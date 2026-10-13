'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api, useFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { toast } from '@/lib/dialog';
import { Badge, custLabel, custTone, ErrorMsg } from '@/components/ui';

/**
 * Akun & tautan CRM pada satu kode pelanggan: induk akun (kode lama untuk layanan/lokasi baru milik pemilik/PIC yang sama) dan
 * nomor Lead CRM (LD-123, 1 Lead = 1 kode). Marketing mengisinya — juga setelah PROSPECT terbentuk dari MSRadius — agar CRM
 * menautkan Lead ke kode baru secara pasti. Kelompok akun (induk + layanan-layanannya) ditampilkan bersama.
 */
export function CrmLinksCard({ customerId }: { customerId: string }) {
  const { user } = useAuth();
  const { data: c, error, reload } = useFetch<any>(`/customers/${customerId}`);
  const [edit, setEdit] = useState(false);
  const [parent, setParent] = useState('');
  const [lead, setLead] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (error || !c) return null;
  const canEdit = (user?.features ?? []).includes('subscriptions');
  const g = c.group ?? { parent: null, children: [] };
  const start = () => { setParent(c.parentCustomerCode ?? ''); setLead(c.crmLeadRef ?? ''); setErr(''); setEdit(true); };
  const save = async () => {
    setBusy(true); setErr('');
    try { await api(`/customers/${c.id}/crm-links`, { method: 'PATCH', body: { parentCustomerCode: parent.trim(), crmLeadRef: lead.trim() } }); toast.success('Tautan CRM disimpan'); setEdit(false); await reload(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="card space-y-2">
      <div className="card-header flex items-center justify-between"><h2 className="font-semibold">Akun &amp; tautan CRM</h2>{canEdit && !edit && <button className="btn-ghost" onClick={start}>✎ Ubah</button>}</div>
      {!edit ? (
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-slate-500">Induk akun</dt><dd>{g.parent ? <Link className="text-brand-700 hover:underline" href={`/customers/${g.parent.id}`}>{g.parent.code} · {g.parent.name}</Link> : c.parentCustomerCode ? <span className="text-amber-700">{c.parentCustomerCode} (kode tidak ditemukan)</span> : '-'}</dd></div>
          <div><dt className="text-xs text-slate-500">Nomor Lead CRM</dt><dd className="font-mono">{c.crmLeadRef ?? '-'}</dd></div>
          {g.children.length > 0 && (
            <div className="sm:col-span-2"><dt className="text-xs text-slate-500">Layanan/lokasi di bawah akun ini ({g.children.length})</dt>
              <dd className="mt-1 flex flex-wrap gap-2">{g.children.map((x: any) => <Link key={x.id} href={`/customers/${x.id}`} className="rounded-lg border px-2 py-1 text-xs hover:bg-slate-50">{x.code} · {x.name} <Badge tone={custTone(x.status)}>{custLabel(x.status)}</Badge></Link>)}</dd></div>
          )}
        </dl>
      ) : (
        <div className="space-y-3">
          <div><label className="mb-1 block text-sm font-medium">Kode pelanggan induk</label><input className="input" value={parent} onChange={(e) => setParent(e.target.value)} placeholder="mis. CUST-20260101-0001 (kosongkan bila tidak ada)" /><p className="mt-0.5 text-xs text-slate-500">Isi bila ini layanan/lokasi baru milik pelanggan yang sudah punya kode. Harus kode yang ada di WO.</p></div>
          <div><label className="mb-1 block text-sm font-medium">Nomor Lead CRM</label><input className="input" value={lead} onChange={(e) => setLead(e.target.value)} placeholder="LD-123" /><p className="mt-0.5 text-xs text-slate-500">Format LD-angka (salin dari kartu Lead di CRM). 1 Lead = 1 kode pelanggan; untuk beberapa titik buat beberapa Lead.</p></div>
          <ErrorMsg>{err}</ErrorMsg>
          <div className="flex gap-2"><button className="btn" disabled={busy} onClick={save}>Simpan</button><button className="btn-ghost" disabled={busy} onClick={() => setEdit(false)}>Batal</button></div>
        </div>
      )}
    </div>
  );
}
