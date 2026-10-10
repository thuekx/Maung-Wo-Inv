'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api, fmtDate, useFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { confirmDialog, toast } from '@/lib/dialog';
import { Badge, ErrorMsg, Modal, PageHeader } from '@/components/ui';

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

      <Registry data={data} reload={reload} liveTemplates={templates} liveErr={p?.templates && !p.templates.ok ? p.templates : null} />
      <WebhookCard data={data} reload={reload} />

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
        <p className="text-xs text-slate-500">Webhook Kanca dipakai untuk mencatat event dan status delivery notifikasi (lihat kartu Webhook di atas). Event pesan masuk / percakapan / kontak hanya dicatat di log — belum memicu aksi di Maung.</p>
      </div>
    </>
  );
}

type Tpl = { id: string; templateId: string; name: string; category?: string | null; status?: string | null; body?: string | null; varCount: number; purpose?: string | null; source: string };
const blank = { templateId: '', name: '', category: 'UTILITY', status: 'APPROVED', body: '', varCount: '1', purpose: '' };

/** Pencatatan template: UUID disalin dari tombol copy di dashboard Kanca (atau disinkron bila API mengizinkan). */
function Registry({ data, reload, liveTemplates, liveErr }: { data: any; reload: () => void; liveTemplates: any[]; liveErr: any }) {
  const c = data.config;
  const rows: Tpl[] = data.registry ?? [];
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); try { await fn(); toast.success(ok); reload(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } };
  const pick = (t: Tpl) => run(() => api('/admin/kanca/template', { method: 'PUT', body: { templateId: t.templateId, varMode: t.varCount >= 2 ? '2' : '1' } }), `Template "${t.name}" dipakai untuk notifikasi`);
  const save = () => run(async () => { const body = { ...f, varCount: Number(f.varCount), category: f.category || null, status: f.status || null, body: f.body || null, purpose: f.purpose || null }; if (f.id) await api(`/admin/kanca/templates/${f.id}`, { method: 'PATCH', body }); else await api('/admin/kanca/templates', { body }); setF(null); }, 'Template tersimpan');
  return (
    <div className="card mt-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Pencatatan template WhatsApp ({rows.length})</h2>
        <div className="flex flex-wrap gap-2"><button className="btn-ghost" disabled={busy || !data.ready} onClick={() => run(async () => { const r = await api<any>('/admin/kanca/templates/sync', { body: {} }); toast.info?.(`${r.synced} template disinkron`); }, 'Sinkron dari Kanca selesai')}>↻ Sinkron dari Kanca</button><button className="btn" onClick={() => setF({ ...blank })}>+ Catat template</button></div>
      </div>
      <p className="text-xs text-slate-500">UUID template tidak tampil di daftar bila API tidak mengizinkan membacanya — salin dari dashboard Kanca → Templates (tombol <b>copy</b> di samping nama template) lalu catat di sini. Hanya template <b>APPROVED</b> yang boleh dikirim di luar jendela 24 jam. Template yang berstatus <b>dipakai</b> menjadi template notifikasi Maung.</p>
      {liveErr && <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">Daftar template tidak bisa dibaca dari API Kanca ({liveErr.httpStatus ? `HTTP ${liveErr.httpStatus}: ` : ''}{liveErr.error}) — gunakan pencatatan manual.</p>}
      {!liveErr && liveTemplates.length > 0 && <p className="text-xs text-slate-500">API Kanca mengembalikan {liveTemplates.length} template — klik <b>Sinkron dari Kanca</b> untuk mencatat semuanya.</p>}
      {!rows.length ? <p className="text-sm text-slate-400">Belum ada template tercatat.</p> : (
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th className="py-1 pr-3">Nama</th><th className="pr-3">Status</th><th className="pr-3">Var.</th><th className="pr-3">Isi / keperluan</th><th className="pr-3">UUID</th><th /></tr></thead><tbody className="divide-y">
          {rows.map((t) => (
            <tr key={t.id} className="align-top"><td className="py-1.5 pr-3 font-medium">{t.name}<div className="text-[10px] text-slate-400">{t.category ?? ''} · {t.source}</div></td><td className="pr-3"><Badge tone={t.status === 'APPROVED' ? 'green' : t.status === 'REJECTED' ? 'red' : 'amber'}>{t.status ?? '-'}</Badge></td><td className="pr-3">{t.varCount}</td>
              <td className="max-w-xs whitespace-pre-wrap pr-3 text-xs text-slate-600">{t.body || '-'}{t.purpose && <div className="text-slate-500">→ {t.purpose}</div>}</td><td className="pr-3"><code className="break-all text-[10px]">{t.templateId}</code></td>
              <td className="whitespace-nowrap">{c.templateId === t.templateId ? <Badge tone="green">dipakai notifikasi</Badge> : t.status === 'APPROVED' ? <button className="btn-ghost !px-2 !py-0.5 !text-xs" disabled={busy} onClick={() => pick(t)}>Pakai</button> : null}<button className="ml-1 text-xs text-brand-700 hover:underline" onClick={() => setF({ ...t, varCount: String(t.varCount), category: t.category ?? '', status: t.status ?? '', body: t.body ?? '', purpose: t.purpose ?? '' })}>Edit</button><button className="ml-2 text-xs text-red-600 hover:underline" onClick={async () => { if (await confirmDialog(`Hapus catatan template "${t.name}"? (Template di Kanca tidak terhapus)`, { danger: true })) run(() => api(`/admin/kanca/templates/${t.id}`, { method: 'DELETE' }), 'Dihapus'); }}>Hapus</button></td></tr>
          ))}
        </tbody></table></div>
      )}
      {f && (
        <Modal title={f.id ? 'Edit template' : 'Catat template'} onClose={() => setF(null)}>
          <div className="space-y-3 text-sm">
            <label className="block"><span className="label">UUID template (templateId)</span><input className="input font-mono text-xs" value={f.templateId} onChange={(e) => setF({ ...f, templateId: e.target.value })} placeholder="9388eb83-fb4c-44ea-8744-844337724598" /></label>
            <label className="block"><span className="label">Nama template</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <div className="grid grid-cols-3 gap-2">
              <label className="block"><span className="label">Kategori</span><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option>UTILITY</option><option>AUTHENTICATION</option><option>MARKETING</option></select></label>
              <label className="block"><span className="label">Status</span><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option>APPROVED</option><option>PENDING</option><option>REJECTED</option></select></label>
              <label className="block"><span className="label">Jumlah variabel</span><input className="input" type="number" min={0} max={10} value={f.varCount} onChange={(e) => setF({ ...f, varCount: e.target.value })} /></label>
            </div>
            <label className="block"><span className="label">Isi template (opsional, pratinjau)</span><textarea className="input" rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="Halo {{1}}, {{2}}" /></label>
            <label className="block"><span className="label">Keperluan (opsional)</span><input className="input" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder="mis. notifikasi WO" /></label>
            <div className="flex justify-end gap-2"><button className="btn-ghost" onClick={() => setF(null)}>Batal</button><button className="btn" disabled={busy || !f.templateId || !f.name} onClick={save}>Simpan</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Webhook Kanca → Maung: URL + secret HMAC, dan log event terakhir. */
function WebhookCard({ data, reload }: { data: any; reload: () => void }) {
  const w = data.webhook;
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const gen = async () => { if (w.secretSet && !(await confirmDialog('Ganti secret? Webhook di Kanca harus diperbarui dengan secret baru.'))) return; setBusy(true); try { const r = await api<any>('/admin/kanca/webhook-secret', { body: {} }); setSecret(r.secret); reload(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } };
  const poll = async () => { setBusy(true); try { const r = await api<any>('/admin/kanca/sync-delivery', { body: {} }); toast.success(`${r.updated} status delivery diperbarui`); reload(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } };
  return (
    <div className="card mt-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Webhook Kanca → Maung</h2><Badge tone={w.secretSet ? 'green' : 'amber'}>{w.secretSet ? 'Secret terpasang' : 'Secret belum dibuat'}</Badge></div>
      <p className="text-xs text-slate-500">Kanca mengirim event (pesan, status delivery, kontak, percakapan) ke URL ini. Maung menyimpan log event, dan memperbarui status delivery notifikasi WhatsApp (<b>delivered / read / failed</b>) yang tampil di Admin → Log notifikasi. Sebagai cadangan, Maung juga menarik status delivery sendiri tiap 2 menit lewat API.</p>
      <div className="grid gap-2 sm:grid-cols-[8rem_1fr] text-sm"><span className="text-xs text-slate-500">URL webhook</span><code className="break-all rounded bg-slate-100 px-2 py-1 text-xs">{w.url}</code></div>
      <ol className="list-decimal space-y-0.5 pl-5 text-xs text-slate-600"><li>Klik <b>Buat secret</b> dan salin (hanya tampil sekali).</li><li>Di Kanca: <b>Integrasi → Tambah Webhook</b> → isi URL di atas dan secret yang sama, pilih event (mis. message_created, message_updated), lalu klik <b>Test</b>.</li><li>Event yang masuk muncul di tabel bawah.</li></ol>
      {w.url.includes('localhost') && <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">URL aplikasi masih localhost — atur URL aplikasi di Admin → Tampilan &amp; brand agar Kanca dapat menjangkau server ini.</p>}
      <div className="flex flex-wrap gap-2"><button className="btn" disabled={busy} onClick={gen}>{w.secretSet ? 'Ganti secret' : 'Buat secret'}</button><button className="btn-ghost" disabled={busy || !data.ready} onClick={poll}>↻ Tarik status delivery sekarang</button></div>
      {secret && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-slate-800"><div className="mb-1 text-xs font-semibold">Secret (salin sekarang — tidak ditampilkan lagi)</div><div className="flex gap-2"><code className="break-all text-xs">{secret}</code><button className="btn-ghost !px-2 !py-0.5 !text-xs" onClick={() => navigator.clipboard?.writeText(secret)}>Salin</button></div></div>}
      <div><h3 className="mb-1 text-sm font-semibold">Event terakhir ({w.total} tersimpan)</h3>
        {!w.events.length ? <p className="text-sm text-slate-400">Belum ada event masuk.</p> : <div className="max-h-72 overflow-auto"><table className="w-full text-xs"><tbody className="divide-y">{w.events.map((e: any) => <tr key={e.id} className="align-top"><td className="whitespace-nowrap py-1 pr-3">{fmtDate(e.receivedAt)}</td><td className="pr-3"><Badge>{e.event}</Badge></td><td className="break-all font-mono text-[10px] text-slate-500">{JSON.stringify(e.payload).slice(0, 220)}</td></tr>)}</tbody></table></div>}
      </div>
    </div>
  );
}
