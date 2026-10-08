'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { ROLE_LABEL } from '@/lib/api';
import { ThemeSwitch } from '@/lib/theme';
import { useBranding } from '@/lib/photo';
import { fileUrl } from '@/lib/api';

const NAV = [
  { href: '/', label: 'Dashboard', icon: '▦' },
  { href: '/work-orders', label: 'Work Order', icon: '✎' },
  { href: '/customers', label: 'Pelanggan', icon: '☺' },
  { href: '/inventory', label: 'Inventori & Aset', icon: '▤' },
  { href: '/purchase-orders', label: 'Purchase Order', icon: '⛟', roles: ['ADMIN', 'PROC', 'GA', 'FIN'] },
  { href: '/admin', label: 'Admin', icon: '⚙', roles: ['ADMIN'] },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, ready, logout } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const brand = useBranding();

  useEffect(() => { if (ready && !user) router.replace('/login'); }, [ready, user, router]);
  useEffect(() => setOpen(false), [path]);
  if (!ready || !user) return <div className="p-8 text-slate-500">Memuat…</div>;

  const nav = NAV.filter((n) => !n.roles || n.roles.includes(user.role));
  const active = (h: string) => (h === '/' ? path === '/' : path.startsWith(h));

  return (
    <div className="min-h-screen md:flex">
      <header className="flex items-center justify-between bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 text-white md:hidden">
        <b>L1V WO</b>
        <button className="btn-ghost" onClick={() => setOpen(!open)}>☰</button>
      </header>
      <aside className={`${open ? 'block' : 'hidden'} w-full shrink-0 border-r bg-white md:sticky md:top-0 md:block md:h-screen md:w-60 md:overflow-y-auto`}>
        <div className="hidden p-4 md:block">
          {brand.logoUrl && <img src={fileUrl(brand.logoUrl)} alt="" className="mb-1 h-10 w-auto object-contain" />}
          <div className="bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-lg font-extrabold text-transparent">{brand.companyName}</div>
          <div className="text-xs text-slate-500">Work Order &amp; Inventory</div>
        </div>
        <nav className="space-y-1 px-2 pb-2">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${active(n.href) ? 'bg-gradient-to-r from-blue-600 to-violet-600 font-semibold text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}>
              <span className="w-5 text-center">{n.icon}</span>{n.label}
            </Link>
          ))}
        </nav>
        <div className="border-t p-3 text-sm">
          <Link href="/profile" className="block font-medium hover:underline">{user.name}</Link>
          <div className="text-xs text-slate-500">{ROLE_LABEL[user.role] ?? user.role}</div>
          <ThemeSwitch className="mt-2" />
          <br />
          <button onClick={logout} className="mt-2 text-xs text-red-600 hover:underline">Keluar</button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
