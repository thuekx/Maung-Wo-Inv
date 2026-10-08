'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { Tip } from '@/components/Tip';

export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'maung_theme';
const OLD_KEY = 'l1v_theme';

/** Skrip inline di <head> agar tema terpasang sebelum render (tanpa kedip). */
export const THEME_INIT_SCRIPT = `(function(){try{var c=localStorage.getItem('${KEY}')||localStorage.getItem('${OLD_KEY}')||'system';var d=c==='dark'||(c==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light'}catch(e){}})()`;

const Ctx = createContext<{ choice: ThemeChoice; resolved: 'light' | 'dark'; setChoice: (c: ThemeChoice) => void }>({ choice: 'system', resolved: 'light', setChoice: () => {} });

const systemDark = () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>('system');
  const [resolved, setResolved] = useState<'light' | 'dark'>('light');

  const apply = useCallback((c: ThemeChoice) => {
    const dark = c === 'dark' || (c === 'system' && systemDark());
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    setResolved(dark ? 'dark' : 'light');
  }, []);

  useEffect(() => {
    let c: ThemeChoice = 'system';
    try { const v = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY); if (v === 'light' || v === 'dark' || v === 'system') c = v; } catch { /* ignore */ }
    setChoiceState(c);
    apply(c);
  }, [apply]);

  // ikuti perubahan tema sistem selama pilihan = "system"
  useEffect(() => {
    if (choice !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => apply('system');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [choice, apply]);

  const setChoice = (c: ThemeChoice) => {
    setChoiceState(c);
    try { localStorage.setItem(KEY, c); } catch { /* ignore */ }
    apply(c);
  };
  return <Ctx.Provider value={{ choice, resolved, setChoice }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);

export function ThemeSwitch({ className = '' }: { className?: string }) {
  const { choice, setChoice } = useTheme();
  const opts: { v: ThemeChoice; icon: string; label: string }[] = [
    { v: 'light', icon: '☀', label: 'Terang' },
    { v: 'system', icon: '◐', label: 'Sistem' },
    { v: 'dark', icon: '☾', label: 'Gelap' },
  ];
  return (
    <div role="radiogroup" aria-label="Tema" className={`inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-xs ${className}`}>
      {opts.map((o) => (
        <button key={o.v} role="radio" aria-checked={choice === o.v} title={o.label} onClick={() => setChoice(o.v)}
          className={`rounded-md px-2 py-1 ${choice === o.v ? 'bg-accent-500 text-brand-900' : 'text-slate-600 hover:bg-slate-100'}`}>
          {o.icon} <span className="hidden sm:inline">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Pilihan tema di top bar: tiga ikon langsung terlihat (terang / ikuti sistem / gelap), aktif disorot, tooltip saat hover. Di layar kecil menjadi satu tombol siklus. */
export function ThemeToggle() {
  const { choice, setChoice } = useTheme();
  const opts: { v: ThemeChoice; icon: 'sun' | 'monitor' | 'moon'; label: string }[] = [
    { v: 'light', icon: 'sun', label: 'Tema terang' },
    { v: 'system', icon: 'monitor', label: 'Ikuti sistem — otomatis mengikuti tema perangkat' },
    { v: 'dark', icon: 'moon', label: 'Tema gelap' },
  ];
  const cur = opts.find((o) => o.v === choice)!;
  const next = opts[(opts.findIndex((o) => o.v === choice) + 1) % 3];
  return (
    <>
      <div role="radiogroup" aria-label="Tema tampilan" className="hidden items-center gap-0.5 rounded-lg bg-white/10 p-0.5 sm:flex">
        {opts.map((o) => (
          <Tip key={o.v} label={o.label}>
            <button type="button" role="radio" aria-checked={choice === o.v} aria-label={o.label} onClick={() => setChoice(o.v)}
              className={`flex h-8 w-8 items-center justify-center rounded-md transition ${choice === o.v ? 'bg-accent-500 text-brand-900 shadow-sm' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}>
              <Icon name={o.icon} size={18} />
            </button>
          </Tip>
        ))}
      </div>
      <div className="sm:hidden">
        <Tip label={`${cur.label.split(' — ')[0]} · ketuk untuk ganti ke ${next.label.split(' — ')[0].replace('Tema ', '').toLowerCase()}`} align="right">
          <button type="button" onClick={() => setChoice(next.v)} aria-label={cur.label} className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-200 hover:bg-white/10"><Icon name={cur.icon} /></button>
        </Tip>
      </div>
    </>
  );
}
