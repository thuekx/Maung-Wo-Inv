'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { API } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useBranding } from '@/lib/brand';
import { fileUrl } from '@/lib/api';

/** Info aset dari label QR — dapat dibuka siapa saja (tanpa login); data pelanggan tidak ditampilkan. */
export default function AssetInfo({ params }: { params: Promise<{ sn: string }> }) {
  const { sn } = use(params);
  const serial = decodeURIComponent(sn);
  const brand = useBranding();
  const { user } = useAuth();
  const [a, setA] = useState<any | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    fetch(`${API}/api/public/asset/${encodeURIComponent(serial)}`).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? 'Gagal memuat'); setA(j); }).catch((e) => setErr(e.message));
  }, [serial]);
  const fill = (t: string) => t.replace(/\{KODE\}/g, a?.assetCode || a?.serialNumber || '').replace(/\{BARANG\}/g, a?.name ?? '').replace(/\{MERK\}/g, a && (a.brand || a.model) ? ` (${[a.brand, a.model].filter(Boolean).join(' ')})` : '').replace(/\{PERUSAHAAN\}/g, a?.company ?? '').replace(/\{LOKASI\}/g, a?.location ? `, berada di ${a.location}` : '');
  const sentence = a ? fill(a.info?.intro ?? '{KODE} adalah {BARANG}{MERK} milik {PERUSAHAAN}{LOKASI}.') : '';
  const footer = a ? fill(a.info?.footer ?? '') : '';
  const c = a?.info?.contacts ?? {};
  const digits = (x: string) => { const d = x.replace(/\D/g, ''); return d.startsWith('0') ? `62${d.slice(1)}` : d; };
  const links: { label: string; icon: string; href: string }[] = [
    ...(c.email ? [{ label: 'Email', icon: '✉️', href: `mailto:${c.email}` }] : []),
    ...(c.whatsapp ? [{ label: 'WhatsApp', icon: '💬', href: `https://wa.me/${digits(c.whatsapp)}` }] : []),
    ...(c.telegram ? [{ label: 'Telegram', icon: '✈️', href: /^https?:/.test(c.telegram) ? c.telegram : `https://t.me/${c.telegram.replace(/^@/, '')}` }] : []),
    ...(c.facebook ? [{ label: 'Facebook', icon: '📘', href: /^https?:/.test(c.facebook) ? c.facebook : `https://facebook.com/${c.facebook}` }] : []),
    ...(c.instagram ? [{ label: 'Instagram', icon: '📸', href: /^https?:/.test(c.instagram) ? c.instagram : `https://instagram.com/${c.instagram.replace(/^@/, '')}` }] : []),
  ];
  const tone = !a ? '' : a.status === 'DAMAGED' || a.status === 'SCRAP' ? 'bg-red-100 text-red-800' : a.status === 'INSTALLED' || a.status === 'IN_USE' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800';
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-8">
      <div className="mb-4 text-center">
        {brand.logoStackedUrl || brand.logoUrl ? <img src={fileUrl((brand.logoStackedUrl || brand.logoUrl)!)} alt={brand.companyName} className="mx-auto h-16 w-auto object-contain" /> : <div className="font-display text-2xl font-bold">{brand.companyName}</div>}
      </div>
      <div className="card space-y-3">
        {err && <p className="text-center text-red-600">{err}<br /><span className="text-xs text-slate-500">SN: {serial}</span></p>}
        {!a && !err && <p className="text-center text-slate-500">Memuat…</p>}
        {a && (
          <>
            <div className="text-center">
              <div className="subheader">Informasi aset</div>
              <h1 className="mt-1 font-display text-2xl font-bold">{a.assetCode || a.serialNumber}</h1>
              <span className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>{a.statusLabel}</span>
            </div>
            <p className="rounded-lg bg-slate-50 p-3 text-sm leading-relaxed dark:bg-slate-800">{sentence}</p>
            <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5 text-sm">
              <dt className="text-slate-500">Nomor seri</dt><dd className="font-mono">{a.serialNumber}</dd>
              {a.assetCode && <><dt className="text-slate-500">Kode aset</dt><dd className="font-mono">{a.assetCode}</dd></>}
              <dt className="text-slate-500">Barang</dt><dd>{a.name}</dd>
              <dt className="text-slate-500">Kategori</dt><dd>{a.category}</dd>
              {(a.brand || a.model) && <><dt className="text-slate-500">Merk / tipe</dt><dd>{[a.brand, a.model].filter(Boolean).join(' / ')}</dd></>}
              {a.plateNumber && <><dt className="text-slate-500">Nomor polisi</dt><dd>{a.plateNumber}</dd></>}
              {a.location && <><dt className="text-slate-500">Lokasi</dt><dd>{a.location}</dd></>}
              {a.condition && <><dt className="text-slate-500">Kondisi</dt><dd>{a.condition}</dd></>}
              {a.notes && <><dt className="text-slate-500">Catatan</dt><dd>{a.notes}</dd></>}
            </dl>
            {footer && <p className="text-center text-xs text-slate-500">{footer}</p>}
            {links.length > 0 && <div className="flex flex-wrap justify-center gap-2 pt-1">{links.map((l) => <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="btn-ghost">{l.icon} {l.label}</a>)}</div>}
          </>
        )}
        {user && ['ADMIN', 'GA'].includes(user.role) && <Link href="/inventory" className="btn-ghost w-full">Buka di Inventori & Aset</Link>}
      </div>
      <p className="mt-4 text-center text-xs text-slate-400">{a?.appName ?? 'MAUNG | SuperApps'}</p>
    </main>
  );
}
