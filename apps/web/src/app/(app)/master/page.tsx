'use client';
import { useState } from 'react';
import { api, doDelete, useFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DynamicForm, Field } from '@/components/DynamicForm';
import { Badge, ErrorMsg, LinkBtn, Modal, PageHeader, Table, Tabs } from '@/components/ui';

const pkgFields: Field[] = [
  { name: 'name', label: 'Nama paket / jasa', type: 'text', required: true, help: 'mis. Home 30 Mbps, Dedicated 100 Mbps, Sewa Router' },
  { name: 'description', label: 'Keterangan', type: 'text' },
  { name: 'sortOrder', label: 'Urutan tampil (kecil = atas)', type: 'number' },
];

function Packages({ canManage }: { canManage: boolean }) {
  const { data, error, reload } = useFetch<any[]>('/packages?all=1');
  const [edit, setEdit] = useState<any>(null); // {} = baru
  return (
    <>
      <p className="mb-3 text-sm text-slate-500">Daftar ini menjadi pilihan <b>Paket langganan</b> di WO Pasang Baru dan form pelanggan. Menonaktifkan paket menyembunyikannya dari pilihan baru tanpa mengubah pelanggan yang sudah memakainya; mengganti nama ikut memperbarui pelanggan.</p>
      {canManage && <button className="btn mb-3" onClick={() => setEdit({})}>+ Tambah paket</button>}
      <ErrorMsg>{error}</ErrorMsg>
      <Table head={['Paket / jasa', 'Keterangan', 'Urutan', 'Pelanggan', 'Status', '']}>
        {data?.map((p) => (
          <tr key={p.id}>
            <td className="td font-medium">{p.name}</td><td className="td text-slate-500">{p.description ?? '-'}</td><td className="td">{p.sortOrder}</td><td className="td">{p.customers}</td>
            <td className="td">{canManage ? <button onClick={async () => { await api(`/packages/${p.id}`, { method: 'PATCH', body: { active: !p.active } }); reload(); }}><Badge tone={p.active ? 'green' : 'slate'}>{p.active ? 'Aktif' : 'Nonaktif'}</Badge></button> : <Badge tone={p.active ? 'green' : 'slate'}>{p.active ? 'Aktif' : 'Nonaktif'}</Badge>}</td>
            <td className="td whitespace-nowrap">{canManage && <><LinkBtn onClick={() => setEdit(p)}>Edit</LinkBtn> · <LinkBtn danger onClick={async () => { if (await doDelete(`/packages/${p.id}`, `paket ${p.name}`)) reload(); }}>Hapus</LinkBtn></>}</td>
          </tr>
        ))}
      </Table>
      {edit && (
        <Modal title={edit.id ? `Edit paket ${edit.name}` : 'Tambah paket'} onClose={() => setEdit(null)}>
          <DynamicForm fields={pkgFields} initial={edit.id ? edit : { sortOrder: 0 }} sendEmpty={!!edit.id} submitLabel="Simpan"
            onSubmit={async (v) => { if (edit.id) await api(`/packages/${edit.id}`, { method: 'PATCH', body: v }); else await api('/packages', { body: v }); setEdit(null); await reload(); }} />
        </Modal>
      )}
    </>
  );
}

function Brands({ canManage }: { canManage: boolean }) {
  const { data, error, reload } = useFetch<any[]>('/asset-brands');
  const ask = async (label: string, def = '') => window.prompt(label, def)?.trim();
  const call = async (fn: () => Promise<unknown>) => { try { await fn(); await reload(); } catch (e) { window.alert((e as Error).message); } };
  return (
    <>
      <p className="mb-3 text-sm text-slate-500">Pilihan <b>merk</b> dan <b>tipe/model</b> saat registrasi aset. Merk/tipe yang sudah dipakai aset tidak bisa dihapus.</p>
      {canManage && <button className="btn mb-3" onClick={async () => { const n = await ask('Nama merk baru:'); if (n) call(() => api('/asset-brands', { body: { name: n } })); }}>+ Tambah merk</button>}
      <ErrorMsg>{error}</ErrorMsg>
      <div className="grid gap-3 md:grid-cols-2">
        {data?.map((b) => (
          <div key={b.id} className="card">
            <div className="flex items-center justify-between"><div className="font-semibold">{b.name} <span className="text-xs font-normal text-slate-500">· {b._count.assets} aset</span></div>
              {canManage && <div className="space-x-2"><LinkBtn onClick={async () => { const n = await ask('Ganti nama merk:', b.name); if (n && n !== b.name) call(() => api(`/asset-brands/${b.id}`, { method: 'PATCH', body: { name: n } })); }}>Edit</LinkBtn><LinkBtn danger onClick={async () => { if (await doDelete(`/asset-brands/${b.id}`, `merk ${b.name}`)) reload(); }}>Hapus</LinkBtn></div>}</div>
            <ul className="mt-2 space-y-1 text-sm">
              {b.models.map((m: any) => (
                <li key={m.id} className="flex items-center justify-between rounded bg-slate-50 px-2 py-1">{m.name}
                  {canManage && <span className="space-x-2"><LinkBtn onClick={async () => { const n = await ask('Ganti nama tipe:', m.name); if (n && n !== m.name) call(() => api(`/asset-models/${m.id}`, { method: 'PATCH', body: { name: n } })); }}>Edit</LinkBtn><LinkBtn danger onClick={async () => { if (await doDelete(`/asset-models/${m.id}`, `tipe ${m.name}`)) reload(); }}>Hapus</LinkBtn></span>}</li>
              ))}
              {b.models.length === 0 && <li className="text-slate-400">Belum ada tipe</li>}
            </ul>
            {canManage && <button className="btn-ghost mt-2" onClick={async () => { const n = await ask(`Tipe baru untuk ${b.name}:`); if (n) call(() => api(`/asset-brands/${b.id}/models`, { body: { name: n } })); }}>+ Tipe</button>}
          </div>
        ))}
        {data?.length === 0 && <p className="text-slate-400">Belum ada merk. Tambahkan, mis. Huawei, ZTE, Mikrotik, TP-Link.</p>}
      </div>
    </>
  );
}

export default function Master() {
  const { user } = useAuth();
  const role = user?.role ?? '';
  const [tab, setTab] = useState(['GA'].includes(role) ? 'brands' : 'packages');
  if (!['ADMIN', 'MKT', 'NOC', 'GA'].includes(role)) return <ErrorMsg>Akses ditolak</ErrorMsg>;
  return (
    <>
      <PageHeader title="Master Data" sub="Paket/jasa langganan dan merk & tipe perangkat" />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'packages', label: 'Paket / jasa' }, { key: 'brands', label: 'Merk & tipe aset' }]} />
      {tab === 'packages' && <Packages canManage={['ADMIN', 'MKT', 'NOC'].includes(role)} />}
      {tab === 'brands' && <Brands canManage={['ADMIN', 'GA'].includes(role)} />}
    </>
  );
}
