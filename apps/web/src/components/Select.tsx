'use client';
import { Children, Fragment, isValidElement, useEffect, useMemo, useRef, useState } from 'react';

interface Opt { value: string; label: string; disabled?: boolean }

/** Kumpulkan <option> dari children (termasuk di dalam Fragment/array/map). */
function collect(children: React.ReactNode, out: Opt[] = []): Opt[] {
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    const p = c.props as any;
    if (c.type === Fragment) collect(p.children, out);
    else if (c.type === 'option') out.push({ value: String(p.value ?? Children.toArray(p.children).join('')), label: Children.toArray(p.children).join(''), disabled: p.disabled });
    else if (c.type === 'optgroup') collect(p.children, out);
  });
  return out;
}

type Props = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> & {
  value: string | number | undefined | null;
  onChange?: (e: { target: { value: string } }) => void;
};

const SEARCH_FROM = 8; // pilihan sebanyak ini atau lebih → ada kolom pencarian

/**
 * Pengganti <select>: API sama (value, onChange(e.target.value), <option> sebagai children).
 * Daftar panjang (≥ 8 pilihan) tampil sebagai dropdown berisi kolom cari; daftar pendek tetap <select> bawaan browser (nyaman di ponsel).
 */
export function Select({ value, onChange, children, className = 'input', disabled, size, ...rest }: Props) {
  const opts = useMemo(() => collect(children), [children]);
  const v = value == null ? '' : String(value);
  const native = opts.length < SEARCH_FROM || (size ?? 0) > 1;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const scroll = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc); window.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); window.removeEventListener('scroll', scroll, true); };
  }, [open]);

  if (native)
    return <select {...rest} size={size} className={className} value={v} disabled={disabled} onChange={(e) => onChange?.({ target: { value: e.target.value } })}>{children}</select>;

  const cur = opts.find((o) => o.value === v);
  const shown = opts.filter((o) => !q.trim() || o.label.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = () => {
    if (disabled) return;
    const r = btn.current!.getBoundingClientRect();
    setPos({ left: r.left, top: r.bottom + 4, width: Math.max(r.width, 220) });
    setQ(''); setOpen((o) => !o);
  };
  const pick = (o: Opt) => { if (o.disabled) return; onChange?.({ target: { value: o.value } }); setOpen(false); };
  const flip = pos && pos.top + 300 > window.innerHeight && pos.top > 320;
  return (
    <>
      <button type="button" ref={btn} disabled={disabled} onClick={toggle} aria-haspopup="listbox" aria-expanded={open} aria-label={rest['aria-label']}
        className={`${className} flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60`}>
        <span className={`min-w-0 flex-1 truncate ${cur && cur.value !== '' ? '' : 'text-slate-400'}`}>{cur?.label || opts[0]?.label || '—'}</span>
        <span aria-hidden className="shrink-0 text-xs text-slate-400">▾</span>
      </button>
      {open && pos && (
        <div ref={box} className="fixed z-[70] overflow-hidden rounded-lg border border-slate-300 bg-white shadow-xl dark:border-slate-600 dark:bg-slate-800"
          style={{ left: Math.min(pos.left, window.innerWidth - pos.width - 8), width: pos.width, ...(flip ? { bottom: window.innerHeight - pos.top + 40 } : { top: pos.top }) }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari…" className="input !rounded-none !border-0 !border-b"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (shown[0]) pick(shown[0]); } }} />
          <ul role="listbox" className="max-h-60 overflow-y-auto py-1 text-sm">
            {shown.map((o) => (
              <li key={o.value} role="option" aria-selected={o.value === v} onClick={() => pick(o)}
                className={`cursor-pointer px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 ${o.value === v ? 'bg-accent-50 font-semibold dark:bg-slate-700' : ''} ${o.disabled ? 'cursor-not-allowed opacity-50' : ''}`}>{o.label || '—'}</li>
            ))}
            {!shown.length && <li className="px-3 py-2 text-slate-400">Tidak ada yang cocok</li>}
          </ul>
        </div>
      )}
    </>
  );
}
