'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Halaman ini pindah ke Pusat Admin (/admin); alamat lama dialihkan. */
export default function Moved() {
  const router = useRouter();
  useEffect(() => { try { localStorage.setItem('maung_admin_sec2', 'apimsradius'); } catch { /* abaikan */ } router.replace('/admin'); }, [router]);
  return <p className="text-slate-500">Mengalihkan ke Pusat Admin…</p>;
}
