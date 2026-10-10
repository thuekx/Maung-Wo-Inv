'use client';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, fileUrl, imgUrl, useFetch } from '@/lib/api';
import { promptDialog } from '@/lib/dialog';
import { useAuth } from '@/lib/auth';
import { uploadPhoto, useBranding } from '@/lib/photo';
import { ErrorMsg } from './ui';
import { Select } from '@/components/Select';

export interface Field {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  help?: string;
  itemCategory?: string;
  customerStatus?: string[];
  pickedOnly?: boolean;
  plain?: boolean;
}

/* ───────── input khusus ───────── */

import { parseScan, ScanButtons } from '@/components/Scanner';
import { MapPicker } from '@/components/MapPicker';

export function SerialInput({ value, onChange, onPending }: { value: string[]; onChange: (v: string[]) => void; onPending?: (text: string) => void }) {
  const [text, setTextRaw] = useState('');
  const setText = (t: string) => { setTextRaw(t); onPending?.(t.trim()); };
  const [info, setInfo] = useState<Record<string, string>>({});
  const valueRef = useRef(value);
  valueRef.current = value;

  const add = async (raw: string) => {
    const sn = parseScan(raw);
    if (!sn || valueRef.current.includes(sn)) return;
    onChange([...valueRef.current, sn]);
    try {
      const a = await api(`/assets/by-serial/${encodeURIComponent(sn)}`);
      setInfo((p) => ({ ...p, [sn]: `${a.item.name} · ${a.status}${a.warehouse ? ' · ' + a.warehouse.name : ''}` }));
    } catch {
      setInfo((p) => ({ ...p, [sn]: '⚠ tidak terdaftar' }));
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input className={`input min-w-[10rem] flex-1 font-mono ${text.trim() ? 'border-amber-400' : ''}`} placeholder="Ketik / scan barcode lalu Enter" value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(text); setText(''); } }} />
        <button type="button" className="btn-ghost" onClick={() => { add(text); setText(''); }}>Tambah</button>
        <ScanButtons onScan={(t) => add(t)} />
      </div>
      {text.trim() && <p className="text-xs font-medium text-amber-700">⚠ SN &quot;{text.trim().toUpperCase()}&quot; belum ditambahkan — tekan <b>Tambah</b> atau Enter, jika tidak SN ini tidak ikut tersimpan.</p>}
      <ul className="space-y-1">
        {value.map((s) => (
          <li key={s} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
            <span><span className="font-mono">{s}</span> <span className="text-xs text-slate-500">{info[s]}</span></span>
            <button type="button" className="text-red-600" onClick={() => onChange(value.filter((x) => x !== s))}>✕</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const itemLabel = (x: any) => `${x.name}${x.coreCount ? ` · ${x.coreCount} core` : ''} (${x.unit})`;

export function MaterialsInput({ value, onChange, category, woId, pickedOnly }: { value: { itemId: string; qty: number | string }[]; onChange: (v: any[]) => void; category?: string; woId?: string; pickedOnly?: boolean }) {
  const { data: items } = useFetch<any[]>('/items');
  const { data: wo } = useFetch<any>(pickedOnly && woId ? `/work-orders/${woId}` : null);
  const picked: Record<string, number> = {};
  for (const m of wo?.data?.pickup?.materials ?? []) picked[m.itemId] = (picked[m.itemId] ?? 0) + Number(m.qty);
  const list = (items ?? []).filter((i) => (!category || i.category === category) && (!pickedOnly || picked[i.id] !== undefined));
  const set = (idx: number, patch: object) => onChange(value.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  const usedBy = (id: string, except: number) => value.reduce((n, v, k) => n + (k !== except && v.itemId === id ? Number(v.qty) || 0 : 0), 0);
  return (
    <div className="space-y-2">
      {pickedOnly && wo && list.length === 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Belum ada material yang diambil di WO ini. Material hanya bisa dilaporkan terpakai bila diambil saat &quot;Mulai &amp; ambil material&quot;.</p>}
      {value.map((row, i) => {
        const it = list.find((x) => x.id === row.itemId);
        const max = it && pickedOnly ? picked[it.id] - usedBy(it.id, i) : undefined;
        return (
          <div key={i} className="flex gap-2">
            <Select className="input" value={row.itemId} onChange={(e) => set(i, { itemId: e.target.value })}>
              <option value="">— pilih item —</option>
              {list.map((x) => <option key={x.id} value={x.id}>{itemLabel(x)}{pickedOnly ? ` — diambil ${picked[x.id]}` : ''}</option>)}
            </Select>
            <input className="input w-28" type="number" min={1} max={max} placeholder="Qty" value={row.qty} onChange={(e) => set(i, { qty: e.target.value })} />
            <span className="self-center text-xs text-slate-500">{it?.unit}{max !== undefined ? ` (maks ${max})` : ''}</span>
            <button type="button" className="text-red-600" onClick={() => onChange(value.filter((_, k) => k !== i))}>✕</button>
          </div>
        );
      })}
      <button type="button" className="btn-ghost" onClick={() => onChange([...value, { itemId: '', qty: '' }])}>+ Tambah baris</button>
      {pickedOnly && list.length > 0 && <p className="text-xs text-slate-500">Sisa yang tidak dipakai tetap tercatat di Stok Berjalan Anda.</p>}
    </div>
  );
}

export function PhotosInput({ value, onChange, woId, label, kind = 'REPORT', plain }: { value: string[]; onChange: (v: string[]) => void; woId?: string; label?: string; kind?: 'REPORT' | 'PROGRESS'; plain?: boolean }) {
  const { user } = useAuth();
  const branding = useBranding();
  const [step, setStep] = useState('');
  const [err, setErr] = useState('');
  const strict = user?.role === 'FOC';
  async function pick(files: FileList | null) {
    if (!files) return;
    setErr('');
    try {
      const urls: string[] = [];
      for (const f of Array.from(files)) urls.push(await uploadPhoto(f, { woId, label, kind, strict, plain, onStep: setStep }));
      onChange([...value, ...urls]);
    } catch (e) { setErr((e as Error).message); } finally { setStep(''); }
  }
  return (
    <div className="space-y-2">
      <input type="file" accept="image/*" {...(plain ? {} : { capture: 'environment' as const })} multiple disabled={!!step} onChange={(e) => { pick(e.target.files); e.target.value = ''; }} className="text-sm" />
      <p className="text-xs text-slate-500">📍 Lokasi GPS, waktu{branding.logoUrl ? ', dan logo' : ''} {branding.companyName} otomatis ditempel pada foto{strict && branding.requireGps ? ' (wajib untuk teknisi)' : ''}.</p>
      {step && <p className="text-xs text-brand-700">{step}</p>}
      <ErrorMsg>{err}</ErrorMsg>
      <div className="flex flex-wrap gap-2">
        {value.map((u) => (
          <div key={u} className="relative">
            <img src={imgUrl(u, { w: 240 })} alt="" className="h-20 w-20 rounded-lg border object-cover" />
            <button type="button" className="absolute -right-1 -top-1 h-5 w-5 rounded-full bg-red-600 text-xs text-white" onClick={() => onChange(value.filter((x) => x !== u))}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function QcInput({ woId, value, onChange }: { woId?: string; value: any[]; onChange: (v: any[]) => void }) {
  const { data: assets } = useFetch<any[]>(woId ? `/work-orders/${woId}/qc-assets` : '/assets/pending-qc');
  const { data: whs } = useFetch<any[]>('/warehouses');
  useEffect(() => {
    if (assets && !value.length) onChange(assets.map((a) => ({ serial: a.serialNumber, result: 'GOOD', warehouseId: '', note: '' })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets]);
  const set = (i: number, p: object) => onChange(value.map((v, k) => (k === i ? { ...v, ...p } : v)));
  if (assets && !assets.length) return <p className="text-sm text-slate-500">Tidak ada aset yang perlu di-QC pada WO ini.</p>;
  return (
    <div className="space-y-2">
      {value.map((r, i) => (
        <div key={r.serial} className="grid gap-2 rounded-lg border p-2 md:grid-cols-4">
          <div className="self-center font-mono text-sm">{r.serial}<div className="text-xs text-slate-500">{assets?.find((a) => a.serialNumber === r.serial)?.item.name}</div></div>
          <Select className="input" value={r.result} onChange={(e) => set(i, { result: e.target.value })}>
            <option value="GOOD">Baik → Refurbished</option>
            <option value="DAMAGED">Rusak → Damaged (klaim garansi)</option>
            <option value="SCRAP">Scrap (pemutihan aset)</option>
          </Select>
          <Select className="input" value={r.warehouseId} onChange={(e) => set(i, { warehouseId: e.target.value })}>
            <option value="">{r.result === 'GOOD' ? '— gudang tujuan (wajib) —' : '— gudang (opsional) —'}</option>
            {whs?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
          <input className="input" placeholder="Catatan kondisi" value={r.note} onChange={(e) => set(i, { note: e.target.value })} />
        </div>
      ))}
    </div>
  );
}

function CustomerSelect({ value, onChange, statuses }: { value: string; onChange: (v: string) => void; statuses?: string[] }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [picked, setPicked] = useState<any | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams();
      if (q) p.set('q', q);
      p.set('limit', '30');
      if (statuses) p.set('status', statuses.join(','));
      api<any>(`/customers?${p}`).then((r) => setRows(Array.isArray(r) ? r : r.data ?? [])).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q, statuses]);
  // nilai awal (mis. dari tautan) tanpa pilihan lokal: ambil namanya agar terlihat
  useEffect(() => { if (value && !picked) api<any>(`/customers/${value}`).then(setPicked).catch(() => {}); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  if (value && picked) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-accent-500 bg-accent-50 px-3 py-2 text-sm dark:bg-slate-700">
        <span className="min-w-0"><b>{picked.name}</b> <span className="text-slate-500">· {picked.code} · {picked.status}</span></span>
        <button type="button" className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={() => { onChange(''); setPicked(null); }}>Ganti</button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <input className="input" placeholder="Cari nama / kode / IP pelanggan…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border bg-white text-sm dark:bg-slate-800" role="listbox">
        {rows.map((c) => (
          <li key={c.id} role="option" aria-selected={false} className="cursor-pointer px-3 py-2 hover:bg-slate-100 active:bg-slate-200 dark:hover:bg-slate-700" onClick={() => { setPicked(c); onChange(c.id); }}>
            <b>{c.name}</b> <span className="text-slate-500">· {c.code} · {c.status}</span>
          </li>
        ))}
        {!rows.length && <li className="px-3 py-2 text-slate-400">{q ? 'Tidak ada pelanggan yang cocok' : 'Ketik untuk mencari pelanggan'}</li>}
      </ul>
    </div>
  );
}

export function BrandModelInput({ value, onChange, canCreate }: { value: { brandId?: string; modelId?: string }; onChange: (v: { brandId?: string; modelId?: string }) => void; canCreate?: boolean }) {
  const [n, setN] = useState(0);
  const [err, setErr] = useState('');
  const { data: brands } = useFetch<any[]>(`/asset-brands?${n}`);
  const models = brands?.find((b) => b.id === value.brandId)?.models ?? [];
  const add = async (kind: 'brand' | 'model') => {
    const name = await promptDialog(kind === 'brand' ? 'Nama merk baru (mis. Huawei, ZTE, Mikrotik):' : 'Nama tipe baru (mis. HG8145V5):');
    if (!name?.trim()) return;
    setErr('');
    try {
      if (kind === 'brand') { const b = await api('/asset-brands', { body: { name } }); onChange({ brandId: b.id }); }
      else { const m = await api(`/asset-brands/${value.brandId}/models`, { body: { name } }); onChange({ brandId: value.brandId, modelId: m.id }); }
      setN((x) => x + 1);
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Select className="input" value={value.brandId ?? ''} onChange={(e) => onChange({ brandId: e.target.value || undefined })}>
          <option value="">— merk (opsional) —</option>
          {brands?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        {canCreate && <button type="button" className="btn-ghost shrink-0" onClick={() => add('brand')}>+ Merk</button>}
      </div>
      <div className="flex gap-2">
        <Select className="input" value={value.modelId ?? ''} disabled={!value.brandId} onChange={(e) => onChange({ brandId: value.brandId, modelId: e.target.value || undefined })}>
          <option value="">— tipe / model (opsional) —</option>
          {models.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
        {canCreate && <button type="button" className="btn-ghost shrink-0" disabled={!value.brandId} onClick={() => add('model')}>+ Tipe</button>}
      </div>
      <ErrorMsg>{err}</ErrorMsg>
    </div>
  );
}

/* ───────── form dinamis ───────── */

/** Pilih tim pelaksana (1 atau lebih teknisi) dengan kotak cari. */
function TeamPicker({ value, onChange, techs }: { value: string[]; onChange: (v: string[]) => void; techs: any[] }) {
  const [q, setQ] = useState('');
  const shown = techs.filter((t) => !q.trim() || t.name.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const SUB: Record<string, string> = { MANAGER: 'Manager', SUPERVISOR: 'Supervisor', STAFF: 'Staff' };
  return (
    <div className="rounded-lg border border-slate-300 p-2">
      {techs.length > 6 && <input className="input mb-2" placeholder="Cari teknisi…" value={q} onChange={(e) => setQ(e.target.value)} />}
      <div className="grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2">
        {shown.map((t) => (
          <label key={t.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm ${value.includes(t.id) ? 'border-accent-500 bg-accent-50 font-medium dark:bg-slate-700' : 'border-slate-200'}`}>
            <input type="checkbox" checked={value.includes(t.id)} onChange={() => toggle(t.id)} />
            <span className="min-w-0 flex-1 truncate">{t.name}</span>
            <span className="text-[11px] text-slate-500">{SUB[t.subRole] ?? ''}</span>
          </label>
        ))}
        {!shown.length && <p className="px-1 text-sm text-slate-400">Tidak ada teknisi</p>}
      </div>
      <p className="mt-1.5 text-xs text-slate-500">{value.length ? `${value.length} dipilih: ${techs.filter((t) => value.includes(t.id)).map((t) => t.name).join(', ')}` : 'Belum ada yang dipilih'}</p>
    </div>
  );
}

export function DynamicForm({ fields, onSubmit, submitLabel = 'Simpan', danger, woId, woNumber, photoKind, busy, initial, sendEmpty }: {
  fields: Field[]; onSubmit: (values: Record<string, any>) => void | Promise<void>; submitLabel?: string; danger?: boolean; woId?: string; woNumber?: string; photoKind?: 'REPORT' | 'PROGRESS'; busy?: boolean;
  /** nilai awal (mode edit) */ initial?: Record<string, any>;
  /** kolom yang dikosongkan dikirim sebagai null (mode edit) */ sendEmpty?: boolean;
}) {
  const { user } = useAuth();
  const [v, setV] = useState<Record<string, any>>(() => {
    const init: Record<string, any> = {};
    for (const f of fields) init[f.name] = initial && initial[f.name] !== undefined && initial[f.name] !== null ? (f.type === 'datetime' ? String(initial[f.name]).slice(0, 16) : initial[f.name]) : f.type === 'brandmodel' ? {} : ['serials', 'technicians', 'photos', 'materials', 'qc'].includes(f.type) ? [] : f.type === 'bool' ? false : '';
    return init;
  });
  const [err, setErr] = useState('');
  const [fe, setFe] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, string>>({});
  const { data: techs } = useFetch<any[]>(fields.some((f) => f.type === 'technician' || f.type === 'technicians') ? '/users/lookup?role=FOC&assignable=1' : null);
  const { data: whs } = useFetch<any[]>(fields.some((f) => f.type === 'warehouse') ? '/warehouses' : null);
  const { data: pkgs } = useFetch<any[]>(fields.some((f) => f.type === 'package') ? '/packages' : null);
  const { data: areas } = useFetch<any[]>(fields.some((f) => f.type === 'area') ? '/areas' : null);
  const set = (name: string, val: any) => {
    setV((p) => ({ ...p, [name]: val }));
    // galat inline hilang begitu isian diperbaiki; banner galat ikut hilang bila tak ada yang tersisa
    setFe((p) => { if (!p[name]) return p; const { [name]: _x, ...rest } = p; if (!Object.keys(rest).length) setErr(''); return rest; });
  };
  const hasCoords = fields.some((f) => f.name === 'lat') && fields.some((f) => f.name === 'lng');
  const [map, setMap] = useState(false);
  const [geoMsg, setGeoMsg] = useState('');
  const useHere = () => {
    setGeoMsg('');
    if (!window.isSecureContext || !navigator.geolocation) return setGeoMsg('Lokasi perangkat hanya bisa dibaca di halaman HTTPS. Pilih dari peta atau ketik koordinat manual.');
    navigator.geolocation.getCurrentPosition(
      (p) => { setV((x) => ({ ...x, lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) })); setGeoMsg(`Lokasi terisi (akurasi ±${Math.round(p.coords.accuracy)} m)`); },
      (e) => setGeoMsg(e.code === 1 ? 'Izin lokasi ditolak — izinkan lokasi untuk situs ini di pengaturan browser.' : 'Lokasi belum didapat, coba lagi di tempat terbuka.'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    const miss: Record<string, string> = {};
    for (const f of fields) {
      const x = v[f.name];
      const empty = Array.isArray(x) ? x.length === 0 : f.type === 'bool' ? x !== true : x === '' || x == null;
      if (f.required && empty) miss[f.name] = `${f.label} wajib diisi`;
    }
    for (const f of fields) if (f.type === 'serials' && pending[f.name]) miss[f.name] = `SN "${pending[f.name].toUpperCase()}" sudah diketik tetapi belum ditambahkan — tekan Tambah dulu (atau hapus teksnya)`;
    setFe(miss);
    if (Object.keys(miss).length) {
      setErr('Lengkapi isian yang ditandai merah.');
      document.getElementById(`fld-${Object.keys(miss)[0]}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    const out: Record<string, any> = {};
    for (const f of fields) {
      let x = v[f.name];
      if (f.type === 'materials') x = x.filter((m: any) => m.itemId && Number(m.qty) > 0).map((m: any) => ({ itemId: m.itemId, qty: Number(m.qty) }));
      if (f.type === 'qc') x = x.map((r: any) => ({ ...r, warehouseId: r.warehouseId || undefined, note: r.note || undefined }));
      if (f.type === 'brandmodel') { out.brandId = x?.brandId; out.modelId = x?.modelId; continue; }
      if ((x === '' || x == null) && sendEmpty && !['serials', 'photos', 'materials', 'qc'].includes(f.type)) { out[f.name] = null; continue; }
      if (x === '' || x == null) continue;
      if (f.type === 'datetime') x = new Date(x).toISOString(); // zona waktu browser → UTC
      out[f.name] = x;
    }
    try { await onSubmit(out); } catch (e) {
      const fields2 = (e as ApiError).fields ?? {};
      const known = Object.fromEntries(Object.entries(fields2).filter(([k]) => fields.some((f) => f.name === k || (f.type === 'brandmodel' && (k === 'brandId' || k === 'modelId')))));
      setFe(known);
      setErr(Object.keys(known).length ? 'Periksa isian yang ditandai merah.' : (e as Error).message);
      const first = Object.keys(known)[0];
      if (first) document.getElementById(`fld-${first}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {fields.map((f) => (
        <div key={f.name} id={`fld-${f.name}`} className={fe[f.name] ? 'rounded-lg ring-1 ring-red-400 ring-offset-4 ring-offset-transparent' : ''}>
          <label className="mb-1 block text-sm font-medium">{f.label}{f.required && <span className="text-red-500"> *</span>}</label>
          {f.type === 'textarea' ? <textarea className="input" rows={3} value={v[f.name]} onChange={(e) => set(f.name, e.target.value)} />
            : f.type === 'select' ? (
              <Select className="input" value={v[f.name]} onChange={(e) => set(f.name, e.target.value)}>
                <option value="">— pilih —</option>
                {f.options?.map((o) => <option key={o}>{o}</option>)}
              </Select>)
            : f.type === 'bool' ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!v[f.name]} onChange={(e) => set(f.name, e.target.checked)} /> Ya</label>
            : f.type === 'technician' ? (
              <Select className="input" value={v[f.name]} onChange={(e) => set(f.name, e.target.value)}>
                <option value="">— pilih teknisi —</option>
                {techs?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>)
            : f.type === 'technicians' ? <TeamPicker value={v[f.name] ?? []} onChange={(x) => set(f.name, x)} techs={techs ?? []} />
            : f.type === 'warehouse' ? (
              <Select className="input" value={v[f.name]} onChange={(e) => set(f.name, e.target.value)}>
                <option value="">— pilih gudang —</option>
                {whs?.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.kind})</option>)}
              </Select>)
            : f.type === 'area' ? (
              <Select className="input" value={v[f.name]} onChange={(e) => set(f.name, e.target.value)}>
                <option value="">— pilih area —</option>
                {v[f.name] && !areas?.some((a) => a.id === v[f.name]) && <option value={v[f.name]}>(area nonaktif)</option>}
                {areas?.map((a) => <option key={a.id} value={a.id}>{a.name}{a.warehouse ? '' : ' (belum ada gudang)'}</option>)}
              </Select>)
            : f.type === 'package' ? (
              <Select className="input" value={v[f.name]} onChange={(e) => set(f.name, e.target.value)}>
                <option value="">— pilih paket —</option>
                {v[f.name] && !pkgs?.some((p) => p.name === v[f.name]) && <option>{v[f.name]}</option>}
                {pkgs?.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
              </Select>)
            : f.type === 'brandmodel' ? <BrandModelInput value={v[f.name] ?? {}} onChange={(x) => set(f.name, x)} canCreate={user?.role === 'GA' || user?.role === 'ADMIN'} />
            : f.type === 'customer' ? <CustomerSelect value={v[f.name]} onChange={(x) => set(f.name, x)} statuses={f.customerStatus} />
            : f.type === 'serials' ? <SerialInput value={v[f.name]} onChange={(x) => set(f.name, x)} onPending={(t) => setPending((p) => ({ ...p, [f.name]: t }))} />
            : f.type === 'materials' ? <MaterialsInput value={v[f.name]} onChange={(x) => set(f.name, x)} category={f.itemCategory} woId={woId} pickedOnly={f.pickedOnly} />
            : f.type === 'photos' ? <PhotosInput plain={f.plain} value={v[f.name]} onChange={(x) => set(f.name, x)} woId={woId} kind={photoKind} label={woNumber ? `${woNumber}${photoKind === 'PROGRESS' ? ' · Progres' : ' · Laporan'}` : undefined} />
            : f.type === 'qc' ? <QcInput woId={woId} value={v[f.name]} onChange={(x) => set(f.name, x)} />
            : <input className="input" type={f.type === 'number' ? 'number' : f.type === 'datetime' ? 'datetime-local' : f.type === 'password' ? 'password' : 'text'} step={f.type === 'number' ? 'any' : undefined} value={v[f.name]} onChange={(e) => set(f.name, e.target.value)} />}
          {fe[f.name] && <p className="mt-1 text-xs font-medium text-red-600" role="alert">{fe[f.name]}</p>}
          {f.help && <p className="mt-0.5 text-xs text-slate-500">{f.help}</p>}
          {hasCoords && f.name === 'lng' && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" className="btn-ghost" onClick={useHere}>📍 Gunakan lokasi sekarang</button>
              <button type="button" className="btn-ghost" onClick={() => setMap(true)}>🗺 Pilih dari peta</button>
              {geoMsg && <span className="text-xs text-slate-600">{geoMsg}</span>}
            </div>
          )}
        </div>
      ))}
      <ErrorMsg>{err}</ErrorMsg>
      <button className={danger ? 'btn-danger' : 'btn'} disabled={busy}>{busy ? 'Memproses…' : submitLabel}</button>
      {map && <MapPicker lat={v.lat === '' || v.lat == null ? undefined : Number(v.lat)} lng={v.lng === '' || v.lng == null ? undefined : Number(v.lng)} onPick={(la, ln) => setV((x) => ({ ...x, lat: la, lng: ln }))} onClose={() => setMap(false)} />}
    </form>
  );
}
