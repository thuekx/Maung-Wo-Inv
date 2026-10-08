'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { fileUrl } from '@/lib/api';
import { useBranding } from '@/lib/brand';
import { ThemeSwitch } from '@/lib/theme';
import { Icon, MarkM } from '@/components/icons';

/** Halaman masuk mengikuti mockup MAUNG by LIV: panel brand navy (logo, tagline emas, teks) + kartu masuk. Semua teks/logo diatur Admin. */
export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const brand = useBranding();
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await login(id.trim(), password, remember); router.replace('/'); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const lines = brand.loginText.split('\n').filter(Boolean);
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.15fr_1fr]">
      {/* panel brand */}
      <section className="relative isolate flex flex-col justify-center overflow-hidden bg-brand-900 px-8 py-12 text-white sm:px-14 lg:py-0"
        style={brand.loginBgUrl ? { backgroundImage: `linear-gradient(rgb(var(--brand-900) / .78), rgb(var(--brand-950) / .9)), url(${fileUrl(brand.loginBgUrl)})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>
        {!brand.loginBgUrl && <div className="contour absolute inset-0 -z-10 opacity-80" />}
        <div className="max-w-xl">
          {brand.logoUrl
            ? <img src={fileUrl(brand.logoUrl)} alt={brand.companyName} className="mb-4 h-24 w-auto max-w-full object-contain object-left sm:h-28" />
            : <div className="mb-4 flex items-center gap-3"><MarkM size={64} /><span className="font-display text-5xl font-extrabold tracking-wide">{brand.companyName}</span></div>}
          {brand.subtitle && <p className="text-xs tracking-[0.18em] text-slate-300 sm:text-sm">{brand.subtitle}</p>}
          {brand.tagline && <p className="mt-8 font-display text-3xl font-semibold leading-tight text-accent-400 sm:text-4xl">{brand.tagline}</p>}
          <div className="my-5 h-0.5 w-12 bg-accent-500" />
          <div className="font-display text-xl leading-snug text-slate-100 sm:text-2xl">{lines.map((l, i) => <p key={i}>{l}</p>)}</div>
        </div>
      </section>

      {/* kartu masuk */}
      <section className="flex flex-col items-center justify-center gap-4 bg-slate-50 px-6 py-10">
        <form onSubmit={submit} className="card w-full max-w-md space-y-4 p-7 shadow-lg">
          <div>
            <h1 className="font-display text-2xl font-bold text-brand-900">Selamat Datang</h1>
            <p className="text-sm text-slate-500">Masuk ke {brand.companyName}</p>
          </div>
          <label className="relative block">
            <span className="sr-only">Email atau username</span>
            <Icon name="user" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input !pl-10" placeholder="Email atau Username" value={id} onChange={(e) => setId(e.target.value)} required autoFocus autoComplete="username" />
          </label>
          <label className="relative block">
            <span className="sr-only">Password</span>
            <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
            <input className="input !pl-10" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </label>
          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{err}</p>}
          <button className="btn-secondary w-full !py-2.5" disabled={busy}>{busy ? 'Masuk…' : 'Masuk'}</button>
          <div className="flex items-center justify-between text-sm">
            <label className="flex items-center gap-2 text-slate-600"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-brand-900" /> Ingat saya</label>
            <button type="button" className="btn-link" onClick={() => setHelp(!help)}>Lupa password?</button>
          </div>
          {help && <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">Hubungi Admin untuk mengatur ulang password Anda. Setelah itu Anda akan diminta menggantinya saat masuk.</p>}
        </form>
        <ThemeSwitch />
      </section>
    </main>
  );
}
