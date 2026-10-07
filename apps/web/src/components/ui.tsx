'use client';
import { fileUrl } from '@/lib/api';

export function PageHeader({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
      <div>
        <h1 className="text-xl font-bold">{title}</h1>
        {sub && <p className="text-sm text-slate-500">{sub}</p>}
      </div>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

const TONES: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-700', blue: 'bg-blue-100 text-blue-700', green: 'bg-green-100 text-green-700',
  amber: 'bg-amber-100 text-amber-800', red: 'bg-red-100 text-red-700', violet: 'bg-violet-100 text-violet-700',
};
export const Badge = ({ children, tone = 'slate' }: { children: React.ReactNode; tone?: keyof typeof TONES }) => (
  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>
);

export const statusTone = (final: boolean, status: string) => (status === 'CANCELLED' || status === 'REJECTED' ? 'red' : final ? 'green' : 'blue');

export const ErrorMsg = ({ children }: { children?: React.ReactNode }) =>
  children ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{children}</p> : null;

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b">
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${value === t.key ? 'border-brand-600 font-semibold text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
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
        <thead className="border-b bg-slate-50"><tr>{head.map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
      {rows === 0 && <p className="p-6 text-center text-sm text-slate-400">{empty ?? 'Tidak ada data'}</p>}
    </div>
  );
}

/** Render object data WO secara generik (foto otomatis jadi thumbnail). */
export function DataView({ value, depth = 0 }: { value: any; depth?: number }) {
  if (value === null || value === undefined || value === '') return <span className="text-slate-400">-</span>;
  if (typeof value === 'string' && value.startsWith('/uploads/'))
    return <a href={fileUrl(value)} target="_blank" rel="noreferrer"><img src={fileUrl(value)} alt="" className="h-20 w-20 rounded-lg border object-cover" /></a>;
  if (typeof value === 'boolean') return <span>{value ? 'Ya' : 'Tidak'}</span>;
  if (typeof value !== 'object') return <span>{/^\d{4}-\d\d-\d\dT/.test(String(value)) ? new Date(String(value)).toLocaleString('id-ID') : String(value)}</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-slate-400">-</span>;
    if (value.every((v) => typeof v !== 'object')) return <div className="flex flex-wrap gap-1.5">{value.map((v, i) => <span key={i} className={typeof v === 'string' && v.startsWith('/uploads/') ? '' : 'rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs'}><DataView value={v} depth={depth + 1} /></span>)}</div>;
    return <div className="space-y-1">{value.map((v, i) => <div key={i} className="rounded border bg-slate-50 p-2"><DataView value={v} depth={depth + 1} /></div>)}</div>;
  }
  return (
    <dl className={`grid gap-x-4 gap-y-1 ${depth ? 'text-sm' : ''}`} style={{ gridTemplateColumns: 'max-content 1fr' }}>
      {Object.entries(value).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-xs text-slate-500">{k}</dt>
          <dd><DataView value={v} depth={depth + 1} /></dd>
        </div>
      ))}
    </dl>
  );
}

export const custTone = (s: string): 'green' | 'amber' | 'red' | 'blue' | 'slate' =>
  s === 'ACTIVE' ? 'green' : s === 'SUSPENDED' ? 'amber' : s === 'TERMINATED' || s === 'TERMINATING' ? 'red' : s === 'INSTALLING' ? 'blue' : 'slate';
