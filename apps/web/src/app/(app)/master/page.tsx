'use client';
import { useState } from 'react';
import { api, doDelete, useFetch } from '@/lib/api';
import { promptDialog, toast } from '@/lib/dialog';
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
  const ask = async (label: string, def = '') => (await promptDialog(label, def))?.trim();
  const call = async (fn: () => Promise<unknown>) => { try { await fn(); await reload(); } catch (e) { toast.error((e as Error).message); } };
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

const vendorFields: Field[] = [
  { name: 'name', label: 'Nama vendor', type: 'text', required: true },
  { name: 'contactName', label: 'Nama kontak', type: 'text' },
  { name: 'phone', label: 'Telepon', type: 'text' },
  { name: 'email', label: 'Email', type: 'text' },
  { name: 'address', label: 'Alamat', type: 'textarea' },
  { name: 'notes', label: 'Catatan', type: 'text' },
];

function Vendors({ canManage }: { canManage: boolean }) {
  const { data, error, reload } = useFetch<any[]>('/vendors?all=1');
  const [edit, setEdit] = useState<any>(null);
  return (
    <>
      <p className="mb-3 text-sm text-slate-500">Vendor menjadi pilihan pada perbandingan harga di <b>Purchase Request</b> (minimal 2 vendor per baris) dan pada pencatatan PO dari Accurate. Vendor yang sudah dipakai tidak dihapus, cukup dinonaktifkan.</p>
      {canManage && <button className="btn mb-3" onClick={() => setEdit({})}>+ Tambah vendor</button>}
      <ErrorMsg>{error}</ErrorMsg>
      <Table head={['Vendor', 'Kontak', 'Telepon', 'Email', 'Status', '']}>
        {data?.map((v) => (
          <tr key={v.id}>
            <td className="td font-medium">{v.name}</td><td className="td">{v.contactName ?? '-'}</td><td className="td">{v.phone ?? '-'}</td><td className="td">{v.email ?? '-'}</td>
            <td className="td">{canManage ? <button onClick={async () => { await api(`/vendors/${v.id}`, { method: 'PATCH', body: { active: !v.active } }); reload(); }}><Badge tone={v.active ? 'green' : 'slate'}>{v.active ? 'Aktif' : 'Nonaktif'}</Badge></button> : <Badge tone={v.active ? 'green' : 'slate'}>{v.active ? 'Aktif' : 'Nonaktif'}</Badge>}</td>
            <td className="td whitespace-nowrap">{canManage && <><LinkBtn onClick={() => setEdit(v)}>Edit</LinkBtn> · <LinkBtn danger onClick={async () => { if (await doDelete(`/vendors/${v.id}`, `vendor ${v.name}`)) reload(); }}>Hapus</LinkBtn></>}</td>
          </tr>
        ))}
      </Table>
      {data?.length === 0 && <p className="mt-3 text-slate-400">Belum ada vendor.</p>}
      {edit && (
        <Modal title={edit.id ? `Edit vendor ${edit.name}` : 'Tambah vendor'} onClose={() => setEdit(null)}>
          <DynamicForm fields={vendorFields} initial={edit.id ? edit : undefined} sendEmpty={!!edit.id} submitLabel="Simpan"
            onSubmit={async (v) => { if (edit.id) await api(`/vendors/${edit.id}`, { method: 'PATCH', body: v }); else await api('/vendors', { body: v }); setEdit(null); await reload(); }} />
        </Modal>
      )}
    </>
  );
}

function Areas({ canManage }: { canManage: boolean }) {
  const { data, error, reload } = useFetch<any[]>('/areas?all=1');
  const { data: whs } = useFetch<any[]>('/warehouses');
  const [edit, setEdit] = useState<any>(null);
  return (
    <>
      <p className="mb-3 text-sm text-slate-500">Area layanan menggantikan istilah &quot;gudang / cabang&quot; pada pelanggan. Daftar area ditarik otomatis dari <b>MSRadius</b> (masterdata/area); di sini tiap area <b>dihubungkan ke gudang penyuplainya</b> agar cek stok pemasangan otomatis tahu gudang mana yang dipakai. Area manual juga dapat ditambahkan.</p>
      {canManage && <button className="btn mb-3" onClick={() => setEdit({})}>+ Tambah area manual</button>}
      <ErrorMsg>{error}</ErrorMsg>
      <Table head={['Area', 'Sumber', 'Gudang penyuplai', 'Pelanggan', 'Status', '']}>
        {data?.map((a) => (
          <tr key={a.id}>
            <td className="td font-medium">{a.name}{a.code && <span className="ml-2 text-xs text-slate-400">#{a.code}</span>}</td>
            <td className="td"><Badge tone={a.source === 'RADIUS' ? 'blue' : 'slate'}>{a.source === 'RADIUS' ? 'MSRadius' : 'Manual'}</Badge></td>
            <td className="td">{a.warehouse?.name ?? <span className="text-amber-600">belum dihubungkan</span>}</td>
            <td className="td">{a._count.customers}</td>
            <td className="td">{canManage ? <button onClick={async () => { await api(`/areas/${a.id}`, { method: 'PATCH', body: { active: !a.active } }); reload(); }}><Badge tone={a.active ? 'green' : 'slate'}>{a.active ? 'Aktif' : 'Nonaktif'}</Badge></button> : <Badge tone={a.active ? 'green' : 'slate'}>{a.active ? 'Aktif' : 'Nonaktif'}</Badge>}</td>
            <td className="td whitespace-nowrap">{canManage && <><LinkBtn onClick={() => setEdit(a)}>Edit</LinkBtn>{a.source !== 'RADIUS' && <> · <LinkBtn danger onClick={async () => { if (await doDelete(`/areas/${a.id}`, `area ${a.name}`)) reload(); }}>Hapus</LinkBtn></>}</>}</td>
          </tr>
        ))}
      </Table>
      {data?.length === 0 && <p className="mt-3 text-slate-400">Belum ada area — tarik data MSRadius (menu Pelanggan) atau tambah manual.</p>}
      {edit && (
        <Modal title={edit.id ? `Edit area ${edit.name}` : 'Tambah area'} onClose={() => setEdit(null)}>
          <AreaForm area={edit} whs={whs ?? []} onDone={async () => { setEdit(null); await reload(); }} />
        </Modal>
      )}
    </>
  );
}

function AreaForm({ area, whs, onDone }: { area: any; whs: any[]; onDone: () => void }) {
  const [name, setName] = useState<string>(area.name ?? '');
  const [wh, setWh] = useState<string>(area.warehouseId ?? area.warehouse?.id ?? '');
  const [err, setErr] = useState('');
  const save = async () => {
    setErr('');
    try {
      const body = { ...(area.source === 'RADIUS' ? {} : { name }), warehouseId: wh || null };
      if (area.id) await api(`/areas/${area.id}`, { method: 'PATCH', body }); else await api('/areas', { body });
      toast.success('Area disimpan'); onDone();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="space-y-3">
      <div><label className="mb-1 block text-sm font-medium">Nama area</label><input className="input" value={name} disabled={area.source === 'RADIUS'} onChange={(e) => setName(e.target.value)} />{area.source === 'RADIUS' && <p className="mt-0.5 text-xs text-slate-500">Nama dari MSRadius — diubah di MSRadius.</p>}</div>
      <div><label className="mb-1 block text-sm font-medium">Gudang penyuplai</label>
        <select className="input" value={wh} onChange={(e) => setWh(e.target.value)}><option value="">— belum dihubungkan —</option>{whs.filter((w) => w.kind === 'MAIN' || w.kind === 'BRANCH').map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
      <ErrorMsg>{err}</ErrorMsg>
      <button className="btn" onClick={save}>Simpan</button>
    </div>
  );
}

export default function Master() {
  const { user } = useAuth();
  const role = user?.role ?? '';
  const [tab, setTab] = useState(['GA'].includes(role) ? 'brands' : 'packages');
  if (!['ADMIN', 'MKT', 'GA'].includes(role)) return <ErrorMsg>Akses ditolak</ErrorMsg>;
  return (
    <>
      <PageHeader pretitle="Data" title="Master Data" sub="Paket/jasa langganan, area, merk & tipe perangkat, dan vendor" />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'packages', label: 'Paket / jasa' }, { key: 'areas', label: 'Area' }, { key: 'brands', label: 'Merk & tipe aset' }, { key: 'vendors', label: 'Vendor' }]} />
      {tab === 'packages' && <Packages canManage={['ADMIN', 'MKT'].includes(role)} />}
      {tab === 'areas' && <Areas canManage={['ADMIN', 'GA'].includes(role)} />}
      {tab === 'vendors' && <Vendors canManage={['ADMIN', 'GA'].includes(role)} />}
      {tab === 'brands' && <Brands canManage={['ADMIN', 'GA'].includes(role)} />}
    </>
  );
}
