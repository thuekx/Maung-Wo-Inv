'use client';
import { useState } from 'react';
import { api, useFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { toast } from '@/lib/dialog';
import { ErrorMsg } from './ui';
import { Select } from '@/components/Select';

export interface SubDraft { formDate: string; regSuffix: string; name: string; address: string; phone: string; email: string; referral: string; packageName: string; serviceNote: string; installFee: string; monthlyFee: string; picName: string; picPhone: string; payment: string; marketingName: string; managerName: string }

/** Angka kecepatan di akhir nama paket (SM-BB-BDG-BASIC-100 → 100) dan awalan tanpa angka itu. */
const split = (name: string) => { const m = /^(.*?)[-_ ]?(\d+(?:[.,]\d+)?)\s*(?:m|mb|mbps)?$/i.exec(name.trim()); return m ? { base: m[1].toLowerCase(), n: Number(m[2].replace(',', '.')) } : { base: name.toLowerCase(), n: NaN }; };
/** Paket yang dipilih + maksimal 3 varian yang mirip (awalan sama, beda angka belakang), diurutkan terdekat. */
function shortlist(all: any[], selected: string, max = 3) {
  const cur = all.find((p) => p.name === selected);
  if (!cur) return [];
  const a = split(cur.name);
  const near = all.filter((p) => p.name !== cur.name && split(p.name).base === a.base).sort((x, y) => Math.abs(split(x.name).n - a.n) - Math.abs(split(y.name).n - a.n) || x.name.localeCompare(y.name)).slice(0, max);
  return [cur, ...near];
}

const rp = (n: unknown) => (n === null || n === undefined || n === '' ? '' : `Rp. ${Math.round(Number(n)).toLocaleString('id-ID')}`);

/** Editor Formulir Berlangganan: semua isian opsional kecuali nomor registrasi; paket & harga mengikuti Master Paket (dari MSRadius). */
export function SubForm({ initial, id, onSaved }: { initial: SubDraft; id?: string; onSaved: (id: string) => void }) {
  const { user } = useAuth();
  const [v, setV] = useState<SubDraft>(initial);
  const [err, setErr] = useState('');
  const [fe, setFe] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { data: cfg } = useFetch<any>('/subscription-settings');
  const { data: pkgs } = useFetch<any[]>('/packages');
  const { data: next } = useFetch<{ regNo: string; suffix: string }>(id ? null : `/subscriptions/next-regno?date=${v.formDate || ''}`);
  const set = (k: keyof SubDraft, val: string) => setV((p) => ({ ...p, [k]: val }));
  const year = v.formDate ? new Date(v.formDate) : new Date();
  const prefix = cfg ? `${cfg.regPrefix}${String(year.getFullYear() % 1000).padStart(3, '0')}` : '…';
  const pickPkg = (p: any) => setV((x) => ({ ...x, packageName: p.name, monthlyFee: p.priceSell != null ? String(Math.round(Number(p.priceSell))) : x.monthlyFee }));
  const field = (k: keyof SubDraft, label: string, props: Record<string, unknown> = {}, help?: string) => (
    <div><label className="mb-1 block text-sm font-medium">{label}</label>
      {props.rows ? <textarea className="input" value={v[k]} onChange={(e) => set(k, e.target.value)} {...props} /> : <input className="input" value={v[k]} onChange={(e) => set(k, e.target.value)} {...props} />}
      {fe[k] && <p className="mt-1 text-xs text-red-600">{fe[k]}</p>}{help && <p className="mt-0.5 text-xs text-slate-500">{help}</p>}</div>
  );
  async function save() {
    setErr(''); setFe({}); setBusy(true);
    try {
      const n = (x: string) => (x === '' ? null : Number(x));
      const body = { ...v, formDate: v.formDate ? new Date(v.formDate).toISOString() : undefined, installFee: n(v.installFee), monthlyFee: n(v.monthlyFee) };
      const r = id ? await api<any>(`/subscriptions/${id}`, { method: 'PATCH', body }).then(() => ({ id })) : await api<{ id: string }>('/subscriptions', { body });
      toast.success('Formulir berlangganan disimpan.');
      onSaved(r.id);
    } catch (e) { setFe((e as any).fields ?? {}); setErr((e as any).fields ? 'Periksa isian yang ditandai merah.' : (e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h2 className="font-semibold">Registrasi</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {field('formDate', 'Tanggal', { type: 'date' })}
          <div><label className="mb-1 block text-sm font-medium">Reg. No.</label>
            {id ? <div className="rounded-lg border bg-slate-50 px-3 py-2 font-mono text-sm text-slate-700 dark:bg-slate-800">Nomor tetap (tidak dapat diubah)</div> : (
              <div className="flex items-center gap-1"><span className="rounded-lg border bg-slate-50 px-3 py-2 font-mono text-sm dark:bg-slate-800">{prefix}</span>
                <input className="input font-mono" inputMode="numeric" maxLength={6} value={v.regSuffix} placeholder={next?.suffix ?? '…'} onChange={(e) => set('regSuffix', e.target.value.replace(/\D/g, ''))} /></div>)}
            {fe.regSuffix && <p className="mt-1 text-xs text-red-600">{fe.regSuffix}</p>}
            {!id && <p className="mt-0.5 text-xs text-slate-500">Dikosongkan = nomor otomatis berikutnya (<b>{next?.regNo ?? '…'}</b>, mengikuti nomor terakhir/awal di Admin). Bila diisi lain, tercatat sesuai isian — tidak boleh sama dengan nomor yang sudah ada.</p>}</div>
        </div>
      </div>
      <div className="card space-y-3">
        <h2 className="font-semibold">Data pelanggan <span className="text-xs font-normal text-slate-500">(semua opsional)</span></h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {field('name', 'Nama', { maxLength: 120 })}{field('phone', 'Telepon', { maxLength: 20 })}
          <div className="sm:col-span-2">{field('address', 'Alamat', { rows: 2, maxLength: 300 })}</div>
          {field('email', 'Email', { maxLength: 120 })}{field('referral', 'Referral', { maxLength: 120 })}
        </div>
      </div>
      <div className="card space-y-3">
        <h2 className="font-semibold">Jenis layanan <span className="text-xs font-normal text-slate-500">— paket & harga dari Master Paket (MSRadius)</span></h2>
        {(() => {
          const shown = shortlist(pkgs ?? [], v.packageName);
          return (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                {shown.map((p) => (
                  <label key={p.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${v.packageName === p.name ? 'border-brand-600 bg-brand-50 dark:bg-slate-700' : ''}`}>
                    <input type="radio" name="pkg" checked={v.packageName === p.name} onChange={() => pickPkg(p)} />
                    <span className="min-w-0 flex-1"><b>{p.name}</b>{p.speed ? <span className="text-slate-500"> · {p.speed}</span> : null}</span>
                    {p.priceSell != null && <span className="shrink-0 text-xs text-slate-600">{rp(p.priceSell)}</span>}
                  </label>
                ))}
                {pkgs && !pkgs.length && <p className="text-sm text-slate-500">Belum ada paket — tarik data MSRadius atau tambah di Master Data.</p>}
              </div>
              {pkgs && pkgs.length > 0 && (
                <div><label className="mb-1 block text-xs font-medium text-slate-600">{shown.length ? 'Pilih paket lain' : 'Pilih paket'}</label>
                  <Select className="input" value="" onChange={(e) => { const p = pkgs.find((x) => x.name === e.target.value); if (p) pickPkg(p); }}>
                    <option value="">— cari / pilih paket —</option>
                    {pkgs.filter((p) => !shown.some((x) => x.id === p.id)).map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                  </Select>
                  {shown.length > 0 && <p className="mt-0.5 text-xs text-slate-500">Yang tampil hanya paket terpilih dan varian yang mirip (maks. 3); paket lain ada di pilihan ini.</p>}</div>
              )}
            </>
          );
        })()}
        {v.packageName && <button type="button" className="text-xs text-slate-500 underline" onClick={() => set('packageName', '')}>Kosongkan pilihan paket</button>}
        {field('serviceNote', 'Note', { maxLength: 200 })}
      </div>
      <div className="card space-y-3">
        <h2 className="font-semibold">Informasi tagihan</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {field('installFee', 'Biaya Pemasangan (Rp., pasca bayar)', { type: 'number', min: 0 })}
          {field('monthlyFee', `Biaya Langganan per bulan (Rp., ${cfg?.ppnNote ?? 'Include PPN 11%'})`, { type: 'number', min: 0 }, 'Terisi otomatis dari harga paket; dapat diubah.')}
          {field('picName', 'Penanggungjawab (PIC)', { maxLength: 120 })}{field('picPhone', 'Telepon PIC', { maxLength: 20 })}
        </div>
        <div><label className="mb-1 block text-sm font-medium">Pembayaran</label>
          <div className="flex flex-wrap gap-4 text-sm">{[['CASH', 'Tunai | Cash'], ['TRANSFER', 'Transfer'], ['DEBIT', 'Debet | Debit']].map(([k, l]) => <label key={k} className="flex items-center gap-1.5"><input type="radio" name="pay" checked={v.payment === k} onChange={() => set('payment', k)} /> {l}</label>)}</div></div>
      </div>
      <div className="card space-y-3">
        <h2 className="font-semibold">Tanda tangan <span className="text-xs font-normal text-slate-500">(nama saja; ditandatangani saat dicetak)</span></h2>
        <div className="grid gap-3 sm:grid-cols-2">{field('marketingName', 'Marketing', { maxLength: 80 })}{field('managerName', 'Manager Marketing', { maxLength: 80 })}</div>
      </div>
      <ErrorMsg>{err}</ErrorMsg>
      <button className="btn" disabled={busy || !user} onClick={save}>{busy ? 'Menyimpan…' : id ? 'Simpan perubahan' : 'Simpan formulir'}</button>
    </div>
  );
}
