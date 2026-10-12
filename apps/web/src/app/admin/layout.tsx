'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { imgUrl } from '@/lib/api';
import { useBranding } from '@/lib/brand';
import { ThemeToggle } from '@/lib/theme';
import { Icon, MarkM } from '@/components/icons';
import { Avatar } from '@/components/ui';

/** Pusat Admin: halaman tersendiri (bukan di dalam menu Work Order) — pengaturan platform + per aplikasi, dibuka dari ikon Admin di beranda. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, ready, logout } = useAuth();
  const router = useRouter();
  const brand = useBranding();
  useEffect(() => { if (ready && !user) router.replace('/login'); }, [ready, user, router]);
  if (!user) return <main className="grid min-h-screen place-items-center text-slate-500">Memuat…</main>;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b-2 border-accent-500 bg-brand-900 px-4 text-white">
        <Link href="/apps" className="flex items-center gap-2">
          {brand.logoMarkUrl ? <img src={imgUrl(brand.logoMarkUrl, { w: 160, trim: true })} alt="" className="h-10 w-10 object-contain" /> : <MarkM size={30} />}
          <span className="font-display text-lg font-bold tracking-wide">{brand.companyName}</span>
        </Link>
        <span className="hidden rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider sm:inline">Pusat Admin</span>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/apps" className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm text-slate-200 hover:bg-white/10"><Icon name="layers" size={16} /> <span className="hidden sm:inline">Menu Utama</span></Link>
          <ThemeToggle />
          <span className="hidden items-center gap-2 sm:flex"><Avatar name={user.name} size={32} url={user.avatarUrl} /><span className="text-sm font-medium">{user.name}</span></span>
          <button className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm text-slate-200 hover:bg-white/10" onClick={logout}><Icon name="logout" size={16} /> <span className="hidden sm:inline">Keluar</span></button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
