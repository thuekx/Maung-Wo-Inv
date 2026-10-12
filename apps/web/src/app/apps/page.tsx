'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { imgUrl, roleText, useFetch } from '@/lib/api';
import { useBranding } from '@/lib/brand';
import { ThemeToggle } from '@/lib/theme';
import { Icon, MarkM } from '@/components/icons';
import { AppTileIcon } from '@/components/AppTileIcon';
import { UserMenu } from '@/components/UserMenu';

interface LauncherApp { id: string; name: string; description: string; icon: string; iconUrl?: string | null; path: string }
interface HomeCfg { title: string; subtitle: string; backLabel: string; alwaysShow: boolean }
const fill = (t: string, name: string) => t.replace(/\{nama_depan\}/g, name.split(' ')[0]).replace(/\{nama\}/g, name);

/** Beranda "satu pintu" MAUNG: satu login, pilih aplikasi lewat ikon. Aplikasi lain berjalan di jalur domain yang sama (mis. /crm) dan memakai token yang sama. */
export default function AppsHome() {
  const { user, ready } = useAuth();
  const router = useRouter();
  const brand = useBranding();
  const { data, error } = useFetch<{ apps: LauncherApp[]; home: HomeCfg }>(user ? '/launcher' : null);

  useEffect(() => { if (ready && !user) router.replace('/login'); }, [ready, user, router]);
  useEffect(() => { if (user?.mustChangePassword) router.replace('/profile'); }, [user, router]);
  // hanya satu aplikasi (WO) → langsung masuk, kecuali Admin memilih "selalu tampilkan beranda"
  useEffect(() => { if (data && data.apps.length <= 1 && !data.home.alwaysShow) router.replace('/'); }, [data, router]);

  if (!user || !data) return <main className="grid min-h-screen place-items-center text-slate-500">{error ?? 'Memuat…'}</main>;
  return (
    <div className="min-h-screen">
      <header className="flex h-16 items-center gap-3 border-b-2 border-accent-500 bg-brand-900 px-4 text-white">
        {brand.logoMarkUrl
          ? <img src={imgUrl(brand.logoMarkUrl, { w: 160, trim: true })} alt="" className="h-10 w-10 object-contain" />
          : <MarkM size={30} />}
        <span className="font-display text-lg font-bold tracking-wide">{brand.companyName}</span>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <UserMenu />
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="font-display text-2xl font-bold text-brand-900">{fill(data.home.title, user.name)}</h1>
        {data.home.subtitle && <p className="mt-1 text-sm text-slate-500">{fill(data.home.subtitle, user.name)}</p>}
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {data.apps.map((a) => {
            const inner = (
              <>
                <span className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-accent-500/15 text-accent-600"><AppTileIcon icon={a.icon} iconUrl={a.iconUrl} size={28} /></span>
                <span className="text-sm font-semibold text-slate-800">{a.name}</span>
                {a.description && <span className="mt-1 text-xs text-slate-500">{a.description}</span>}
              </>
            );
            const cls = 'card flex flex-col items-start p-4 transition hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500';
            // aplikasi lain = aplikasi terpisah di jalur yang sama → navigasi penuh (bukan router Next milik WO)
            return a.path === '/' || a.id === 'admin' ? <Link key={a.id} href={a.path} className={cls}>{inner}</Link> : <a key={a.id} href={`${a.path}/`} className={cls}>{inner}</a>;
          })}
        </div>
      </main>
    </div>
  );
}
