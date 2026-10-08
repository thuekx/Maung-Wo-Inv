'use client';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, fileUrl, useFetch } from '@/lib/api';
import { promptDialog } from '@/lib/dialog';
import { useAuth } from '@/lib/auth';
import { uploadPhoto, useBranding } from '@/lib/photo';
import { ErrorMsg } from './ui';

export interface Field {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  help?: string;
  itemCategory?: string;
  customerStatus?: string[];
}

/* ───────── input khusus ───────── */

export function SerialInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState('');
  const [scanning, setScanning] = useState(false);
  const [info, setInfo] = useState<Record<string, string>>({});
  const valueRef = useRef(value);
  valueRef.current = value;

  const add = async (raw: string) => {
    const sn = raw.trim().toUpperCase();
    if (!sn || valueRef.current.includes(sn)) return;
    onChange([...valueRef.current, sn]);
    try {
      const a = await api(`/assets/by-serial/${encodeURIComponent(sn)}`);
      setInfo((p) => ({ ...p, [sn]: `${a.item.name} · ${a.status}${a.warehouse ? ' · ' + a.warehouse.name : ''}` }));
    } catch {
      setInfo((p) => ({ ...p, [sn]: '⚠ tidak terdaftar' }));
    }
  };

  useEffect(() => {
    if (!scanning) return;
    let stop: (() => Promise<void>) | undefined;
    let cancelled = false;
    (async () => {
      const { Html5Qrcode } = await import('html5-qrcode');
      if (cancelled) return;
      const sc = new Html5Qrcode('qr-reader');
      stop = async () => { try { await sc.stop(); sc.clear(); } catch { /* sudah berhenti */ } };
      try {
        await sc.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, (txt) => add(txt), () => {});
      } catch { setScanning(false); }
    })();
    return () => { cancelled = true; stop?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input className="input font-mono" placeholder="Ketik / scan barcode lalu Enter" value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(text); setText(''); } }} />
        <button type="button" className="btn-ghost" onClick={() => { add(text); setText(''); }}>Tambah</button>
        <button type="button" className="btn-ghost" onClick={() => setScanning(!scanning)}>{scanning ? 'Tutup kamera' : '📷 Scan'}</button>
      </div>
      {scanning && <div id="qr-reader" className="max-w-xs overflow-hidden rounded-lg border" />}
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

export function MaterialsInput({ value, onChange, category }: { value: { itemId: string; qty: number | string }[]; onChange: (v: any[]) => void; category?: string }) {
  const { data: items } = useFetch<any[]>('/items');
  const list = (items ?? []).filter((i) => !category || i.category === category);
  const set = (idx: number, patch: object) => onChange(value.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  return (
    <div className="space-y-2">
      {value.map((row, i) => {
        const it = list.find((x) => x.id === row.itemId);
        return (
          <div key={i} className="flex gap-2">
            <select className="input" value={row.itemId} onChange={(e) => set(i, { itemId: e.target.value })}>
              <option value="">— pilih item —</option>
              {list.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}
            </select>
            <input className="input w-28" type="number" min={1} placeholder="Qty" value={row.qty} onChange={(e) => set(i, { qty: e.target.value })} />
            <span className="self-center text-xs text-slate-500">{it?.unit}</span>
            <button type="button" className="text-red-600" onClick={() => onChange(value.filter((_, k) => k !== i))}>✕</button>
          </div>
        );
      })}
      <button type="button" className="btn-ghost" onClick={() => onChange([...value, { itemId: '', qty: '' }])}>+ Tambah baris</button>
    </div>
  );
}

export function PhotosInput({ value, onChange, woId, label, kind = 'REPORT' }: { value: string[]; onChange: (v: string[]) => void; woId?: string; label?: string; kind?: 'REPORT' | 'PROGRESS' }) {
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
      for (const f of Array.from(files)) urls.push(await uploadPhoto(f, { woId, label, kind, strict, onStep: setStep }));
      onChange([...value, ...urls]);
    } catch (e) { setErr((e as Error).message); } finally { setStep(''); }
  }
  return (
    <div className="space-y-2">
      <input type="file" accept="image/*" capture="environment" multiple disabled={!!step} onChange={(e) => { pick(e.target.files); e.target.value = ''; }} className="text-sm" />
      <p className="text-xs text-slate-500">📍 Lokasi GPS, waktu{branding.logoUrl ? ', dan logo' : ''} {branding.companyName} otomatis ditempel pada foto{strict && branding.requireGps ? ' (wajib untuk teknisi)' : ''}.</p>
      {step && <p className="text-xs text-brand-700">{step}</p>}
      <ErrorMsg>{err}</ErrorMsg>
      <div className="flex flex-wrap gap-2">
        {value.map((u) => (
          <div key={u} className="relative">
            <img src={fileUrl(u)} alt="" className="h-20 w-20 rounded-lg border object-cover" />
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
          <select className="input" value={r.result} onChange={(e) => set(i, { result: e.target.value })}>
            <option value="GOOD">Baik → Refurbished</option>
            <option value="DAMAGED">Rusak → Damaged (klaim garansi)</option>
            <option value="SCRAP">Scrap (pemutihan aset)</option>
          </select>
          <select className="input" value={r.warehouseId} onChange={(e) => set(i, { warehouseId: e.target.value })}>
            <option value="">{r.result === 'GOOD' ? '— gudang tujuan (wajib) —' : '— gudang (opsional) —'}</option>
            {whs?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <input className="input" placeholder="Catatan kondisi" value={r.note} onChange={(e) => set(i, { note: e.target.value })} />
        </div>
      ))}
    </div>
  );
}

function CustomerSelect({ value, onChange, statuses }: { value: string; onChange: (v: string) => void; statuses?: string[] }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams();
      if (q) p.set('q', q);
      if (statuses) p.set('status', statuses.join(','));
      api<any[]>(`/customers?${p}`).then(setRows).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q, statuses]);
  return (
    <div className="space-y-1">
      <input className="input" placeholder="Cari nama / kode / IP pelanggan…" value={q} onChange={(e) => setQ(e.target.value)} />
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)} size={Math.min(6, Math.max(2, rows.length))}>
        {rows.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name} ({c.status})</option>)}
      </select>
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
        <select className="input" value={value.brandId ?? ''} onChange={(e) => onChange({ brandId: e.target.value || undefined })}>
          <option value="">— merk (opsional) —</option>
          {brands?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {canCreate && <button type="button" className="btn-ghost shrink-0" onClick={() => add('brand')}>+ Merk</button>}
      </div>
      <div className="flex gap-2">
        <select className="input" value={value.modelId ?? ''} disabled={!value.brandId} onChange={(e) => onChange({ brandId: value.brandId, modelId: e.target.value || undefined })}>
          <option value="">— tipe / model (opsional) —</option>
          {models.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {canCreate && <button type="button" className="btn-ghost shrink-0" disabled={!value.brandId} onClick={() => add('model')}>+ Tipe</button>}
      </div>
      <ErrorMsg>{err}</ErrorMsg>
    </div>
  );
}

/* ───────── form dinamis ───────── */

export function DynamicForm({ fields, onSubmit, submitLabel = 'Simpan', danger, woId, woNumber, photoKind, busy, initial, sendEmpty }: {
  fields: Field[]; onSubmit: (values: Record<string, any>) => void | Promise<void>; submitLabel?: string; danger?: boolean; woId?: string; woNumber?: string; photoKind?: 'REPORT' | 'PROGRESS'; busy?: boolean;
  /** nilai awal (mode edit) */ initial?: Record<string, any>;
  /** kolom yang dikosongkan dikirim sebagai null (mode edit) */ sendEmpty?: boolean;
}) {
  const { user } = useAuth();
  const [v, setV] = useState<Record<string, any>>(() => {
    const init: Record<string, any> = {};
    for (const f of fields) init[f.name] = initial && initial[f.name] !== undefined && initial[f.name] !== null ? (f.type === 'datetime' ? String(initial[f.name]).slice(0, 16) : initial[f.name]) : f.type === 'brandmodel' ? {} : ['serials', 'photos', 'materials', 'qc'].includes(f.type) ? [] : f.type === 'bool' ? false : '';
    return init;
  });
  const [err, setErr] = useState('');
  const [fe, setFe] = useState<Record<string, string>>({});
  const { data: techs } = useFetch<any[]>(fields.some((f) => f.type === 'technician') ? '/users/lookup?role=FOC' : null);
  const { data: whs } = useFetch<any[]>(fields.some((f) => f.type === 'warehouse') ? '/warehouses' : null);
  const { data: pkgs } = useFetch<any[]>(fields.some((f) => f.type === 'package') ? '/packages' : null);
  const set = (name: string, val: any) => setV((p) => ({ ...p, [name]: val }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    const miss: Record<string, string> = {};
    for (const f of fields) {
      const x = v[f.name];
      const empty = Array.isArray(x) ? x.length === 0 : f.type === 'bool' ? x !== true : x === '' || x == null;
      if (f.required && empty) miss[f.name] = `${f.label} wajib diisi`;
    }
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
              <select className="input" value={v[f.name]} onChange={(e) => set(f.name, e.target.value)}>
                <option value="">— pilih —</option>
                {f.options?.map((o) => <option key={o}>{o}</option>)}
              </select>)
            : f.type === 'bool' ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!v[f.name]} onChange={(e) => set(f.name, e.target.checked)} /> Ya</label>
            : f.type === 'technician' ? (
              <select className="input" value={v[f.name]} onChange={(e) => set(f.name, e.target.value)}>
                <option value="">— pilih teknisi —</option>
                {techs?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>)
            : f.type === 'warehouse' ? (
              <select className="input" value={v[f.name]} onChange={(e) => set(f.name, e.target.value)}>
                <option value="">— pilih gudang —</option>
                {whs?.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.kind})</option>)}
              </select>)
            : f.type === 'package' ? (
              <select className="input" value={v[f.name]} onChange={(e) => set(f.name, e.target.value)}>
                <option value="">— pilih paket —</option>
                {v[f.name] && !pkgs?.some((p) => p.name === v[f.name]) && <option>{v[f.name]}</option>}
                {pkgs?.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>)
            : f.type === 'brandmodel' ? <BrandModelInput value={v[f.name] ?? {}} onChange={(x) => set(f.name, x)} canCreate={user?.role === 'GA' || user?.role === 'ADMIN'} />
            : f.type === 'customer' ? <CustomerSelect value={v[f.name]} onChange={(x) => set(f.name, x)} statuses={f.customerStatus} />
            : f.type === 'serials' ? <SerialInput value={v[f.name]} onChange={(x) => set(f.name, x)} />
            : f.type === 'materials' ? <MaterialsInput value={v[f.name]} onChange={(x) => set(f.name, x)} category={f.itemCategory} />
            : f.type === 'photos' ? <PhotosInput value={v[f.name]} onChange={(x) => set(f.name, x)} woId={woId} kind={photoKind} label={woNumber ? `${woNumber}${photoKind === 'PROGRESS' ? ' · Progres' : ' · Laporan'}` : undefined} />
            : f.type === 'qc' ? <QcInput woId={woId} value={v[f.name]} onChange={(x) => set(f.name, x)} />
            : <input className="input" type={f.type === 'number' ? 'number' : f.type === 'datetime' ? 'datetime-local' : f.type === 'password' ? 'password' : 'text'} step={f.type === 'number' ? 'any' : undefined} value={v[f.name]} onChange={(e) => set(f.name, e.target.value)} />}
          {fe[f.name] && <p className="mt-1 text-xs font-medium text-red-600" role="alert">{fe[f.name]}</p>}
          {f.help && <p className="mt-0.5 text-xs text-slate-500">{f.help}</p>}
        </div>
      ))}
      <ErrorMsg>{err}</ErrorMsg>
      <button className={danger ? 'btn-danger' : 'btn'} disabled={busy}>{busy ? 'Memproses…' : submitLabel}</button>
    </form>
  );
}
