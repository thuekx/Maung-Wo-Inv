'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { roleText } from '@/lib/api';
import { ThemeToggle } from '@/lib/theme';
import { Icon } from '@/components/icons';
import { Avatar } from '@/components/ui';

/** Menu pengguna (foto, nama, Profil & password, Keluar) untuk halaman di luar shell WO: beranda /apps dan Pusat Admin. */
export function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const click = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', click); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', click); document.removeEventListener('keydown', key); };
  }, []);
  if (!user) return null;
  return (
    <div ref={ref} className="relative">
      <button className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-white/10" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        <Avatar name={user.name} size={32} url={user.avatarUrl} />
        <span className="hidden text-left leading-tight sm:block"><span className="block text-sm font-medium">{user.name}</span><span className="block text-[11px] text-slate-300">{roleText(user)}</span></span>
        <Icon name="chevronDown" size={16} className="hidden text-slate-300 sm:block" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-12 z-50 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-slate-700 shadow-xl">
          <div className="border-b border-slate-100 px-4 py-2"><div className="text-sm font-semibold text-slate-800">{user.name}</div><div className="truncate text-xs text-slate-500">{user.email}</div></div>
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 sm:hidden"><span className="text-xs text-slate-500">Tema</span><ThemeToggle /></div>
          <Link href="/profile" role="menuitem" className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-slate-100"><Icon name="user" size={16} /> Pengaturan profil</Link>
          <button role="menuitem" onClick={logout} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-slate-100"><Icon name="logout" size={16} /> Keluar</button>
        </div>
      )}
    </div>
  );
}
