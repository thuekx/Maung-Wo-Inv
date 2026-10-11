'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { confirmDialog, toast } from '@/lib/dialog';
import { QRCodeSVG } from 'qrcode.react';
import { api, assetQr, doDelete, fmtDate, useFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DynamicForm, Field } from '@/components/DynamicForm';
import { Column, DataTable } from '@/components/DataTable';
import { Badge, ErrorMsg, LinkBtn, Modal, PageHeader, Table, Tabs } from '@/components/ui';
import { Select } from '@/components/Select';

const CAT: Record<string, string> = { CONSUMABLE: 'Material Habis Pakai', NETWORK: 'Perangkat Jaringan', GA: 'Aset General (GA)' };
const ST_TONE: Record<string, any> = { IN_STOCK: 'green', REFURBISHED: 'green', INSTALLED: 'blue', IN_USE: 'blue', RETURNED_PENDING_QC: 'amber', DAMAGED: 'red', SCRAP: 'red', QTY: 'slate' };

/* ───── Stok ───── */
function StockTab() {
  const [wh, setWh] = useState('');
  const { data: whs } = useFetch<any[]>('/warehouses?all=1');
  const { data, error } = useFetch<any[]>(`/stock${wh ? `?warehouseId=${wh}` : ''}`);
  return (
    <>
      <Select className="input mb-3 max-w-xs" value={wh} onChange={(e) => setWh(e.target.value)}>
        <option value="">Semua gudang (termasuk stok berjalan)</option>
        {whs?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </Select>
      <ErrorMsg>{error}</ErrorMsg>
      <Table head={['Gudang', 'Item', 'Kategori', 'Status', 'Qty']}>
        {data?.map((r, i) => (
          <tr key={i}>
            <td className="td">{r.warehouse.name} <span className="text-xs text-slate-400">{KIND[r.warehouse.kind] ?? r.warehouse.kind}</span></td>
            <td className="td">{r.item.name}</td>
            <td className="td text-xs text-slate-500">{CAT[r.item.category]}</td>
            <td className="td"><Badge tone={ST_TONE[r.status]}>{r.status === 'QTY' ? 'Stok' : r.status}</Badge></td>
            <td className="td font-semibold">{r.qty} {r.item.tracked ? 'unit' : r.item.unit}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}

/* ───── Aset & SN ───── */
function QrModal({ asset, onClose }: { asset: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-72 text-center" onClick={(e) => e.stopPropagation()}>
        <div className="print-area mx-auto w-fit p-2">
          <QRCodeSVG value={assetQr(asset.serialNumber)} size={180} />
          <div className="mt-2 font-mono text-sm font-bold">{asset.serialNumber}</div>
          <div className="text-xs">{asset.item.name}{asset.assetCode ? ` · ${asset.assetCode}` : ''}</div>
        </div>
        <div className="mt-3 flex justify-center gap-2">
          <button className="btn" onClick={() => window.print()}>Cetak label</button>
          <button className="btn-ghost" onClick={onClose}>Tutup</button>
        </div>
      </div>
    </div>
  );
}

function AssetsTab({ canManage, initialQ = '' }: { canManage: boolean; initialQ?: string }) {
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [qr, setQr] = useState<any>(null);
  const [showReg, setShowReg] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [rk, setRk] = useState(0);
  const reload = async () => setRk((x) => x + 1);
  const [busyAll, setBusyAll] = useState(false);
  const { data: items } = useFetch<any[]>(canManage ? '/items' : null);
  const [regItem, setRegItem] = useState('');
  const sel1 = items?.find((i) => i.id === regItem);
  const selectAllResults = async (q: string) => {
    setBusyAll(true);
    try {
      const p = new URLSearchParams({ idsOnly: '1', ...(q ? { q } : {}), ...(status ? { status } : {}), ...(category ? { category } : {}) });
      const r = await api<{ ids: string[]; capped: boolean }>(`/assets?${p}`);
      setSel(r.ids);
      if (r.capped) toast.info('Dibatasi 5.000 aset pertama. Persempit filter untuk memilih sisanya.');
    } finally { setBusyAll(false); }
  };
  const cols: Column<any>[] = [
    { key: 'serialNumber', header: 'Serial / Kode', sort: 'serialNumber', className: 'font-mono', render: (a) => <>{a.serialNumber}{a.assetCode && a.assetCode !== a.serialNumber && <div className="text-xs text-slate-500">{a.assetCode}</div>}</> },
    { key: 'item', header: 'Item', sort: 'item', render: (a) => <>{a.item.name}{a.plateNumber && <div className="text-xs text-slate-500">{a.plateNumber}{a.chassisNumber ? ` · Rangka ${a.chassisNumber}` : ''}</div>}</> },
    { key: 'brand', header: 'Merk / tipe', className: 'text-sm', render: (a) => [a.brand?.name, a.model?.name].filter(Boolean).join(' · ') || <span className="text-slate-400">-</span> },
    { key: 'status', header: 'Status', sort: 'status', render: (a) => <Badge tone={ST_TONE[a.status]}>{a.status}</Badge> },
    { key: 'loc', header: 'Lokasi', render: (a) => (a.customer ? `Pelanggan: ${a.customer.name}` : a.warehouse?.name ?? '-') },
    { key: 'maint', header: 'Maintenance', sort: 'nextMaintenanceAt', render: (a) => (a.needsMaintenance ? (a.nextMaintenanceAt ? new Date(a.nextMaintenanceAt).toLocaleDateString('id-ID') : <span className="text-amber-600">Perlu — belum dijadwalkan</span>) : '-') },
    { key: 'act', header: '', className: 'whitespace-nowrap', render: (a) => <><LinkBtn onClick={() => setQr(a)}>QR</LinkBtn>{canManage && <><LinkBtn onClick={() => setEdit(a)}>Edit</LinkBtn><LinkBtn danger onClick={async () => { if (await doDelete(`/assets/${a.id}`, `aset ${a.serialNumber}`)) { setSel((x) => x.filter((i) => i !== a.id)); reload(); } }}>Hapus</LinkBtn></>}</> },
  ];
  const printSel = (ids: string[]) => { try { sessionStorage.setItem('qr_print_ids', JSON.stringify(ids)); } catch { /* ignore */ } window.open('/qr-print', '_blank'); };

  const regFields: Field[] = [
    { name: 'warehouseId', label: 'Gudang', type: 'warehouse', required: true },
    { name: 'brandmodel', label: 'Merk & tipe', type: 'brandmodel' },
    ...(sel1?.category === 'GA'
      ? [
          ...(sel1?.isVehicle
            ? [
                { name: 'plateNumber', label: 'Plat nomor', type: 'text', required: true, help: 'Mis. D 1234 ABC (maks. 15 karakter)' },
                { name: 'chassisNumber', label: 'No. rangka', type: 'text', help: 'Maks. 30 karakter' },
              ]
            : [{ name: 'count', label: 'Jumlah unit (kode aset dibuat otomatis)', type: 'number' }]),
          { name: 'status', label: 'Status', type: 'select', options: ['IN_STOCK', 'IN_USE'] },
        ]
      : [{ name: 'serials', label: 'Serial number (scan / ketik, bisa banyak)', type: 'serials', required: true }]),
    { name: 'needsMaintenance', label: 'Perlu perawatan berkala?', type: 'bool', help: 'Bila Ya, aset muncul di dasbor "perlu perawatan" saat jadwalnya dekat/lewat' },
    { name: 'maintenanceIntervalDays', label: 'Interval perawatan (hari)', type: 'number', help: 'Mis. 90. Jadwal pertama = hari ini + interval, bila jadwal di bawah kosong' },
    { name: 'nextMaintenanceAt', label: 'Jadwal perawatan berikutnya (opsional)', type: 'datetime' },
    { name: 'notes', label: 'Catatan', type: 'textarea' },
  ];
  const editFields: Field[] = [
    { name: 'serialNumber', label: 'Serial number', type: 'text', required: true },
    { name: 'brandmodel', label: 'Merk & tipe', type: 'brandmodel' },
    { name: 'status', label: 'Status', type: 'select', options: ['IN_STOCK', 'IN_USE', 'DAMAGED', 'SCRAP'], help: 'Status INSTALLED/QC diatur otomatis oleh WO' },
    { name: 'warehouseId', label: 'Gudang', type: 'warehouse' },
    ...(edit?.item?.isVehicle ? [{ name: 'plateNumber', label: 'Plat nomor', type: 'text' }, { name: 'chassisNumber', label: 'No. rangka', type: 'text' }] : []),
    { name: 'needsMaintenance', label: 'Perlu perawatan berkala?', type: 'bool' },
    { name: 'maintenanceIntervalDays', label: 'Interval perawatan (hari)', type: 'number' },
    { name: 'nextMaintenanceAt', label: 'Maintenance berikutnya', type: 'datetime' },
    { name: 'condition', label: 'Kondisi', type: 'text' },
    { name: 'notes', label: 'Catatan', type: 'textarea' },
  ];

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        {canManage && <button className="btn" onClick={() => setShowReg(!showReg)}>+ Registrasi aset</button>}
        <button className="btn-ghost" disabled={!sel.length} onClick={() => printSel(sel)}>🖨 Cetak QR terpilih ({sel.length}) — A4</button>
      </div>

      {showReg && (
        <div className="card mb-4 max-w-2xl space-y-3">
          <Select className="input" value={regItem} onChange={(e) => setRegItem(e.target.value)}>
            <option value="">— pilih item (ber-SN / aset GA) —</option>
            {items?.filter((i) => i.tracked).map((i) => <option key={i.id} value={i.id}>{i.name} · {CAT[i.category]}</option>)}
          </Select>
          {regItem && (
            <DynamicForm key={regItem} fields={regFields} submitLabel="Simpan & buat QR"
              onSubmit={async (v) => { const r = await api<any[]>('/assets/register', { body: { itemId: regItem, ...v } }); setShowReg(false); await reload(); toast.success(`${r.length} aset terdaftar.`); if (await confirmDialog('Cetak label QR sekarang (lembar A4)?')) printSel(r.map((a) => a.id)); }} />
          )}
        </div>
      )}

      <DataTable<any> path="/assets" initialQ={initialQ} columns={cols} params={{ status, category }} defaultSort="createdAt" refreshKey={rk} searchPlaceholder="Cari SN / kode aset / item / merk…"
        selectable selected={sel} onSelectedChange={setSel}
        filters={<>
          <Select className="input w-48" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Kategori"><option value="">Semua kategori</option><option value="NETWORK">Perangkat Jaringan</option><option value="GA">Aset GA</option></Select>
          <Select className="input w-52" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Semua status</option>{['IN_STOCK', 'INSTALLED', 'IN_USE', 'RETURNED_PENDING_QC', 'REFURBISHED', 'DAMAGED', 'SCRAP'].map((s) => <option key={s}>{s}</option>)}</Select>
        </>}
        selectionBar={({ total, q }) => (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button className="btn-ghost" disabled={busyAll || !total} onClick={() => selectAllResults(q)}>{busyAll ? 'Memuat…' : `Pilih semua ${total.toLocaleString('id-ID')} hasil (lintas halaman)`}</button>
            {sel.length > 0 && <><span className="text-slate-500">{sel.length.toLocaleString('id-ID')} terpilih</span><button className="text-slate-500 hover:underline" onClick={() => setSel([])}>Kosongkan</button></>}
            <span className="text-xs text-slate-400">Cetak massal memuat ukuran label A4 yang bisa dipilih.</span>
          </div>
        )} />
      {qr && <QrModal asset={qr} onClose={() => setQr(null)} />}
      {edit && (
        <Modal title={`Edit aset ${edit.serialNumber}`} onClose={() => setEdit(null)}>
          <DynamicForm fields={editFields} initial={{ ...edit, brandmodel: undefined }} sendEmpty submitLabel="Simpan perubahan"
            onSubmit={async (v) => {
              const { brandId, modelId, ...rest } = v;
              for (const k of ['status', 'warehouseId', 'serialNumber']) if (!rest[k]) delete rest[k]; // tidak boleh kosong; status otomatis WO dibiarkan
              await api(`/assets/${edit.id}`, { method: 'PATCH', body: { ...rest, brandId: brandId ?? null, modelId: modelId ?? null } });
              setEdit(null); await reload();
            }} />
        </Modal>
      )}
    </>
  );
}

/* ───── QC ───── */
function QcTab({ canManage }: { canManage: boolean }) {
  const [n, setN] = useState(0);
  const { data } = useFetch<any[]>(`/assets/pending-qc?${n}`);
  if (!data) return <p className="text-slate-500">Memuat…</p>;
  if (!data.length) return <p className="text-slate-500">Tidak ada aset yang menunggu QC.</p>;
  return (
    <div className="card max-w-3xl">
      <p className="mb-3 text-sm text-slate-500">Aset hasil penarikan / penggantian. Baik → Refurbished (siap pakai). Rusak → Damaged/Scrap untuk klaim garansi atau pemutihan.</p>
      {canManage ? (
        <DynamicForm key={n} fields={[{ name: 'results', label: 'Hasil QC', type: 'qc', required: true }]} submitLabel="Simpan hasil QC"
          onSubmit={async (v) => { await api('/assets/qc', { body: v }); setN(n + 1); }} />
      ) : <p className="text-sm">Hanya GA/Procurement yang dapat melakukan QC.</p>}
    </div>
  );
}

/* ───── Gudang ───── */
function WarehousesTab({ canManage }: { canManage: boolean }) {
  const { data, reload } = useFetch<any[]>('/warehouses?all=1');
  const [edit, setEdit] = useState<any>(null); // {} = baru
  const fields: Field[] = [
    { name: 'code', label: 'Kode', type: 'text', required: true },
    { name: 'name', label: 'Nama gudang', type: 'text', required: true },
    { name: 'kind', label: 'Jenis', type: 'select', options: edit?.id ? ['MAIN', 'BRANCH', 'TRANSIT'] : ['MAIN', 'BRANCH', 'TRANSIT', 'MOBILE'], help: 'MOBILE = Stok berjalan (stok yang dibawa teknisi)', required: true },
    { name: 'address', label: 'Alamat', type: 'textarea' },
  ];
  return (
    <>
      {canManage && <button className="btn mb-3" onClick={() => setEdit({})}>+ Tambah gudang</button>}
      <Table head={['Kode', 'Nama', 'Jenis', 'Pemilik', 'Aktif', '']}>
        {data?.map((w) => (
          <tr key={w.id}><td className="td font-mono">{w.code}</td><td className="td">{w.name}</td><td className="td"><Badge>{KIND[w.kind] ?? w.kind}</Badge></td><td className="td">{w.owner?.name ?? '-'}</td>
            <td className="td">{canManage ? <button className="btn-ghost !px-2.5 !py-1 !text-xs !text-brand-700" onClick={async () => { await api(`/warehouses/${w.id}`, { method: 'PATCH', body: { active: !w.active } }); reload(); }}>{w.active ? 'Aktif' : 'Nonaktif'}</button> : w.active ? 'Ya' : 'Tidak'}</td>
            <td className="td whitespace-nowrap">{canManage && <>{w.kind !== 'MOBILE' && <LinkBtn onClick={() => setEdit(w)}>Edit</LinkBtn>}<LinkBtn danger onClick={async () => { if (await doDelete(`/warehouses/${w.id}`, `gudang ${w.name}`)) reload(); }}>Hapus</LinkBtn></>}</td></tr>
        ))}
      </Table>
      {edit && (
        <Modal title={edit.id ? `Edit gudang ${edit.code}` : 'Tambah gudang'} onClose={() => setEdit(null)}>
          <DynamicForm fields={fields} initial={edit.id ? edit : undefined} sendEmpty={!!edit.id} submitLabel="Simpan"
            onSubmit={async (v) => { if (edit.id) await api(`/warehouses/${edit.id}`, { method: 'PATCH', body: v }); else await api('/warehouses', { body: v }); setEdit(null); await reload(); }} />
        </Modal>
      )}
    </>
  );
}

/* ───── Item ───── */
function ItemsTab({ canManage }: { canManage: boolean }) {
  const { data, reload } = useFetch<any[]>('/items');
  const [edit, setEdit] = useState<any>(null); // {} = baru
  const fields: Field[] = [
    { name: 'sku', label: 'SKU', type: 'text', required: true },
    { name: 'name', label: 'Nama item', type: 'text', required: true },
    ...(edit?.id ? [] : [{ name: 'category', label: 'Kategori', type: 'select', options: ['CONSUMABLE', 'NETWORK', 'GA'], required: true, help: 'CONSUMABLE = qty/meter · NETWORK = wajib serial number · GA = kode aset + maintenance' }]),
    { name: 'unit', label: 'Satuan', type: 'text', help: 'pcs / meter / unit (kabel otomatis "meter")' },
    { name: 'coreCount', label: 'Jumlah core (khusus kabel)', type: 'number', help: 'Isi untuk item kabel (mis. 1, 2, 4, 12). Kabel dihitung per meter dan harus diminta/diambil teknisi dulu' },
    ...(edit?.id ? [] : [{ name: 'isVehicle', label: 'Kendaraan?', type: 'bool', help: 'Hanya kategori GA: form aset menampilkan plat nomor & no. rangka' }]),
    { name: 'installDefaultQty', label: 'Kebutuhan standar per pasang baru (untuk cek stok otomatis)', type: 'number' },
    { name: 'minStock', label: 'Stok minimum (alert dashboard)', type: 'number' },
  ];
  return (
    <>
      {canManage && <button className="btn mb-3" onClick={() => setEdit({})}>+ Tambah item</button>}
      <Table head={['SKU', 'Nama', 'Kategori', 'Satuan', 'Std. pasang baru', 'Min. stok', '']}>
        {data?.map((i) => (
          <tr key={i.id}><td className="td font-mono">{i.sku}</td><td className="td">{i.name}</td><td className="td text-xs">{CAT[i.category]}</td><td className="td">{i.unit}{i.coreCount ? <span className="ml-1 text-xs text-slate-500">· {i.coreCount} core</span> : null}{i.isVehicle ? <span className="ml-1 text-xs text-slate-500">· kendaraan</span> : null}</td><td className="td">{i.installDefaultQty ?? '-'}</td><td className="td">{i.minStock || '-'}</td>
            <td className="td whitespace-nowrap">{canManage && <><LinkBtn onClick={() => setEdit(i)}>Edit</LinkBtn><LinkBtn danger onClick={async () => { if (await doDelete(`/items/${i.id}`, `item ${i.name}`)) reload(); }}>Hapus</LinkBtn></>}</td></tr>
        ))}
      </Table>
      {edit && (
        <Modal title={edit.id ? `Edit item ${edit.sku}` : 'Tambah item'} onClose={() => setEdit(null)}>
          <DynamicForm fields={fields} initial={edit.id ? edit : undefined} sendEmpty={!!edit.id} submitLabel="Simpan"
            onSubmit={async (v) => { if (edit.id) await api(`/items/${edit.id}`, { method: 'PATCH', body: v }); else await api('/items', { body: v }); setEdit(null); await reload(); }} />
        </Modal>
      )}
    </>
  );
}

/* ───── Opname ───── */
function OpnameTab() {
  const [wh, setWh] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const { data: whs } = useFetch<any[]>('/warehouses');
  const { data: items } = useFetch<any[]>('/items');
  const { data: stock, reload } = useFetch<any[]>(wh ? `/stock?warehouseId=${wh}` : null);
  const cons = items?.filter((i) => i.category === 'CONSUMABLE') ?? [];
  const cur = (id: string) => stock?.find((s) => s.status === 'QTY' && s.item.id === id)?.qty ?? 0;

  async function save() {
    setErr(''); setMsg('');
    try {
      const body = { warehouseId: wh, counts: Object.entries(counts).filter(([, v]) => v !== '').map(([itemId, v]) => ({ itemId, counted: Number(v) })) };
      const r = await api<{ diffs: any[] }>('/stock/opname', { body });
      setMsg(`${r.diffs.length} item disesuaikan.`); setCounts({}); reload();
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="max-w-2xl space-y-3">
      <p className="text-sm text-slate-500">Stock opname untuk material habis pakai. Isi jumlah fisik; selisih dicatat sebagai mutasi stok. Aset ber-SN dicek lewat tab Aset & SN.</p>
      <Select className="input" value={wh} onChange={(e) => setWh(e.target.value)}>
        <option value="">— pilih gudang —</option>
        {whs?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </Select>
      {wh && (
        <Table head={['Item', 'Tercatat', 'Fisik']}>
          {cons.map((i) => (
            <tr key={i.id}><td className="td">{i.name}</td><td className="td">{cur(i.id)} {i.unit}</td>
              <td className="td"><input className="input w-28" type="number" min={0} value={counts[i.id] ?? ''} onChange={(e) => setCounts({ ...counts, [i.id]: e.target.value })} /></td></tr>
          ))}
        </Table>
      )}
      <ErrorMsg>{err}</ErrorMsg>{msg && <p className="text-sm text-green-700">{msg}</p>}
      {wh && <button className="btn" onClick={save}>Simpan opname</button>}
    </div>
  );
}

/* ───── Transfer antar gudang (GA) ───── */
function TransferTab() {
  const { data: whs } = useFetch<any[]>('/warehouses');
  const { data: items } = useFetch<any[]>('/items');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [sns, setSns] = useState('');
  const [err, setErr] = useState(''); const [res, setRes] = useState<any>(null); const [busy, setBusy] = useState(false);
  const { data: stock, reload } = useFetch<any[]>(from ? `/stock?warehouseId=${from}` : null);
  const real = (whs ?? []).filter((w) => w.kind !== 'MOBILE' && w.active !== false);
  const cons = (items ?? []).filter((i) => !i.tracked);
  const have = (id: string) => stock?.find((s) => s.status === 'QTY' && s.item.id === id)?.qty ?? 0;
  const list = cons.filter((i) => have(i.id) > 0);
  const serials = sns.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  async function submit() {
    setErr(''); setRes(null); setBusy(true);
    try {
      const lines = Object.entries(qty).filter(([, v]) => Number(v) > 0).map(([itemId, v]) => ({ itemId, qty: Number(v) }));
      const r = await api<any>('/stock/transfer', { body: { fromWarehouseId: from, toWarehouseId: to, note, lines, serials } });
      setRes(r); setQty({}); setSns(''); reload();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm text-slate-500">Pindahkan stok dari satu gudang ke gudang/cabang lain <b>tanpa WO</b>. Stok tetap milik GA/Procurement (hanya lokasinya berubah). Stok teknisi (gudang berjalan) tidak termasuk — itu berubah lewat WO.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm"><span className="label">Dari gudang</span><Select className="input" value={from} onChange={(e) => { setFrom(e.target.value); setQty({}); }}><option value="">— pilih —</option>{real.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></label>
        <label className="block text-sm"><span className="label">Ke gudang</span><Select className="input" value={to} onChange={(e) => setTo(e.target.value)}><option value="">— pilih —</option>{real.filter((w) => w.id !== from).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></label>
      </div>
      {from && (
        <>
          <div><h3 className="mb-1 text-sm font-semibold">Material habis pakai</h3>
            {!list.length ? <p className="text-sm text-slate-400">Tidak ada stok kuantitas di gudang ini.</p> : (
              <Table head={['Item', 'Tersedia', 'Pindahkan']}>{list.map((i) => <tr key={i.id}><td className="td">{i.name}</td><td className="td">{have(i.id)} {i.unit}</td><td className="td"><input className="input w-28" type="number" min={0} max={have(i.id)} value={qty[i.id] ?? ''} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} /></td></tr>)}</Table>
            )}
          </div>
          <label className="block text-sm"><span className="label">Aset ber-serial (SN) — satu per baris / pisahkan koma</span><textarea className="input font-mono text-xs" rows={3} value={sns} onChange={(e) => setSns(e.target.value)} placeholder="SN001&#10;SN002" /><span className="mt-0.5 block text-xs text-slate-500">{serials.length} SN. Hanya aset yang berada di gudang asal & berstatus siap pakai / aset GA. Scanner barcode eksternal: klik kolom ini lalu scan.</span></label>
        </>
      )}
      <label className="block text-sm"><span className="label">Catatan (opsional)</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. kiriman rutin ke cabang Bandung Timur" /></label>
      <ErrorMsg>{err}</ErrorMsg>
      {res && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">Transfer <b>{res.number}</b> berhasil: {res.items} item & {res.assets} aset dari {res.from} → {res.to}. Tercatat di mutasi stok.</p>}
      <button className="btn" disabled={busy || !from || !to} onClick={submit}>{busy ? 'Memproses…' : 'Pindahkan stok'}</button>
    </div>
  );
}

function Inventory() {
  const { user } = useAuth();
  const sp = useSearchParams();
  const [tab, setTab] = useState(sp.get('tab') ?? 'stock');
  const canManage = (user?.features ?? []).includes('inventory.manage');
  void fmtDate;
  return (
    <>
      <PageHeader pretitle="Gudang" title="Inventori & Aset" sub="Multi-gudang · material · perangkat ber-SN · aset GA" />
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'stock', label: 'Stok per gudang' }, { key: 'assets', label: 'Aset & SN' }, { key: 'qc', label: 'Menunggu QC' },
        { key: 'warehouses', label: 'Gudang' }, { key: 'items', label: 'Master item' }, ...(canManage ? [{ key: 'transfer', label: 'Transfer gudang' }, { key: 'opname', label: 'Stock opname' }] : []),
      ]} />
      {tab === 'stock' && <StockTab />}
      {tab === 'assets' && <AssetsTab canManage={canManage} initialQ={sp.get('q') ?? ''} />}
      {tab === 'qc' && <QcTab canManage={canManage} />}
      {tab === 'warehouses' && <WarehousesTab canManage={canManage} />}
      {tab === 'items' && <ItemsTab canManage={canManage} />}
      {tab === 'transfer' && canManage && <TransferTab />}
      {tab === 'opname' && canManage && <OpnameTab />}
    </>
  );
}

const KIND: Record<string, string> = { MAIN: 'Gudang utama', BRANCH: 'Cabang', TRANSIT: 'Transit', MOBILE: 'Stok berjalan' };

export default function InventoryPage() {
  return <Suspense fallback={<p>Memuat…</p>}><Inventory /></Suspense>;
}
