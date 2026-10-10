'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api, fmtDate, useFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { toast } from '@/lib/dialog';
import { Badge, ErrorMsg, PageHeader } from '@/components/ui';

const arr = (x: any): any[] => (Array.isArray(x) ? x : Array.isArray(x?.data) ? x.data : Array.isArray(x?.items) ? x.items : Array.isArray(x?.templates) ? x.templates : []);
const Json = ({ v }: { v: unknown }) => <pre className="max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">{JSON.stringify(v, null, 2)}</pre>;
const Err = ({ p }: { p: any }) => <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{p?.httpStatus ? `HTTP ${p.httpStatus} — ` : ''}{p?.error ?? 'Gagal memuat'}</p>;
const delivTone = (s?: string | null) => (s === 'read' || s === 'delivered' ? 'green' : s === 'failed' ? 'red' : 'slate') as any;

/** Halaman Kanca (khusus Admin, baca-saja): workspace, channel, saldo, template WABA, riwayat pesan, status broadcast, katalog endpoint. */
export default function ApiKanca() {
  const { user } = useAuth();
  const { data, error, reload, loading } = useFetch<any>(user?.role === 'ADMIN' ? '/admin/kanca/overview' : null);
  const [bid, setBid] = useState('');
  const [bres, setBres] = useState<any>(null);
  const [berr, setBerr] = useState('');
  if (user && user.role !== 'ADMIN') return <ErrorMsg>Khusus Admin</ErrorMsg>;
  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  if (!data) return <p className="text-slate-500">Memuat…</p>;
  const c = data.config, p = data.parts;
  const lookup = async () => { setBerr(''); setBres(null); try { setBres(await api(`/admin/kanca/broadcast/${encodeURIComponent(bid.trim())}`)); } catch (e) { setBerr((e as Error).message); } };
  const pick = async (id: string) => { try { await api('/admin/kanca/template', { method: 'PUT', body: { templateId: id } }); toast.success('Template notifikasi dipilih'); reload(); } catch (e) { toast.error((e as Error).message); } };
  const info = p?.info?.ok ? (p.info.data as any) : null;
  const channels = arr(info?.channels ?? info?.inboxes);
  const wallet = p?.wallet?.ok ? (p.wallet.data as any) : null;
  const templates = p?.templates?.ok ? arr(p.templates.data) : [];
  const messages = p?.messages?.ok ? arr((p.messages.data as any)?.messages ?? p.messages.data) : [];
  return (
    <>
      <PageHeader pretitle="Sistem" title="API Kanca" sub={`WhatsApp Business (WABA) lewat ${c.baseUrl} — halaman baca-saja, tidak mengirim pesan`}>
        <button className="btn-ghost" onClick={reload} disabled={loading}>{loading ? 'Memuat…' : '↻ Muat ulang'}</button>
      </PageHeader>

      <div className="card mb-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Koneksi</h2>
          <Badge tone={c.active ? 'green' : 'amber'}>{c.active ? 'Kanca dipilih sebagai penyedia' : `Penyedia aktif: ${c.provider}`}</Badge>
          <Badge tone={c.enabled ? 'green' : 'amber'}>Kirim WhatsApp: {c.enabled ? 'AKTIF' : 'NONAKTIF'}</Badge>
        </div>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[['URL dasar', c.baseUrl], ['Workspace ID', c.workspaceId || '-'], ['API key', c.tokenSet ? c.tokenHint : 'belum diisi'], ['Template notifikasi', c.templateId || '— (teks bebas)']].map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="break-all font-mono text-xs">{v}</dd></div>)}
        </dl>
        {!data.ready && <p className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800">{c.active ? 'API key atau Workspace ID belum diisi' : 'Penyedia WhatsApp belum diatur ke Kanca'} — atur di <Link className="underline" href="/admin">Admin → Pengaturan → WhatsApp</Link> (Penyedia: Kanca, Workspace ID, API key <code>ib_…</code>). Setelah itu halaman ini menampilkan data akun Anda.</p>}
      </div>

      {data.ready && (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <div className="card space-y-2">
            <h2 className="font-semibold">Saldo wallet</h2>
            {wallet ? <div className="text-3xl font-bold text-brand-900">Rp {Number(wallet.balanceIdr ?? 0).toLocaleString('id-ID')}<span className="ml-2 text-sm font-normal text-slate-500">{wallet.currency}</span></div> : <Err p={p?.wallet} />}
            <p className="text-xs text-slate-500">Saldo dipotong per pesan saat benar-benar dikirim (bukan saat status <i>queued</i>); pesan gagal/undeliverable di-refund otomatis. Tarif berbeda per kategori template (UTILITY / AUTHENTICATION / MARKETING).</p>
          </div>
          <div className="card space-y-2">
            <h2 className="font-semibold">Workspace & channel</h2>
            {p?.info?.ok ? (
              <>
                <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">{[['Nama', info?.name ?? info?.workspace?.name], ['ID/slug', info?.slug ?? info?.id ?? info?.workspace?.slug], ['Status', info?.status ?? info?.workspace?.status]].filter(([, v]) => v).map(([k, v]) => <div key={k as string}><dt className="text-xs text-slate-500">{k}</dt><dd>{String(v)}</dd></div>)}</dl>
                {channels.length ? <ul className="space-y-1 text-sm">{channels.map((ch: any, i: number) => <li key={ch.id ?? i} className="flex flex-wrap items-center gap-2 rounded border px-2 py-1"><Badge>{ch.type ?? ch.channel_type ?? ch.channel ?? 'channel'}</Badge><span>{ch.name ?? ch.displayName ?? ch.phoneNumber ?? ch.externalId ?? ''}</span>{(ch.status ?? ch.connected) !== undefined && <Badge tone={ch.status === 'connected' || ch.connected === true ? 'green' : 'amber'}>{String(ch.status ?? (ch.connected ? 'connected' : 'disconnected'))}</Badge>}{ch.id && <code className="ml-auto break-all text-[10px] text-slate-500">{ch.id}</code>}</li>)}</ul> : <p className="text-sm text-slate-400">Tidak ada daftar channel di respons.</p>}
                <details><summary className="cursor-pointer text-xs text-slate-500">Lihat JSON asli</summary><Json v={p.info.data} /></details>
              </>
            ) : <Err p={p?.info} />}
          </div>

          <div className="card space-y-2 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Template WABA ({templates.length})</h2><span className="text-xs text-slate-500">Hanya <b>APPROVED</b> yang boleh dikirim di luar jendela 24 jam. Pilih satu sebagai template notifikasi Maung.</span></div>
            {!p?.templates?.ok ? <Err p={p?.templates} /> : !templates.length ? <p className="text-sm text-slate-400">Belum ada template — buat & ajukan di dashboard Kanca.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th className="py-1 pr-3">Nama</th><th className="pr-3">Status</th><th className="pr-3">Kategori</th><th className="pr-3">Isi</th><th className="pr-3">ID (templateId)</th><th /></tr></thead><tbody className="divide-y">
                {templates.map((t: any) => { const st = t.wabaStatus ?? t.status; const body = t.body ?? t.bodyText ?? t.content ?? t.components?.find?.((x: any) => x.type === 'BODY')?.text ?? ''; return (
                  <tr key={t.id} className="align-top"><td className="py-1.5 pr-3 font-medium">{t.name}</td><td className="pr-3"><Badge tone={st === 'APPROVED' ? 'green' : st === 'REJECTED' ? 'red' : 'amber'}>{st ?? '-'}</Badge></td><td className="pr-3 text-xs">{t.category ?? '-'}</td><td className="max-w-xs whitespace-pre-wrap pr-3 text-xs text-slate-600">{body || '-'}</td><td className="pr-3"><code className="break-all text-[10px]">{t.id}</code></td>
                    <td className="whitespace-nowrap">{c.templateId === t.id ? <Badge tone="green">dipakai notifikasi</Badge> : st === 'APPROVED' ? <button className="btn-ghost !px-2 !py-0.5 !text-xs" onClick={() => pick(t.id)}>Pakai</button> : null}</td></tr>); })}
              </tbody></table></div>
            )}
          </div>

          <div className="card space-y-2 lg:col-span-2">
            <h2 className="font-semibold">Pesan terkirim terbaru</h2>
            {!p?.messages?.ok ? <Err p={p?.messages} /> : !messages.length ? <p className="text-sm text-slate-400">Belum ada pesan.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th className="py-1 pr-3">Waktu</th><th className="pr-3">Nomor</th><th className="pr-3">Isi</th><th className="pr-3">Status</th><th>Delivery</th></tr></thead><tbody className="divide-y">
                {messages.map((m: any, i: number) => <tr key={m.messageId ?? i} className="align-top"><td className="whitespace-nowrap py-1.5 pr-3 text-xs">{fmtDate(m.sentAt ?? m.createdAt)}</td><td className="pr-3 font-mono text-xs">{m.phoneNumber}</td><td className="max-w-md whitespace-pre-wrap pr-3 text-xs text-slate-600">{m.text ?? '-'}{m.error && <span className="block text-red-600">{String(m.error)}</span>}</td><td className="pr-3"><Badge tone={m.status === 'failed' ? 'red' : 'slate'}>{m.status}</Badge></td><td><Badge tone={delivTone(m.deliveryStatus)}>{m.deliveryStatus ?? '-'}</Badge></td></tr>)}
              </tbody></table></div>
            )}
            <p className="text-xs text-slate-500"><b>sent</b> = diterima Meta, belum tentu sampai; kepastian ada di <b>delivered/read</b>. 20 pesan terbaru.</p>
          </div>
        </div>
      )}

      {data.ready && (
        <div className="card mt-4 space-y-2">
          <h2 className="font-semibold">Cek status broadcast</h2>
          <div className="flex flex-wrap gap-2"><input className="input min-w-0 flex-1" placeholder="broadcastId (UUID) atau nama broadcast, mis. Maung 2026-10-10T…" value={bid} onChange={(e) => setBid(e.target.value)} /><button className="btn" disabled={!bid.trim()} onClick={lookup}>Cek</button></div>
          {berr && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{berr}</p>}
          {bres && <><p className="text-sm">Status <b>{bres.status}</b> · total {bres.total} · terkirim {bres.sent} · gagal {bres.failed} · menunggu {bres.pending}</p><Json v={bres} /></>}
        </div>
      )}

      <div className="card mt-4 space-y-2">
        <h2 className="font-semibold">Katalog endpoint Kanca</h2>
        <p className="text-xs text-slate-500">Dari dokumentasi resmi. Semua memakai <code>{c.baseUrl}/api/v1/workspaces/{'{workspaceId}'}</code> + header <code>Authorization: Bearer ib_…</code>. Batas: 60 broadcast/jam dan 120 permintaan/menit per workspace.</p>
        <div className="space-y-1.5">{data.catalog.map((e: any) => <div key={e.method + e.path} className="rounded-lg border p-2 text-sm"><div className="flex flex-wrap items-center gap-2"><Badge tone={e.method === 'GET' ? 'slate' : 'amber'}>{e.method}</Badge><code className="break-all text-xs">{e.path}</code><span className="font-medium">{e.title}</span>{!e.safe && <Badge tone="amber">berbiaya</Badge>}{e.safe && <Badge tone="green">baca-saja</Badge>}</div><p className="mt-1 text-xs text-slate-500">{e.note}</p></div>)}</div>
        <p className="text-xs text-slate-500">Webhook Kanca (pesan masuk, status percakapan, kontak, CSAT) <b>belum dipakai</b> oleh Maung — notifikasi Maung hanya mengirim keluar.</p>
      </div>
    </>
  );
}
