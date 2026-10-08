'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'l1v_theme';

/** Skrip inline di <head> agar tema terpasang sebelum render (tanpa kedip). */
export const THEME_INIT_SCRIPT = `(function(){try{var c=localStorage.getItem('${KEY}')||'system';var d=c==='dark'||(c==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light'}catch(e){}})()`;

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
    try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark' || v === 'system') c = v; } catch { /* ignore */ }
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
          className={`rounded-md px-2 py-1 ${choice === o.v ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
          {o.icon} <span className="hidden sm:inline">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
