'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, timeAgo } from '@/lib/api';
import { Icon } from './icons';
import { Tip } from './Tip';

interface Item { id: string; subject: string; body: string; woId: string | null; readAt: string | null; createdAt: string }

/** Lonceng: daftar notifikasi terbaru (dibaca/belum) + "Lihat semua notifikasi". Menyegarkan tiap 60 dtk dan saat dibuka. */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ items: Item[]; unread: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api('/inbox/summary')); } catch { /* sesi habis ditangani api() */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    const vis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('inbox-changed', load); // halaman Notifikasi menandai dibaca → lonceng ikut segar
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); window.removeEventListener('inbox-changed', load); };
  }, [load]);
  useEffect(() => {
    if (!open) return;
    load();
    const click = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', click); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', click); window.removeEventListener('keydown', key); };
  }, [open, load]);

  const unread = data?.unread ?? 0;
  const go = async (n: Item) => {
    setOpen(false);
    if (!n.readAt) { api('/inbox/read', { body: { ids: [n.id] } }).then(load).catch(() => {}); }
    router.push(n.woId ? `/work-orders/${n.woId}` : '/notifications');
  };
  const markAll = async () => { await api('/inbox/read', { body: { all: true } }).catch(() => {}); load(); };

  return (
    <div ref={ref} className="relative">
      <Tip label={unread ? `Notifikasi — ${unread} belum dibaca` : 'Notifikasi'} align="right" disabled={open}>
        <button type="button" onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open} aria-label={data ? `Notifikasi, ${unread} belum dibaca` : 'Notifikasi'}
          className="relative flex h-10 w-10 items-center justify-center rounded-lg text-slate-200 hover:bg-white/10">
          <Icon name="bell" />
          {unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-500 px-1 text-[10px] font-bold text-brand-900">{unread > 99 ? '99+' : unread}</span>}
        </button>
      </Tip>
      {open && (
        <div role="dialog" aria-label="Notifikasi" className="fixed inset-x-2 top-[68px] z-50 overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-700 shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[24rem]">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="font-semibold text-slate-800">Notifikasi{unread > 0 && <span className="ml-2 rounded-full bg-accent-100 px-2 py-0.5 text-xs font-semibold text-brand-900">{unread} baru</span>}</h2>
            <button type="button" className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-40" disabled={!unread} onClick={markAll}>Tandai semua dibaca</button>
          </div>
          <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
            {data?.items.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => go(n)} className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 ${n.readAt ? '' : 'bg-accent-50/60'}`}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-accent-500'}`} aria-label={n.readAt ? 'sudah dibaca' : 'belum dibaca'} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm leading-snug ${n.readAt ? 'text-slate-600' : 'font-semibold text-slate-800'}`}>{n.subject}</span>
                    <span className="mt-0.5 line-clamp-2 block whitespace-pre-line text-xs text-slate-500">{n.body.split('\n').slice(0, 2).join('\n')}</span>
                    <span className="mt-1 block text-[11px] text-slate-400">{timeAgo(n.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
            {data && data.items.length === 0 && <li className="px-4 py-10 text-center text-sm text-slate-500">Belum ada notifikasi</li>}
            {!data && loading && <li className="px-4 py-10 text-center text-sm text-slate-500">Memuat…</li>}
          </ul>
          <div className="grid grid-cols-2 gap-2 border-t border-slate-100 bg-slate-50 p-2">
            <Link href="/notifications" onClick={() => setOpen(false)} className="btn-secondary !py-2 !text-xs">Lihat semua notifikasi</Link>
            <Link href="/work-orders" onClick={() => setOpen(false)} className="btn-ghost !py-2 !text-xs">WO saya <Icon name="arrowRight" size={14} /></Link>
          </div>
        </div>
      )}
    </div>
  );
}
