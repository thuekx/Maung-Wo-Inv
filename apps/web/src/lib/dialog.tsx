'use client';
import { useEffect, useState } from 'react';

/* Toast + dialog konfirmasi/isian bergaya aplikasi (pengganti window.alert/confirm/prompt). Bisa dipanggil dari kode non-React. */

type Kind = 'success' | 'error' | 'info';
type ToastItem = { id: number; kind: Kind; text: string };
type Ask = { id: number; type: 'confirm' | 'prompt'; text: string; def?: string; danger?: boolean; resolve: (v: any) => void };

let seq = 0;
let toasts: ToastItem[] = [];
let asks: Ask[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

function push(kind: Kind, text: string) {
  const id = ++seq;
  toasts = [...toasts.slice(-3), { id, kind, text }];
  emit();
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); emit(); }, kind === 'error' ? 7000 : 4000);
}
export const toast = {
  success: (t: string) => push('success', t),
  error: (t: string) => push('error', t),
  info: (t: string) => push('info', t),
};

export const confirmDialog = (text: string, opts: { danger?: boolean } = {}) =>
  new Promise<boolean>((resolve) => { asks = [...asks, { id: ++seq, type: 'confirm', text, danger: opts.danger, resolve }]; emit(); });
export const promptDialog = (text: string, def = '') =>
  new Promise<string | null>((resolve) => { asks = [...asks, { id: ++seq, type: 'prompt', text, def, resolve }]; emit(); });

const TONE: Record<Kind, string> = {
  success: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  error: 'border-red-300 bg-red-50 text-red-900',
  info: 'border-sky-300 bg-sky-50 text-sky-900',
};

export function DialogHost() {
  const [, bump] = useState(0);
  const [val, setVal] = useState('');
  useEffect(() => { const f = () => bump((n) => n + 1); subs.add(f); return () => void subs.delete(f); }, []);
  const ask = asks[0];
  useEffect(() => { if (ask?.type === 'prompt') setVal(ask.def ?? ''); }, [ask?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = (v: any) => { if (!ask) return; asks = asks.slice(1); emit(); ask.resolve(v); };
  return (
    <>
      <div className="pointer-events-none fixed right-3 top-20 z-[100] flex w-[min(92vw,22rem)] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg ${TONE[t.kind]}`}>
            <span className="min-w-0 flex-1 whitespace-pre-line break-words">{t.text}</span>
            <button className="shrink-0 opacity-60 hover:opacity-100" aria-label="Tutup" onClick={() => { toasts = toasts.filter((x) => x.id !== t.id); emit(); }}>✕</button>
          </div>
        ))}
      </div>
      {ask && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4" onClick={() => close(ask.type === 'confirm' ? false : null)}>
          <form className="card w-full max-w-sm space-y-3 p-5" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); close(ask.type === 'confirm' ? true : val); }}>
            <p className="whitespace-pre-line text-sm">{ask.text}</p>
            {ask.type === 'prompt' && <input className="input" autoFocus value={val} onChange={(e) => setVal(e.target.value)} />}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => close(ask.type === 'confirm' ? false : null)}>Batal</button>
              <button className={ask.danger ? 'btn-danger' : 'btn'} autoFocus={ask.type === 'confirm'}>{ask.type === 'confirm' ? (ask.danger ? 'Ya, hapus' : 'Ya, lanjut') : 'OK'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
