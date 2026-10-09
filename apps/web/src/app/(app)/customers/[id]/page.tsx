'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, doDelete, fmtDate, TYPE_LABEL, useFetch } from '@/lib/api';
import { toast } from '@/lib/dialog';
import { useAuth } from '@/lib/auth';
import { DynamicForm } from '@/components/DynamicForm';
import { Badge, custTone, DataGrid, ErrorMsg, Modal, PageHeader, Table } from '@/components/ui';
import { customerFields, NETWORK_FIELDS } from '../page';

export default function CustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: c, error, reload } = useFetch<any>(`/customers/${id}`);
  const { user } = useAuth();
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const role = user?.role ?? '';
  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  if (!c) return <p className="text-slate-500">Memuat…</p>;
  return (
    <div className="space-y-4">
      <PageHeader pretitle="Pelanggan" title={`${c.name}`} sub={c.code}>
        <Badge tone={custTone(c.status)}>{c.status}</Badge>
        {['ADMIN', 'MKT'].includes(role) && <button className="btn-ghost" onClick={async () => { try { const r = await api<any>(`/customers/${c.id}/radius-pull`, { body: {} }); toast.success(`Data MSRadius ditarik (${r.updated ? 'diperbarui' : 'sudah sama'}).`); await reload(); } catch (e) { toast.error((e as Error).message); } }}>⟳ Tarik dari MSRadius</button>}
        {['ADMIN', 'MKT', 'NOC'].includes(role) && <button className="btn-ghost" onClick={() => setEdit(true)}>✎ Edit</button>}
        {['ADMIN', 'MKT'].includes(role) && <button className="btn-ghost !border-red-300 !text-red-600 hover:!bg-red-50" onClick={async () => { if (await doDelete(`/customers/${c.id}`, `pelanggan ${c.name}`)) router.replace('/customers'); }}>🗑 Hapus</button>}
      </PageHeader>
      {role === 'ADMIN' && c.source === 'RADIUS' && <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">Data pelanggan ini bersumber dari <b>MSRadius</b> (hanya dibaca): nama, telepon, alamat, dan paket diubah di MSRadius lalu ditarik ke sini{c.syncedAt ? ` (terakhir ${fmtDate(c.syncedAt)})` : ''}.{c.missingFromApi ? <b className="text-red-700"> Pelanggan ini sudah tidak ditemukan di MSRadius pada sinkron terakhir.</b> : ''}</p>}
      {role === 'ADMIN' && c.source !== 'RADIUS' && <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">Pelanggan input manual. Setelah akunnya dibuat di MSRadius dengan kode <b>{c.code}</b>, tekan <b>Tarik dari MSRadius</b> agar data tersinkron.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card">
          <div className="card-header"><h2 className="font-semibold">Kontak & layanan</h2></div>
          <DataGrid items={[
            { label: 'Telepon', value: c.phone }, { label: 'Email', value: c.email },
            { label: 'Alamat', value: <>{c.address}{c.lat != null && <> · <a className="text-brand-700 hover:underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${c.lat},${c.lng}`}>Buka peta</a></>}</> },
            { label: 'Paket', value: c.packageName }, { label: 'Area', value: c.area ? `${c.area.name}${c.warehouse ? ` · gudang ${c.warehouse.name}` : ''}` : '-' },
          ]} />
        </div>
        <div className="card">
          <div className="card-header"><h2 className="font-semibold">Jaringan</h2></div>
          <DataGrid items={[
            { label: 'ODP / Port', value: `${c.odp ?? '-'} / ${c.port ?? '-'}` }, { label: 'VLAN', value: c.vlan },
            { label: 'IP', value: <span className="font-mono">{c.ip ?? '-'}</span> }, ...(c.radiusIp ? [{ label: 'IP dari MSRadius', value: <span className="font-mono">{c.radiusIp}</span> }] : []), ...(c.expiredAt ? [{ label: 'Jatuh tempo (MSRadius)', value: fmtDate(c.expiredAt) }] : []), ...(c.publicIp ? [{ label: 'IP Publik', value: <span className="font-mono">{c.publicIp}</span> }] : []), { label: 'Aktif sejak', value: fmtDate(c.activatedAt) },
          ]} />
        </div>
      </div>
      <section>
        <h2 className="mb-2 font-semibold">Perangkat milik ISP di lokasi pelanggan</h2>
        <Table head={['Item', 'Serial Number', 'Status']} empty="Belum ada perangkat terpasang">
          {c.assets.map((a: any) => <tr key={a.id}><td className="td">{a.item.name}</td><td className="td font-mono">{a.serialNumber}</td><td className="td"><Badge>{a.status}</Badge></td></tr>)}
        </Table>
      </section>
      <section>
        <h2 className="mb-2 font-semibold">Riwayat WO</h2>
        <Table head={['No. WO', 'Jenis', 'Judul', 'Status', 'Dibuat']}>
          {c.workOrders.map((w: any) => (
            <tr key={w.id}>
              <td className="td"><Link className="text-brand-700 hover:underline" href={`/work-orders/${w.id}`}>{w.number}</Link></td>
              <td className="td">{TYPE_LABEL[w.type]}</td><td className="td">{w.title}</td><td className="td">{w.status}</td><td className="td">{fmtDate(w.createdAt)}</td>
            </tr>
          ))}
        </Table>
      </section>
      {edit && (
        <Modal title={`Edit pelanggan ${c.code}`} onClose={() => setEdit(false)}>
          <DynamicForm fields={customerFields(['ADMIN', 'NOC'].includes(role), true).filter((f) => (role !== 'NOC' || NETWORK_FIELDS.includes(f.name)) && (c.source !== 'RADIUS' || !['name', 'phone', 'address', 'packageName', 'code'].includes(f.name)))} initial={c} sendEmpty submitLabel="Simpan perubahan" onSubmit={async (v) => { await api(`/customers/${c.id}`, { method: 'PATCH', body: v }); setEdit(false); await reload(); }} />
        </Modal>
      )}
    </div>
  );
}
