'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { fileUrl, getAct, ROLE_LABEL, roleText, setAct, SUBROLE_LABEL } from '@/lib/api';
import { ThemeToggle } from '@/lib/theme';
import { useBranding } from '@/lib/brand';
import { Icon, IconName, MarkM } from '@/components/icons';
import { Avatar } from '@/components/ui';
import { SearchBox } from '@/components/SearchBox';
import { NotificationBell } from '@/components/NotificationBell';
import { Tip } from '@/components/Tip';
import { Select } from '@/components/Select';

interface Item { href: string; label: string; icon: IconName; roles?: string[]; /** supervisor/manager divisi mana pun juga boleh */ lead?: boolean }
const GROUPS: { title: string; items: Item[] }[] = [
  { title: 'Menu', items: [
    { href: '/', label: 'Dashboard', icon: 'dashboard' },
    { href: '/work-orders', label: 'Work Order', icon: 'clipboard' },
    { href: '/subscriptions', label: 'Form Berlangganan', icon: 'clipboard', roles: ['ADMIN', 'MKT', 'FIN', 'NOC'] },
    { href: '/my-stock', label: 'Stok Saya', icon: 'box', roles: ['FOC'] },
    { href: '/customers', label: 'Pelanggan', icon: 'users', roles: ['ADMIN', 'MKT', 'NOC', 'FIN', 'GA'] },
    { href: '/inventory', label: 'Inventori & Aset', icon: 'box', roles: ['ADMIN', 'GA'] },
    { href: '/purchase-requests', label: 'Purchase Request', icon: 'receipt', roles: ['ADMIN', 'GA', 'FIN'], lead: true },
    { href: '/purchase-orders', label: 'Purchase Order', icon: 'receipt', roles: ['ADMIN', 'GA', 'FIN'] },
  ] },
  { title: 'Data', items: [{ href: '/master', label: 'Master Data', icon: 'layers', roles: ['ADMIN', 'MKT', 'GA'] }] },
  { title: 'Sistem', items: [{ href: '/admin', label: 'Admin', icon: 'settings', roles: ['ADMIN'] }, { href: '/api-msradius', label: 'API MSRadius', icon: 'layers', roles: ['ADMIN'] }] },
];

const canSee = (i: Item, u: { role: string; subRole?: string }) => !i.roles || i.roles.includes(u.role) || (!!i.lead && (u.subRole === 'SUPERVISOR' || u.subRole === 'MANAGER'));

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, ready, logout } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const brand = useBranding();
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { try { setCollapsed(localStorage.getItem('maung_sidebar') === '1'); } catch { /* ignore */ } }, []);
  useEffect(() => { if (ready && !user) router.replace('/login'); }, [ready, user, router]);
  useEffect(() => { setMobile(false); setMenu(false); }, [path]);
  // password baru dari Admin: wajib diganti dulu
  useEffect(() => { if (user?.mustChangePassword && path !== '/profile') router.replace('/profile'); }, [user, path, router]);
  // halaman di luar hak peran → kembali ke dashboard (API tetap menolak walau URL diketik)
  useEffect(() => {
    if (!user) return;
    const it = GROUPS.flatMap((g) => g.items).find((i) => i.href !== '/' && path.startsWith(i.href));
    if (it && !canSee(it, user)) router.replace('/');
  }, [user, path, router]);
  useEffect(() => {
    const click = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    window.addEventListener('mousedown', click);
    return () => window.removeEventListener('mousedown', click);
  }, []);
  if (!ready || !user) return <div className="p-8 text-slate-500">Memuat…</div>;

  const toggleCollapse = () => setCollapsed((c) => { try { localStorage.setItem('maung_sidebar', c ? '0' : '1'); } catch { /* ignore */ } return !c; });
  const active = (h: string) => (h === '/' ? path === '/' : path.startsWith(h));

  return (
    <div className="min-h-screen">
      {/* Top bar navy (panduan brand): logo · pencarian · tema · notifikasi · akun */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-16 items-center gap-3 border-b-2 border-accent-500 bg-brand-900 px-3 text-white sm:px-4">
        <button className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-200 hover:bg-white/10 lg:hidden" onClick={() => setMobile(true)} aria-label="Buka menu"><Icon name="menu" /></button>
        <span className="hidden lg:flex"><Tip label={collapsed ? 'Perluas sidebar' : 'Ciutkan sidebar'} align="left"><button className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-200 hover:bg-white/10" onClick={toggleCollapse} aria-label={collapsed ? 'Perluas sidebar' : 'Ciutkan sidebar'}><Icon name="panel" /></button></Tip></span>
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label={brand.companyName}>
          {brand.logoMarkUrl
            ? <><img src={fileUrl(brand.logoMarkUrl)} alt="" className="h-10 w-10 object-contain" /><span className="hidden font-display text-xl font-bold tracking-wide sm:inline">{brand.companyName}</span></>
            : brand.logoUrl
              ? <img src={fileUrl(brand.logoUrl)} alt={brand.companyName} className="h-11 w-auto max-w-[220px] object-contain" />
              : <><MarkM size={30} /><span className="hidden font-display text-lg font-bold tracking-wide sm:inline">{brand.companyName}</span></>}
        </Link>
        <div className="mx-auto hidden min-w-0 flex-1 justify-center px-4 md:flex"><SearchBox /></div>
        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <span className="hidden sm:block"><ThemeToggle /></span>
          <NotificationBell />
          <div ref={menuRef} className="relative">
            <button className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-white/10" onClick={() => setMenu(!menu)} aria-haspopup="menu" aria-expanded={menu}>
              <Avatar name={user.name} size={32} url={user.avatarUrl} />
              <span className="hidden text-left leading-tight sm:block"><span className="block text-sm font-medium">{user.name}</span><span className="block text-[11px] text-slate-300">{roleText(user)}</span></span>
              <Icon name="chevronDown" size={16} className="hidden text-slate-300 sm:block" />
            </button>
            {menu && (
              <div role="menu" className="absolute right-0 top-12 z-50 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-slate-700 shadow-xl">
                <div className="border-b border-slate-100 px-4 py-2"><div className="text-sm font-semibold text-slate-800">{user.name}</div><div className="truncate text-xs text-slate-500">{user.email}</div></div>
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 sm:hidden"><span className="text-xs text-slate-500">Tema</span><ThemeToggle /></div>
                {(user.role === 'ADMIN' || user.realAdmin) && <ActAs acting={user.realAdmin ? { role: user.role, sub: user.subRole } : null} />}
                <Link href="/profile" role="menuitem" className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-slate-100"><Icon name="user" size={16} /> Profil & Telegram</Link>
                <button role="menuitem" onClick={logout} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-slate-100"><Icon name="logout" size={16} /> Keluar</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {user.realAdmin && (
        <div className="fixed inset-x-0 top-16 z-30 flex items-center justify-center gap-3 bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900">
          Anda bertindak sebagai <b>{roleText(user)}</b> (akun Admin) — izin & menu mengikuti peran ini.
          <button className="underline" onClick={() => { setAct(null); window.location.href = '/'; }}>Kembali sebagai Admin</button>
        </div>
      )}
      {mobile && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMobile(false)} />}
      {/* Sidebar (TailAdmin): grup menu, bisa diciutkan, drawer di HP; aktif = penanda emas */}
      <aside className={`fixed bottom-0 left-0 top-16 z-40 overflow-y-auto border-r border-slate-200 bg-white px-3 py-4 transition-all duration-200 ${mobile ? 'translate-x-0' : '-translate-x-full'} w-64 lg:translate-x-0 ${collapsed ? 'lg:w-[76px]' : 'lg:w-64'}`}>
        <div className={`mb-4 flex items-center gap-3 rounded-xl bg-brand-50 px-3 py-3 ${collapsed ? 'lg:justify-center lg:px-0' : ''}`}>
          <Avatar name={user.name} size={36} url={user.avatarUrl} />
          <div className={`min-w-0 leading-tight ${collapsed ? 'lg:hidden' : ''}`}>
            <div className="text-[11px] text-slate-500">Selamat datang,</div>
            <div className="truncate text-sm font-semibold text-brand-900">{user.name}</div>
            <div className="truncate text-[11px] text-accent-700">{roleText(user)}</div>
          </div>
        </div>
        {GROUPS.map((g) => {
          const items = g.items.filter((i) => canSee(i, user));
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
        {user.realAdmin && <div className="h-5" />}
        <div className="mb-4 md:hidden"><SearchBox variant="page" /></div>
        {children}
      </main>
    </div>
  );
}

/** Admin: pilih peran (+ sub-role) untuk menguji alur seolah-olah akun tersebut. */
function ActAs({ acting }: { acting: { role: string; sub: string } | null }) {
  const [role, setRole] = useState(acting?.role ?? getAct()?.role ?? 'NOC');
  const [sub, setSub] = useState(acting?.sub ?? getAct()?.sub ?? 'SUPERVISOR');
  return (
    <div className="border-b border-slate-100 px-4 py-2">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Bertindak sebagai</div>
      <div className="flex gap-1">
        <Select className="input !py-1 text-xs" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Peran">
          {['MKT', 'NOC', 'FOC', 'GA', 'FIN'].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </Select>
        <Select className="input !py-1 text-xs" value={sub} onChange={(e) => setSub(e.target.value)} aria-label="Sub-role">
          {Object.entries(SUBROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>
      <button className="btn mt-1.5 w-full !py-1 text-xs" onClick={() => { setAct({ role, sub }); window.location.href = '/'; }}>Terapkan</button>
    </div>
  );
}
