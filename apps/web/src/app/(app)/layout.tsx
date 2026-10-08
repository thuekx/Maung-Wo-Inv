'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { fileUrl, ROLE_LABEL, useFetch } from '@/lib/api';
import { ThemeToggle } from '@/lib/theme';
import { useBranding } from '@/lib/brand';
import { Icon, IconName, MarkM } from '@/components/icons';
import { Avatar } from '@/components/ui';
import { SearchBox } from '@/components/SearchBox';

interface Item { href: string; label: string; icon: IconName; roles?: string[] }
const GROUPS: { title: string; items: Item[] }[] = [
  { title: 'Menu', items: [
    { href: '/', label: 'Dashboard', icon: 'dashboard' },
    { href: '/work-orders', label: 'Work Order', icon: 'clipboard' },
    { href: '/customers', label: 'Pelanggan', icon: 'users' },
    { href: '/inventory', label: 'Inventori & Aset', icon: 'box' },
    { href: '/purchase-orders', label: 'Purchase Order', icon: 'receipt', roles: ['ADMIN', 'GA', 'FIN'] },
  ] },
  { title: 'Data', items: [{ href: '/master', label: 'Master Data', icon: 'layers', roles: ['ADMIN', 'MKT', 'NOC', 'GA'] }] },
  { title: 'Sistem', items: [{ href: '/admin', label: 'Admin', icon: 'settings', roles: ['ADMIN'] }] },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, ready, logout } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const brand = useBranding();
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { data: dash } = useFetch<{ mineTotal: number }>(user ? '/dashboard' : null);

  useEffect(() => { try { setCollapsed(localStorage.getItem('maung_sidebar') === '1'); } catch { /* ignore */ } }, []);
  useEffect(() => { if (ready && !user) router.replace('/login'); }, [ready, user, router]);
  useEffect(() => { setMobile(false); setMenu(false); }, [path]);
  // password baru dari Admin: wajib diganti dulu
  useEffect(() => { if (user?.mustChangePassword && path !== '/profile') router.replace('/profile'); }, [user, path, router]);
  useEffect(() => {
    const click = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    window.addEventListener('mousedown', click);
    return () => window.removeEventListener('mousedown', click);
  }, []);
  if (!ready || !user) return <div className="p-8 text-slate-500">Memuat…</div>;

  const toggleCollapse = () => setCollapsed((c) => { try { localStorage.setItem('maung_sidebar', c ? '0' : '1'); } catch { /* ignore */ } return !c; });
  const active = (h: string) => (h === '/' ? path === '/' : path.startsWith(h));
  const tasks = dash?.mineTotal ?? 0;

  return (
    <div className="min-h-screen">
      {/* Top bar navy (panduan brand): logo · pencarian · tema · notifikasi · akun */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-16 items-center gap-3 border-b-2 border-accent-500 bg-brand-900 px-3 text-white sm:px-4">
        <button className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-200 hover:bg-white/10 lg:hidden" onClick={() => setMobile(true)} aria-label="Buka menu"><Icon name="menu" /></button>
        <button className="hidden h-10 w-10 items-center justify-center rounded-lg text-slate-200 hover:bg-white/10 lg:flex" onClick={toggleCollapse} aria-label={collapsed ? 'Perluas sidebar' : 'Ciutkan sidebar'}><Icon name="panel" /></button>
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label={brand.companyName}>
          {brand.logoMarkUrl
            ? <><img src={fileUrl(brand.logoMarkUrl)} alt="" className="h-10 w-10 object-contain" /><span className="hidden font-display text-xl font-bold tracking-wide sm:inline">{brand.companyName}</span></>
            : brand.logoUrl
              ? <img src={fileUrl(brand.logoUrl)} alt={brand.companyName} className="h-11 w-auto max-w-[220px] object-contain" />
              : <><MarkM size={30} /><span className="hidden font-display text-lg font-bold tracking-wide sm:inline">{brand.companyName}</span></>}
        </Link>
        <div className="mx-auto hidden min-w-0 flex-1 justify-center px-4 md:flex"><SearchBox /></div>
        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <ThemeToggle />
          <Link href="/work-orders" className="relative flex h-10 w-10 items-center justify-center rounded-lg text-slate-200 hover:bg-white/10" aria-label={`${tasks} tugas menunggu`} title={`${tasks} tugas menunggu Anda`}>
            <Icon name="bell" />
            {tasks > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-500 px-1 text-[10px] font-bold text-brand-900">{tasks > 99 ? '99+' : tasks}</span>}
          </Link>
          <div ref={menuRef} className="relative">
            <button className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-white/10" onClick={() => setMenu(!menu)} aria-haspopup="menu" aria-expanded={menu}>
              <Avatar name={user.name} size={32} />
              <span className="hidden text-left leading-tight sm:block"><span className="block text-sm font-medium">{user.name}</span><span className="block text-[11px] text-slate-300">{ROLE_LABEL[user.role] ?? user.role}</span></span>
              <Icon name="chevronDown" size={16} className="hidden text-slate-300 sm:block" />
            </button>
            {menu && (
              <div role="menu" className="absolute right-0 top-12 z-50 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-slate-700 shadow-xl">
                <div className="border-b border-slate-100 px-4 py-2"><div className="text-sm font-semibold text-slate-800">{user.name}</div><div className="truncate text-xs text-slate-500">{user.email}</div></div>
                <Link href="/profile" role="menuitem" className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-slate-100"><Icon name="user" size={16} /> Profil & Telegram</Link>
                <button role="menuitem" onClick={logout} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-slate-100"><Icon name="logout" size={16} /> Keluar</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {mobile && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMobile(false)} />}
      {/* Sidebar (TailAdmin): grup menu, bisa diciutkan, drawer di HP; aktif = penanda emas */}
      <aside className={`fixed bottom-0 left-0 top-16 z-40 overflow-y-auto border-r border-slate-200 bg-white px-3 py-4 transition-all duration-200 ${mobile ? 'translate-x-0' : '-translate-x-full'} w-64 lg:translate-x-0 ${collapsed ? 'lg:w-[76px]' : 'lg:w-64'}`}>
        {GROUPS.map((g) => {
          const items = g.items.filter((i) => !i.roles || i.roles.includes(user.role));
          if (!items.length) return null;
          return (
            <div key={g.title} className="mb-5">
              <div className={`subheader mb-2 px-3 ${collapsed ? 'lg:text-center' : ''}`}>{collapsed ? <span className="hidden lg:inline">•••</span> : null}<span className={collapsed ? 'lg:hidden' : ''}>{g.title}</span></div>
              <nav className="space-y-1">
                {items.map((n) => (
                  <Link key={n.href} href={n.href} title={collapsed ? n.label : undefined} className={`menu-item ${collapsed ? 'lg:justify-center lg:px-0' : ''} ${active(n.href) ? 'menu-item-active' : ''}`}>
                    {active(n.href) && <span className="absolute left-0 top-1.5 h-[calc(100%-12px)] w-[3px] rounded-r bg-accent-500" />}
                    <Icon name={n.icon} className={active(n.href) ? 'text-accent-600' : ''} />
                    <span className={collapsed ? 'lg:hidden' : ''}>{n.label}</span>
                  </Link>
                ))}
              </nav>
            </div>
          );
        })}
        {!collapsed && brand.tagline && <p className="mt-6 hidden px-3 font-display text-sm italic leading-snug text-accent-600 lg:block">{brand.tagline}</p>}
      </aside>

      <main className={`min-w-0 px-4 pb-10 pt-24 transition-all duration-200 sm:px-6 ${collapsed ? 'lg:pl-[100px]' : 'lg:pl-72'}`}>
        <div className="mb-4 md:hidden"><SearchBox variant="page" /></div>
        {children}
      </main>
    </div>
  );
}
