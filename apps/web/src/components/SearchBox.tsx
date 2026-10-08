'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Icon } from './icons';

interface Res { customers: any[]; workOrders: any[]; assets: any[] }

/** Pencarian global di header (gaya TailAdmin: kotak cari + pintasan "/"): pelanggan, WO, aset. */
export function SearchBox({ variant = 'bar' }: { variant?: 'bar' | 'page' }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Res | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setRes(null); return; }
    const my = ++seq.current;
    setBusy(true);
    const h = setTimeout(async () => {
      try { const r = await api<Res>(`/search?q=${encodeURIComponent(t)}`); if (my === seq.current) setRes(r); } catch { /* abaikan */ } finally { if (my === seq.current) setBusy(false); }
    }, 250);
    return () => clearTimeout(h);
  }, [q]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') { e.preventDefault(); input.current?.focus(); }
      if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
    };
    const click = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', key); window.addEventListener('mousedown', click);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('mousedown', click); };
  }, []);

  const go = (href: string) => { setOpen(false); setQ(''); setRes(null); router.push(href); };
  const total = res ? res.customers.length + res.workOrders.length + res.assets.length : 0;
  const Group = ({ title, children }: { title: string; children: React.ReactNode }) => <div className="py-1"><div className="subheader px-3 py-1">{title}</div>{children}</div>;
  const Row = ({ href, a, b }: { href: string; a: string; b: string }) => (
    <button type="button" onClick={() => go(href)} className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-slate-100">
      <span className="truncate font-medium text-slate-800">{a}</span><span className="shrink-0 truncate text-xs text-slate-500">{b}</span>
    </button>
  );

  return (
    <div ref={box} className="relative w-full max-w-md">
      <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Cari pelanggan, WO, atau SN…  ( / )" aria-label="Pencarian global"
        className={variant === 'bar'
          ? 'h-10 w-full rounded-lg border border-white/10 bg-white/10 pl-9 pr-3 text-sm text-white outline-none placeholder:text-slate-300 focus:border-accent-400 focus:bg-white/15'
          : 'input !h-10 !pl-9'} />
      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-12 z-50 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
          {busy && !res && <p className="px-3 py-3 text-sm text-slate-500">Mencari…</p>}
          {res && total === 0 && <p className="px-3 py-3 text-sm text-slate-500">Tidak ada hasil untuk “{q.trim()}”</p>}
          {res && res.customers.length > 0 && <Group title="Pelanggan">{res.customers.map((c) => <Row key={c.id} href={`/customers/${c.id}`} a={c.name} b={c.code} />)}</Group>}
          {res && res.workOrders.length > 0 && <Group title="Work Order">{res.workOrders.map((w) => <Row key={w.id} href={`/work-orders/${w.id}`} a={`${w.number} · ${w.title}`} b={w.status} />)}</Group>}
          {res && res.assets.length > 0 && <Group title="Aset">{res.assets.map((a) => <Row key={a.id} href={`/inventory?tab=assets&q=${encodeURIComponent(a.serialNumber)}`} a={a.serialNumber} b={a.item.name} />)}</Group>}
        </div>
      )}
    </div>
  );
}
