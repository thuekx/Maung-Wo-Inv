'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { API, api, download, getToken, useFetch } from '@/lib/api';
import { Column, DataTable } from '@/components/DataTable';
import { useAuth } from '@/lib/auth';
import { DynamicForm, Field } from '@/components/DynamicForm';
import { Badge, custTone, ErrorMsg, Modal, PageHeader, Table } from '@/components/ui';

export const CUSTOMER_STATUS = ['ACTIVE', 'SUSPENDED', 'TERMINATED', 'PROSPECT', 'INSTALLING', 'TERMINATING'];

export const customerFields = (canStatus: boolean, withCode = true): Field[] => [
  ...(withCode ? [{ name: 'code', label: 'Kode pelanggan (kosongkan = otomatis)', type: 'text', help: 'Isi bila memakai ID pelanggan yang sudah ada' }] : []),
  { name: 'name', label: 'Nama pelanggan', type: 'text', required: true },
  { name: 'phone', label: 'Telepon / WA', type: 'text', required: true },
  { name: 'email', label: 'Email', type: 'text' },
  { name: 'address', label: 'Alamat', type: 'textarea', required: true },
  { name: 'lat', label: 'Latitude', type: 'number' },
  { name: 'lng', label: 'Longitude', type: 'number' },
  { name: 'packageName', label: 'Paket langganan', type: 'package', required: true },
  ...(canStatus ? [{ name: 'status', label: 'Status', type: 'select', options: CUSTOMER_STATUS, required: true }] : []),
  { name: 'warehouseId', label: 'Gudang / cabang terkait', type: 'warehouse' },
  { name: 'odp', label: 'ODP / Node', type: 'text' },
  { name: 'port', label: 'Port ODP', type: 'text' },
  { name: 'vlan', label: 'VLAN', type: 'text' },
  { name: 'ip', label: 'IP / Subnet', type: 'text' },
];

function ImportPanel({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const file = useRef<File | null>(null);
  const [name, setName] = useState('');
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);

  const send = async (dry: boolean) => {
    if (!file.current) return setErr('Pilih file dulu');
    setBusy(true); setErr('');
    try {
      const fd = new FormData(); fd.append('file', file.current);
      const r = await fetch(`${API}/api/customers/import${dry ? '?dryRun=1' : ''}`, { method: 'POST', headers: { authorization: `Bearer ${getToken()}` }, body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? 'Gagal');
      if (dry) setRes(j); else { setDone(j); onDone(); }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal title="Impor pelanggan dari Excel" onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <p className="text-slate-500">Untuk memasukkan data pelanggan yang sudah ada (sebelum terhubung ke MSRadius). Baris dengan <b>Kode</b> yang sudah ada diperbarui; tanpa kode dicocokkan lewat Nama + Telepon; selain itu dibuat baru. Paket yang belum ada otomatis masuk Master Paket.</p>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost" onClick={() => download('/customers/import-template.xlsx', 'template-impor-pelanggan.xlsx').catch((e) => setErr(e.message))}>⬇ Unduh template (.xlsx)</button>
          <input type="file" accept=".xlsx,.csv" onChange={(e) => { file.current = e.target.files?.[0] ?? null; setName(file.current?.name ?? ''); setRes(null); setDone(null); }} />
        </div>
        <ErrorMsg>{err}</ErrorMsg>
        {name && !done && <button className="btn" disabled={busy} onClick={() => send(true)}>{busy ? 'Memeriksa…' : '1. Periksa file (pratinjau)'}</button>}
        {res && !done && (
          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex flex-wrap gap-2"><Badge tone="slate">{res.total} baris</Badge><Badge tone="green">{res.create} baru</Badge><Badge tone="blue">{res.update} diperbarui</Badge><Badge tone={res.errorCount ? 'red' : 'green'}>{res.errorCount} error</Badge></div>
            {res.newPackages.length > 0 && <p>Paket baru yang akan dibuat: <b>{res.newPackages.join(', ')}</b></p>}
            <Table head={['Baris', 'Aksi', 'Kode', 'Nama', 'Telepon', 'Paket', 'Status']}>
              {res.preview.map((p: any) => <tr key={p.row}><td className="td">{p.row}</td><td className="td"><Badge tone={p.action === 'create' ? 'green' : 'blue'}>{p.action}</Badge></td><td className="td font-mono text-xs">{p.code}</td><td className="td">{p.name}</td><td className="td">{p.phone}</td><td className="td">{p.packageName}</td><td className="td">{p.status}</td></tr>)}
            </Table>
            {res.errors.length > 0 && <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-red-700">{res.errors.map((e: any) => <li key={e.row}>Baris {e.row}: {e.message}</li>)}</ul>}
            {res.create + res.update > 0 && <button className="btn" disabled={busy} onClick={() => send(false)}>{busy ? 'Menyimpan…' : `2. Impor ${res.create + res.update} baris valid${res.errorCount ? ` (lewati ${res.errorCount} error)` : ''}`}</button>}
          </div>
        )}
        {done && <p className="rounded-lg bg-green-50 px-3 py-2 text-green-700">Selesai: {done.create} baru, {done.update} diperbarui, {done.errorCount} dilewati.</p>}
      </div>
    </Modal>
  );
}

export default function Customers() {
  const { user } = useAuth();
  const [status, setStatus] = useState('');
  const [pkg, setPkg] = useState('');
  const [add, setAdd] = useState(false);
  const [imp, setImp] = useState(false);
  const [err, setErr] = useState('');
  const [rk, setRk] = useState(0);
  const { data: pkgs } = useFetch<any[]>('/packages?all=1');
  const role = user?.role ?? '';
  const canEdit = ['ADMIN', 'MKT', 'NOC'].includes(role);
  const canExport = ['ADMIN', 'MKT', 'NOC', 'FIN', 'GA'].includes(role);
  const cols: Column<any>[] = [
    { key: 'code', header: 'Kode', sort: 'code', render: (c) => <Link className="font-medium text-brand-700 hover:underline" href={`/customers/${c.id}`}>{c.code}</Link> },
    { key: 'name', header: 'Nama', sort: 'name' },
    { key: 'phone', header: 'Telepon', sort: 'phone' },
    { key: 'packageName', header: 'Paket', sort: 'packageName' },
    { key: 'ip', header: 'IP', sort: 'ip', className: 'font-mono text-xs', render: (c) => c.ip ?? '-' },
    { key: 'status', header: 'Status', sort: 'status', render: (c) => <Badge tone={custTone(c.status)}>{c.status}</Badge> },
  ];
  const exportQs = new URLSearchParams({ ...(status ? { status } : {}) }).toString();
  return (
    <>
      <PageHeader title="Pelanggan" sub="Pelanggan baru lewat WO Pasang Baru, atau input manual / impor Excel untuk data yang sudah ada">
        {canEdit && <button className="btn" onClick={() => setAdd(true)}>+ Tambah pelanggan</button>}
        {canEdit && <button className="btn-ghost" onClick={() => setImp(true)}>⬆ Impor Excel</button>}
        {canExport && <button className="btn-ghost" onClick={() => download(`/customers/export.xlsx${exportQs ? `?${exportQs}` : ''}`, 'pelanggan.xlsx').catch((e) => setErr(e.message))}>⬇ Ekspor Excel</button>}
      </PageHeader>
      <ErrorMsg>{err}</ErrorMsg>
      <DataTable<any> path="/customers" columns={cols} params={{ status, packageName: pkg }} defaultSort="createdAt" refreshKey={rk}
        searchPlaceholder="Cari nama / kode / telepon / IP…" empty="Belum ada pelanggan — tambah manual atau impor dari Excel"
        filters={<>
          <select className="input w-44" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Semua status</option>{CUSTOMER_STATUS.map((s) => <option key={s}>{s}</option>)}</select>
          <select className="input w-52" value={pkg} onChange={(e) => setPkg(e.target.value)} aria-label="Paket"><option value="">Semua paket</option>{pkgs?.map((p) => <option key={p.id}>{p.name}</option>)}</select>
        </>} />
      {add && (
        <Modal title="Tambah pelanggan (input manual)" onClose={() => setAdd(false)}>
          <DynamicForm fields={customerFields(true)} initial={{ status: 'ACTIVE' }} submitLabel="Simpan pelanggan" onSubmit={async (v) => { await api('/customers', { body: v }); setAdd(false); setRk((x) => x + 1); }} />
        </Modal>
      )}
      {imp && <ImportPanel onDone={() => setRk((x) => x + 1)} onClose={() => setImp(false)} />}
    </>
  );
}
