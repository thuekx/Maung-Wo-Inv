'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PasswordInput } from '@/components/PasswordInput';
import { useBranding } from '@/lib/brand';

/** Atur ulang password lewat tautan sekali pakai dari email/Telegram (lihat "Lupa password?" di halaman masuk). */
export default function ResetPassword() {
  const brand = useBranding();
  const [token, setToken] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setToken(new URLSearchParams(window.location.search).get('token') ?? ''); }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (pw !== pw2) { setErr('Konfirmasi password tidak sama.'); return; }
    setBusy(true);
    try { await api('/auth/reset', { body: { token, password: pw } }); setDone(true); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-10">
      <form onSubmit={submit} className="card w-full max-w-md space-y-4 p-7 shadow-lg">
        <div><h1 className="font-display text-2xl font-bold text-brand-900">Atur ulang password</h1><p className="text-sm text-slate-500">{brand.companyName}</p></div>
        {done ? (
          <><p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800" role="status">Password berhasil diubah. Silakan masuk dengan password baru.</p>
            <Link href="/login" className="btn-secondary block w-full !py-2.5 text-center">Ke halaman masuk</Link></>
        ) : !token ? (
          <><p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Tautan tidak lengkap. Minta tautan baru lewat &quot;Lupa password?&quot;.</p><Link href="/login" className="btn-link">Kembali</Link></>
        ) : (
          <>
            <PasswordInput className="input" placeholder="Password baru (min. 8 karakter)" value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete="new-password" minLength={8} />
            <PasswordInput className="input" placeholder="Ulangi password baru" value={pw2} onChange={(e) => setPw2(e.target.value)} required autoComplete="new-password" />
            {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{err}</p>}
            <button className="btn-secondary w-full !py-2.5" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan password'}</button>
          </>
        )}
      </form>
    </main>
  );
}
