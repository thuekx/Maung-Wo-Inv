'use client';
import { useState, type InputHTMLAttributes } from 'react';

/** Kolom password dengan ikon mata (tampilkan/sembunyikan ketikan). Dipakai di SEMUA isian password/token. */
export function PasswordInput({ className = 'input', ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative block w-full">
      <input {...rest} type={show ? 'text' : 'password'} className={`${className} !pr-10`} autoComplete={rest.autoComplete ?? 'off'} />
      <button type="button" tabIndex={-1} onClick={() => setShow((s) => !s)} aria-label={show ? 'Sembunyikan password' : 'Tampilkan password'} title={show ? 'Sembunyikan' : 'Tampilkan'}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700">
        {show ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3l18 18" /><path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4.2 9.5 6-0.4 0.8-1.2 1.9-2.3 3" /><path d="M6.6 6.7C4.5 8 3.1 10.1 2.5 12c1 1.8 4.5 6 9.5 6 1.5 0 2.8-.4 4-.9" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></svg>
        )}
      </button>
    </span>
  );
}
