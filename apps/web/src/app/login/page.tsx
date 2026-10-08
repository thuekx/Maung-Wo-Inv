'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ThemeSwitch } from '@/lib/theme';
import { useBranding } from '@/lib/photo';
import { fileUrl } from '@/lib/api';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const brand = useBranding();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try { await login(email, password); router.replace('/'); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4">
        <div>
          {brand.logoUrl && <img src={fileUrl(brand.logoUrl)} alt={brand.companyName} className="mb-2 h-12 w-auto object-contain" />}
          <h1 className="bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-xl font-extrabold text-transparent">{brand.companyName} · WO &amp; Inventory</h1>
          <p className="text-sm text-slate-500">Masuk dengan akun divisi Anda</p>
        </div>
        <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button className="btn w-full" disabled={busy}>{busy ? 'Masuk…' : 'Masuk'}</button>
      </form>
      <ThemeSwitch />
    </main>
  );
}
