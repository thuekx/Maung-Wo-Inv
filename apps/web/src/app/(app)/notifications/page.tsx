'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, timeAgo } from '@/lib/api';
import { Column, DataTable } from '@/components/DataTable';
import { PageHeader } from '@/components/ui';

interface Item { id: string; subject: string; body: string; woId: string | null; readAt: string | null; createdAt: string }

export default function Notifications() {
  const [unread, setUnread] = useState('');
  const [rk, setRk] = useState(0);
  const cols: Column<Item>[] = [
    { key: 'dot', header: '', className: 'w-6', render: (n) => <span className={`inline-block h-2 w-2 rounded-full ${n.readAt ? 'bg-slate-300' : 'bg-accent-500'}`} title={n.readAt ? 'Sudah dibaca' : 'Belum dibaca'} /> },
    { key: 'subject', header: 'Notifikasi', render: (n) => <><div className={n.readAt ? 'text-slate-600' : 'font-semibold text-slate-800'}>{n.subject}</div><div className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs text-slate-500">{n.body.split('\n').slice(0, 3).join('\n')}</div></> },
    { key: 'createdAt', header: 'Waktu', sort: 'createdAt', className: 'whitespace-nowrap', render: (n) => <span title={new Date(n.createdAt).toLocaleString('id-ID')}>{timeAgo(n.createdAt)}</span> },
    { key: 'open', header: '', className: 'whitespace-nowrap', render: (n) => (n.woId ? <Link className="btn-link" href={`/work-orders/${n.woId}`} onClick={() => !n.readAt && api('/inbox/read', { body: { ids: [n.id] } }).then(() => window.dispatchEvent(new Event('inbox-changed'))).catch(() => {})}>Buka WO →</Link> : null) },
  ];
  return (
    <>
      <PageHeader pretitle="Akun" title="Notifikasi" sub="Pemberitahuan tahap WO dan tugas untuk Anda (90 hari terakhir)">
        <button className="btn-ghost" onClick={async () => { await api('/inbox/read', { body: { all: true } }); setRk((x) => x + 1); window.dispatchEvent(new Event('inbox-changed')); }}>Tandai semua dibaca</button>
        <Link href="/work-orders" className="btn">Buka WO saya</Link>
      </PageHeader>
      <DataTable<Item> path="/inbox" columns={cols} params={{ unread }} defaultSort="createdAt" refreshKey={rk} searchPlaceholder="Cari notifikasi…" empty="Belum ada notifikasi"
        filters={<select className="input w-44" value={unread} onChange={(e) => setUnread(e.target.value)} aria-label="Filter"><option value="">Semua</option><option value="1">Belum dibaca</option></select>} />
    </>
  );
}
