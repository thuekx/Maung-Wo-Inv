'use client';
import Link from 'next/link';
import { createContext, useContext, useEffect, useState } from 'react';
import { api, fileUrl, imgUrl } from '@/lib/api';
import { Icon } from './icons';

export function PageHeader({ title, sub, pretitle, children }: { title: string; sub?: string; pretitle?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {pretitle && <div className="subheader mb-1 text-accent-600">{pretitle}</div>}
        <h1 className="font-display text-2xl font-bold leading-tight text-brand-900">{title}</h1>
        {sub && <p className="mt-1 text-sm text-slate-500">{sub}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

const TONES: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-700', blue: 'bg-blue-100 text-blue-700', green: 'bg-green-100 text-green-700',
  amber: 'bg-amber-100 text-amber-800', red: 'bg-red-100 text-red-700', violet: 'bg-violet-100 text-violet-700',
};
const DOT: Record<string, string> = { slate: 'bg-slate-400', blue: 'bg-blue-500', green: 'bg-green-500', amber: 'bg-amber-500', red: 'bg-red-500', violet: 'bg-violet-500' };
/** Lencana lembut dengan titik status (gaya Tabler `status-dot`). */
export const Badge = ({ children, tone = 'slate' }: { children: React.ReactNode; tone?: keyof typeof TONES }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}><i className={`inline-block h-1.5 w-1.5 rounded-full ${DOT[tone]}`} />{children}</span>
);

export function Avatar({ name, size = 32, className = '', url }: { name: string; size?: number; className?: string; url?: string | null }) {
  if (url) return <img src={imgUrl(url, { w: Math.max(80, size * 2) })} alt="" className={`shrink-0 rounded-full object-cover ${className}`} style={{ width: size, height: size }} />;
  const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  return <span className={`inline-flex shrink-0 items-center justify-center rounded-full bg-accent-100 font-semibold text-brand-900 ${className}`} style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">{ini}</span>;
}

/** Daftar label–nilai rapat (gaya Tabler `datagrid`) untuk halaman detail. */
export function DataGrid({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="min-w-0"><dt className="subheader mb-0.5">{i.label}</dt><dd className="break-words text-slate-800">{i.value ?? '-'}</dd></div>
      ))}
    </dl>
  );
}

export function EmptyState({ icon, title, children }: { icon?: import('./icons').IconName; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400"><Icon name={icon ?? 'inbox'} size={24} /></span>
      <p className="font-medium text-slate-700">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-slate-500">{children}</p>}
    </div>
  );
}

/** Kartu metrik (gaya TailAdmin): ikon dalam kotak lembut, angka besar, label, dan tren opsional. */
export function MetricCard({ icon, color, label, value, hint, delta, href }: { icon: import('./icons').IconName; color: string; label: string; value: number | string; hint?: string; delta?: { text: string; tone: 'good' | 'bad' | 'neutral' }; href?: string }) {
  const body = (
    <div className="card h-full transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: `${color}1f`, color }}><Icon name={icon} size={22} /></span>
        {delta && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${delta.tone === 'good' ? 'bg-green-100 text-green-700' : delta.tone === 'bad' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{delta.text}</span>}
      </div>
      <div className="mt-4 text-[28px] font-bold leading-none text-brand-900">{value}</div>
      <div className="mt-1.5 text-sm text-slate-500">{label}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export const statusTone = (final: boolean, status: string) => (status === 'CANCELLED' || status === 'REJECTED' ? 'red' : final ? 'green' : 'blue');

export const ErrorMsg = ({ children }: { children?: React.ReactNode }) =>
  children ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{children}</p> : null;

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b">
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)} className={`-mb-px border-b-2 px-3.5 py-2.5 text-sm transition ${value === t.key ? 'border-accent-500 font-semibold text-brand-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Table({ head, children, empty }: { head: string[]; children: React.ReactNode; empty?: string }) {
  const rows = Array.isArray(children) ? children.length : children ? 1 : 0;
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full">
        <thead className="border-b bg-slate-50"><tr>{head.map((h, i) => <th key={`${i}-${h}`} className="th">{h}</th>)}</tr></thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
      {rows === 0 && <p className="p-6 text-center text-sm text-slate-400">{empty ?? 'Tidak ada data'}</p>}
    </div>
  );
}

/* Nama barang & gudang (id → nama) dimuat sekali dan dipakai bersama. */
let nameCache: { items: Record<string, string>; wh: Record<string, string> } | null = null;
let namePromise: Promise<void> | null = null;
export function useNames() {
  const [, bump] = useState(0);
  useEffect(() => {
    if (nameCache) return;
    namePromise ??= Promise.all([api<any[]>('/items'), api<any[]>('/warehouses')]).then(([i, w]) => {
      nameCache = { items: Object.fromEntries(i.map((x) => [x.id, `${x.name}${x.sku ? ` (${x.sku})` : ''}`])), wh: Object.fromEntries(w.map((x) => [x.id, x.name])) };
    }).catch(() => { namePromise = null; });
    namePromise.then(() => bump((n) => n + 1));
  }, []);
  return nameCache;
}

/** Kunci data tak dikenal: camelCase dipisah menjadi kata (nama variabel tidak pernah tampil mentah). */
const humanize = (k: string) => { const t = k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };
const LABELS: Record<string, string> = {
  itemId: 'Barang', warehouseId: 'Gudang', toWarehouseId: 'Gudang tujuan', sourceWarehouseId: 'Gudang asal', qty: 'Jumlah', serial: 'Nomor seri', serials: 'Perangkat (SN)', serialsNew: 'SN terpasang', serialsOld: 'SN dilepas', cableMeters: 'Kabel terpakai (m)', opmDbm: 'Redaman OPM (dBm)', note: 'Catatan', photos: 'Foto', materials: 'Material', result: 'Hasil', items: 'Barang', lines: 'Rincian barang', odp: 'ODP', odpPort: 'Port ODP', port: 'Port', vlan: 'VLAN', ip: 'IP internal', publicIp: 'IP publik', lat: 'Lintang', lng: 'Bujur', accuracy: 'Akurasi (m)', pr: 'Purchase Request', reason: 'Alasan', techId: 'Teknisi', technicianId: 'Teknisi', pickup: 'Pengambilan material', at: 'Waktu', validation: 'Validasi teknis', packageName: 'Paket', stockRequest: 'Permintaan barang', report: 'Laporan', activation: 'Aktivasi', reconciliation: 'Rekonsiliasi material', picked: 'Diambil', used: 'Terpakai', leftover: 'Sisa', installed: 'Terpasang', pingMs: 'Ping / Latency (ms)', jitterMs: 'Jitter (ms)', downMbps: 'Download (Mbps)', upMbps: 'Upload (Mbps)', profile: 'Profil bandwidth', stable: 'Stabil', ontAuthorized: 'ONT di-authorize', signalDbm: 'Signal (dBm)', attenuationDb: 'Redaman (dB)', findings: 'Temuan', actions: 'Tindakan', submittedBy: 'Dikirim oleh', category: 'Kategori', location: 'Lokasi', description: 'Uraian', teamHistory: 'Riwayat tim', from: 'Dari', to: 'Menjadi', by: 'Oleh', stockOk: 'Cek stok', fieldChange: 'Koreksi lapangan', results: 'Hasil', condition: 'Kondisi', sentTo: 'Dikirim ke', number: 'Nomor', received: 'Diterima', transfer: 'Mutasi', notes: 'Catatan', ba: 'BA Digital', pop: 'POP', mainSplitter: 'Main splitter', signal: 'Signal', attenuation: 'Redaman', team: 'Tim pelaksana', steps: 'Langkah troubleshooting',
};

/** id/SN mentah → teks terbaca (dari `refs` yang dikirim server per WO). */
export const RefsContext = createContext<Record<string, string>>({});

/** Render object data WO secara generik (foto otomatis jadi thumbnail; id diganti nama). Ukuran & warna teks seragam. */
export function DataView({ value, depth = 0, field }: { value: any; depth?: number; field?: string }) {
  const names = useNames();
  const refs = useContext(RefsContext);
  if (value === null || value === undefined || value === '') return <span className="text-slate-400">-</span>;
  if (typeof value === 'string' && value.startsWith('/uploads/'))
    return <a href={fileUrl(value)} target="_blank" rel="noreferrer"><img src={imgUrl(value, { w: 240 })} alt="" className="h-20 w-20 rounded-lg border object-cover" /></a>;
  if (typeof value === 'string' && refs[value]) {
    const t = refs[value];
    return field === 'pr' ? <a className="text-brand-700 hover:underline" href={`/purchase-requests/${value}`}>{t}</a> : <span>{t}</span>;
  }
  if (typeof value === 'string' && names && (field === 'itemId' || field === 'warehouseId')) return <span>{(field === 'itemId' ? names.items : names.wh)[value] ?? value}</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Ya' : 'Tidak'}</span>;
  if (typeof value !== 'object') return <span>{/^\d{4}-\d\d-\d\dT/.test(String(value)) ? new Date(String(value)).toLocaleString('id-ID') : String(value)}</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-slate-400">-</span>;
    if (value.every((v) => typeof v !== 'object')) return <ul className="space-y-0.5">{value.map((v, i) => <li key={i}><DataView value={v} depth={depth + 1} /></li>)}</ul>;
    return <div className="space-y-1.5">{value.map((v, i) => <div key={i} className="rounded-lg border bg-slate-50 p-2.5"><DataView value={v} depth={depth + 1} /></div>)}</div>;
  }
  return (
    <dl className={`grid items-baseline gap-x-4 gap-y-1.5 text-sm ${depth ? 'border-l-2 border-slate-200 pl-3 dark:border-slate-600' : ''}`} style={{ gridTemplateColumns: 'minmax(7rem,9.5rem) minmax(0,1fr)' }}>
      {Object.entries(value).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-slate-500">{LABELS[k] ?? humanize(k)}</dt>
          <dd className="min-w-0 break-words text-slate-900"><DataView value={v} depth={depth + 1} field={k} /></dd>
        </div>
      ))}
    </dl>
  );
}

/** Status layanan dari MSRadius (kolom "Status layanan" di tabel pelanggan). */
export const RADIUS_STATUS: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'blue' | 'slate'; desc: string }> = {
  WAITING: { label: 'Waiting', tone: 'amber', desc: 'Pelanggan baru — memicu Form Berlangganan' },
  ONLINE: { label: 'Online', tone: 'green', desc: 'Layanan aktif & internet berjalan' },
  OFFLINE: { label: 'Need Check', tone: 'red', desc: 'Offline — perlu dicek: kemungkinan masalah internet di sisi pelanggan' },
  ISOLIR: { label: 'Isolir', tone: 'blue', desc: 'Layanan ditangguhkan (suspend)' },
  DISABLE: { label: 'Disable', tone: 'slate', desc: 'Pelanggan di-terminate' },
};
export const RadiusStatusBadge = ({ s }: { s?: string | null }) => (s && RADIUS_STATUS[s] ? <span title={RADIUS_STATUS[s].desc}><Badge tone={RADIUS_STATUS[s].tone}>{RADIUS_STATUS[s].label}</Badge></span> : <span className="text-slate-400">-</span>);

export const custTone = (s: string): 'green' | 'amber' | 'red' | 'blue' | 'slate' =>
  s === 'ACTIVE' ? 'green' : s === 'SUSPENDED' ? 'amber' : s === 'TERMINATED' || s === 'TERMINATING' ? 'red' : s === 'INSTALLING' ? 'blue' : 'slate';

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className={`card my-8 w-full ${wide ? 'max-w-3xl' : 'max-w-lg'}`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">{title}</h2><button className="text-slate-400 hover:text-slate-700" onClick={onClose} aria-label="Tutup">✕</button></div>
        {children}
      </div>
    </div>
  );
}

export const LinkBtn = ({ onClick, children, danger }: { onClick: () => void; children: React.ReactNode; danger?: boolean }) => (
  <button type="button" onClick={onClick} className={`btn-ghost mx-0.5 !px-2.5 !py-1 !text-xs ${danger ? '!border-red-300 !text-red-600 hover:!bg-red-50' : '!text-brand-700'}`}>{children}</button>
);
