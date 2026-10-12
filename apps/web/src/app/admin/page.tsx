'use client';
import { Fragment, useEffect, useState } from 'react';
import { APP_ICONS, APP_ICON_ALIAS, AppIcon } from '@/components/appIcons';
import { AppTileIcon } from '@/components/AppTileIcon';
import { Icon } from '@/components/icons';
import { API, api, doDelete, download, fileUrl, imgUrl, fmtDate, getToken, ROLE_LABEL, SUBROLE_LABEL, useFetch } from '@/lib/api';
import { confirmDialog, toast } from '@/lib/dialog';
import { DEFAULT_LOGOS, loadBranding } from '@/lib/brand';
import { useAuth } from '@/lib/auth';
import { DynamicForm, Field as FormField } from '@/components/DynamicForm';
import { Column, DataTable } from '@/components/DataTable';
import { Badge, ErrorMsg, LinkBtn, Modal, PageHeader, Table, Tabs } from '@/components/ui';
import { Select } from '@/components/Select';
import { EmbedFrame } from '@/components/EmbedFrame';
import { ApiMsradius } from '@/components/admin/ApiMsradius';
import { ApiSistem } from '@/components/admin/ApiSistem';
import { ApiKanca } from '@/components/admin/ApiKanca';
import { PasswordInput } from '@/components/PasswordInput';

function PwResult({ list, onClose }: { list: { name: string; email: string; password?: string; sentTo?: string[] }[]; onClose: () => void }) {
  const csv = () => {
    const body = 'nama,email,password_sementara\n' + list.map((u) => `"${u.name}",${u.email},${u.password ?? ''}`).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' })); a.download = 'password-sementara.csv'; a.click();
  };
  const hasPw = list.some((u) => u.password);
  return (
    <Modal title="Password berhasil direset" onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        {hasPw ? <p className="rounded-lg bg-amber-100 px-3 py-2 text-amber-800">Catat/unduh sekarang — password acak <b>hanya ditampilkan sekali</b> dan tidak dapat dilihat lagi.</p> : <p>Password disetel sama untuk semua user yang dipilih.</p>}
        <Table head={['Nama', 'Email', 'Password sementara', 'Dikirim ke']}>
          {list.map((u) => <tr key={u.email}><td className="td">{u.name}</td><td className="td">{u.email}</td><td className="td font-mono">{u.password ?? '(sesuai yang Anda isi)'}</td><td className="td text-xs">{u.sentTo?.length ? u.sentTo.map((c) => c === 'email' ? 'Email' : 'Telegram').join(' + ') : <span className="text-slate-400">tidak dikirim</span>}</td></tr>)}
        </Table>
        <div className="flex gap-2">{hasPw && <button className="btn-ghost" onClick={csv}>⬇ Unduh CSV</button>}<button className="btn" onClick={onClose}>Selesai</button></div>
      </div>
    </Modal>
  );
}

const userFields: FormField[] = [
  { name: 'name', label: 'Nama', type: 'text', required: true },
  { name: 'email', label: 'Email', type: 'text', required: true },
  { name: 'role', label: 'Divisi', type: 'select', required: true, options: Object.keys(ROLE_LABEL) },
  { name: 'subRole', label: 'Sub-role', type: 'select', required: true, options: ['STAFF', 'SUPERVISOR', 'MANAGER'], help: 'Saat ini hanya FOC yang dibedakan: penjadwalan teknisi hanya untuk SUPERVISOR/MANAGER; STAFF = minta material & isi laporan' },
  { name: 'telegramChatId', label: 'Telegram chat ID (opsional)', type: 'text' },
];

function Users() {
  const { data, reload } = useFetch<any[]>('/users');
  const [show, setShow] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const [pw, setPw] = useState<any>(null); // {ids}
  const [result, setResult] = useState<any[] | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [opt, setOpt] = useState({ mode: 'random', password: '', mustChange: true, notify: true, sendPassword: true });
  const [err, setErr] = useState('');
  const users = data?.filter((u) => u.email !== 'system@l1v.local') ?? [];
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const doReset = async () => {
    setErr('');
    try {
      const body = { password: opt.mode === 'same' ? opt.password : undefined, mustChange: opt.mustChange, notify: opt.notify, sendPassword: opt.sendPassword };
      if (opt.mode === 'same' && opt.password.length < 8) return setErr('Password minimal 8 karakter');
      const r = pw.ids.length === 1 ? { users: [await api(`/users/${pw.ids[0]}/reset-password`, { body })] } : await api('/users/bulk-password', { body: { ...body, userIds: pw.ids } });
      setResult(r.users.map((u: any) => ({ ...u, password: u.password ?? (opt.mode === 'same' ? opt.password : undefined) }))); setPw(null); setSel([]); reload();
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <button className="btn" onClick={() => setShow(true)}>+ Tambah user</button>
        <button className="btn-ghost" disabled={!sel.length} onClick={() => { setErr(''); setPw({ ids: sel }); }}>🔑 Reset password terpilih ({sel.length})</button>
      </div>
      <Table head={['', 'Nama', 'Email', 'Divisi', 'Sub-role', 'Telegram', 'Status', '']}>
        {users.map((u) => (
          <tr key={u.id}>
            <td className="td"><input type="checkbox" checked={sel.includes(u.id)} onChange={() => toggle(u.id)} aria-label={`pilih ${u.name}`} /></td>
            <td className="td">{u.name}</td><td className="td">{u.email}</td><td className="td"><Badge>{ROLE_LABEL[u.role] ?? u.role}</Badge></td><td className="td text-sm">{u.role === 'ADMIN' ? '-' : SUBROLE_LABEL[u.subRole] ?? u.subRole}</td>
            <td className="td">{u.telegramChatId ? '✓ terhubung' : '-'}</td>
            <td className="td"><button className="btn-ghost !px-2.5 !py-1 !text-xs !text-brand-700" onClick={async () => { await api(`/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }).catch((e) => toast.error(e.message)); reload(); }}>{u.active ? 'Aktif' : 'Nonaktif'}</button>{u.mustChangePassword && <div><Badge tone="amber">wajib ganti password</Badge></div>}</td>
            <td className="td whitespace-nowrap"><LinkBtn onClick={() => setEdit(u)}>Edit</LinkBtn><LinkBtn onClick={() => { setErr(''); setPw({ ids: [u.id] }); }}>Reset PW</LinkBtn><LinkBtn danger onClick={async () => { if (await doDelete(`/users/${u.id}`, `user ${u.email}`)) reload(); }}>Hapus</LinkBtn></td>
          </tr>
        ))}
      </Table>
      {show && (
        <Modal title="Tambah user" onClose={() => setShow(false)}>
          <DynamicForm submitLabel="Buat user" onSubmit={async (v) => { await api('/users', { body: v }); setShow(false); await reload(); }} fields={[...userFields.slice(0, 4), { name: 'password', label: 'Password awal (min 8)', type: 'password', required: true }, userFields[4]]} />
        </Modal>
      )}
      {edit && (
        <Modal title={`Edit user ${edit.email}`} onClose={() => setEdit(null)}>
          <DynamicForm fields={userFields} initial={edit} sendEmpty submitLabel="Simpan perubahan" onSubmit={async (v) => { await api(`/users/${edit.id}`, { method: 'PATCH', body: v }); setEdit(null); await reload(); }} />
        </Modal>
      )}
      {pw && (
        <Modal title={pw.ids.length === 1 ? 'Reset password user' : `Reset password ${pw.ids.length} user`} onClose={() => setPw(null)}>
          <div className="space-y-3 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={opt.mode === 'random'} onChange={() => setOpt({ ...opt, mode: 'random' })} /> Buat password acak per user (ditampilkan sekali ke Anda)</label>
            <label className="flex items-center gap-2"><input type="radio" checked={opt.mode === 'same'} onChange={() => setOpt({ ...opt, mode: 'same' })} /> Satu password yang sama:</label>
            {opt.mode === 'same' && <PasswordInput className="input" placeholder="min 8 karakter" value={opt.password} onChange={(e) => setOpt({ ...opt, password: e.target.value })} />}
            <label className="flex items-center gap-2"><input type="checkbox" checked={opt.mustChange} onChange={(e) => setOpt({ ...opt, mustChange: e.target.checked })} /> Wajib ganti password saat login berikutnya</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={opt.notify} onChange={(e) => setOpt({ ...opt, notify: e.target.checked })} /> Kirim ke user lewat email (+ Telegram bila sudah terhubung)</label>
            {opt.notify && <label className="ml-6 flex items-center gap-2"><input type="checkbox" checked={opt.sendPassword} onChange={(e) => setOpt({ ...opt, sendPassword: e.target.checked })} /> Sertakan password sementara di pesan <span className="text-xs text-slate-500">(dikirim ke <b>email terdaftar</b>, dan ke <b>Telegram</b> bila sudah terhubung di profil user; tidak disimpan di kotak masuk aplikasi & dihapus dari log setelah terkirim)</span></label>}
            <ErrorMsg>{err}</ErrorMsg>
            <button className="btn" onClick={doReset}>Reset sekarang</button>
          </div>
        </Modal>
      )}
      {result && <PwResult list={result} onClose={() => setResult(null)} />}
    </>
  );
}

function AuditLog() {
  const [entity, setEntity] = useState('');
  const tone = (a: string): any => (a === 'DELETE' ? 'red' : a === 'UPDATE' ? 'amber' : a === 'PASSWORD_RESET' ? 'violet' : a === 'IMPORT' ? 'blue' : 'green');
  const cols: Column<any>[] = [
    { key: 'createdAt', header: 'Waktu', sort: 'createdAt', className: 'whitespace-nowrap', render: (a) => fmtDate(a.createdAt) },
    { key: 'action', header: 'Aksi', sort: 'action', render: (a) => <Badge tone={tone(a.action)}>{a.action}</Badge> },
    { key: 'summary', header: 'Ringkasan' },
    { key: 'before', header: 'Data sebelumnya', className: 'max-w-xs truncate font-mono text-xs text-slate-500', render: (a) => <span title={a.before ? JSON.stringify(a.before) : ''}>{a.before ? JSON.stringify(a.before) : '-'}</span> },
  ];
  return <DataTable<any> path="/admin/audit" columns={cols} params={{ entity }} defaultSort="createdAt" searchPlaceholder="Cari ringkasan / pengguna…" empty="Belum ada catatan"
    filters={<Select className="input w-52" value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Jenis data"><option value="">Semua data</option>{['pelanggan', 'user', 'item', 'gudang', 'aset', 'paket', 'merk', 'tipe', 'PO', 'WO'].map((x) => <option key={x}>{x}</option>)}</Select>} />;
}

const sTone = (s: string): any => (s === 'SENT' ? 'green' : s === 'FAILED' ? 'red' : s === 'NOT_SENT' ? 'amber' : s === 'SKIPPED' ? 'slate' : 'blue');
const sLabel: Record<string, string> = { SENT: 'Terkirim', FAILED: 'GAGAL', NOT_SENT: 'TIDAK TERKIRIM', PENDING: 'Menunggu', SKIPPED: 'Dilewati' };

function Notifs() {
  const [status, setStatus] = useState('');
  const [n, setN] = useState(0);
  const resend = async (id: string) => { try { await api(`/admin/notifications/${id}/resend`, { body: {} }); toast.success('Dikirim ulang — cek status beberapa detik lagi.'); setN((x) => x + 1); } catch (e) { toast.error((e as Error).message); } };
  const resendAll = async () => { try { const r = await api<{ queued: number }>('/admin/notifications/resend-all', { body: {} }); toast.success(`${r.queued} notifikasi dikirim ulang.`); setN((x) => x + 1); } catch (e) { toast.error((e as Error).message); } };
  const cols: Column<any>[] = [
    { key: 'createdAt', header: 'Waktu', sort: 'createdAt', render: (n) => fmtDate(n.createdAt) },
    { key: 'channel', header: 'Kanal', sort: 'channel' },
    { key: 'target', header: 'Tujuan', className: 'text-xs' },
    { key: 'subject', header: 'Subjek' },
    { key: 'status', header: 'Status', sort: 'status', render: (n) => <><Badge tone={sTone(n.status)}>{sLabel[n.status] ?? n.status}</Badge>{n.providerStatus && <div className="mt-0.5"><Badge tone={n.providerStatus === 'read' || n.providerStatus === 'delivered' ? 'green' : n.providerStatus === 'failed' ? 'red' : 'slate'}>WA: {n.providerStatus}</Badge></div>}{n.error && <div className="text-xs text-red-600">{n.error}</div>}</> },
    { key: 'act', header: '', render: (n) => (n.status === 'SENT' || n.status === 'PENDING' ? null : <button className="btn-ghost !px-2.5 !py-1 !text-xs !text-brand-700" onClick={() => resend(n.id)}>Kirim ulang</button>) },
  ];
  return <DataTable<any> path="/admin/notifications" columns={cols} params={{ status, r: String(n) }} defaultSort="createdAt" searchPlaceholder="Cari subjek / tujuan…"
    filters={<><button className="btn-ghost" onClick={resendAll}>Kirim ulang semua yang belum terkirim</button><Select className="input w-40" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Semua status</option>{['PENDING', 'SENT', 'NOT_SENT', 'FAILED', 'SKIPPED'].map((x) => <option key={x} value={x}>{sLabel[x]}</option>)}</Select></>} />;
}

function Outbound() {
  const { data, error } = useFetch<any[]>('/admin/outbound');
  return (
    <>
      <details className="mb-3 rounded-lg border bg-slate-50 p-3 text-sm dark:bg-slate-800">
        <summary className="cursor-pointer font-medium">Integrasi dengan aplikasi Billing — cara kerja & contoh</summary>
        <div className="mt-2 space-y-2 text-slate-600">
          <p><b>Masuk ke Maung (billing → Maung):</b> aplikasi billing memanggil <code>POST /api/integrations/billing/events</code> dengan header <code>x-api-key</code> (nilai <code>BILLING_API_KEY</code> di <code>.env</code>). Maung otomatis membuat WO Suspend / Unsuspend / Terminate. Memanggil dua kali untuk pelanggan yang sama aman (dijawab <code>duplicate: true</code>).</p>
          <pre className="overflow-x-auto rounded-lg bg-slate-900 p-2 text-xs text-slate-100">{`curl -X POST https://api.perusahaan.co.id/api/integrations/billing/events \\
  -H "x-api-key: <BILLING_API_KEY>" -H "content-type: application/json" \\
  -d '{"event":"suspend","customerCode":"260705044930","reason":"Tunggakan 2 bulan","invoiceRef":"INV-2610-045"}'
# → 201 {"duplicate":false,"id":"…","number":"WO-SP-20261010-0003"}`}</pre>
          <p><b>Keluar dari Maung (Maung → billing):</b> bila <code>BILLING_WEBHOOK_URL</code> di <code>.env</code> diisi, setiap event dikirim sebagai <code>POST</code> JSON bertanda tangan HMAC-SHA256 (header <code>x-signature</code>) dan dicatat di tabel di bawah beserta jumlah percobaan. Billing juga dapat <i>polling</i> status pelanggan lewat <code>GET /api/integrations/billing/customers/&lt;kode&gt;</code>. Saat ini Finance hanya menerima <b>pengingat</b> (email/Telegram), belum ada event keluar otomatis.</p>
        </div>
      </details>
      <ErrorMsg>{error}</ErrorMsg>
      <Table head={['Waktu', 'Event ke Billing', 'Payload', 'Percobaan', 'Status']}>
        {data?.map((n) => (
          <tr key={n.id}><td className="td">{fmtDate(n.createdAt)}</td><td className="td font-mono text-xs">{n.event}</td><td className="td max-w-xs truncate text-xs">{JSON.stringify(n.payload)}</td><td className="td">{n.attempts}</td>
            <td className="td"><Badge tone={sTone(n.status)}>{n.status}</Badge>{n.lastError && <div className="text-xs text-red-600">{n.lastError}</div>}</td></tr>
        ))}
      </Table>
    </>
  );
}

/* ───────── Pengaturan: logo PT, SMTP, Telegram ───────── */
const Field = ({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) => (
  <label className="block"><span className="mb-1 block text-sm font-medium">{label}</span>{children}{help && <span className="mt-0.5 block text-xs text-slate-500">{help}</span>}</label>
);

function useAction() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<any>, okText: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: okText }); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  };
  return { msg, busy, run };
}
const Msg = ({ m }: { m: { ok: boolean; text: string } | null }) => m && <p className={`rounded-lg px-3 py-2 text-sm ${m.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{m.text}</p>;

const COLOR_LABELS = ['Grafik 1', 'Grafik 2', 'Grafik 3', 'Grafik 4', 'Grafik 5', 'Grafik 6'];
const HEXRE = /^#[0-9a-fA-F]{6}$/;

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-500">
      <input type="color" value={HEXRE.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-9 w-10 cursor-pointer rounded border border-slate-300 bg-white p-0.5" aria-label={label} />
      <span className="min-w-0"><span className="block">{label}</span><input className="input !w-24 !py-0.5 font-mono !text-xs" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} maxLength={7} /></span>
    </label>
  );
}

const BRAND_KEY: Record<string, string> = { horizontal: 'logoUrl', stacked: 'logoStackedUrl', mark: 'logoMarkUrl', loginbg: 'loginBgUrl', gps: 'gpsLogoUrl', kop: 'kopUrl', formlogo: 'formLogoUrl', mgrsign: 'mgrSignUrl' };

function UploadBox({ title, hint, url: uploaded, dark, variant, onDone }: { title: string; hint: string; url: string | null; dark?: boolean; variant: string; onDone: () => void }) {
  const a = useAction();
  const defUrl = (DEFAULT_LOGOS as Record<string, string>)[BRAND_KEY[variant]] ?? null;
  const url = uploaded || defUrl; // belum ada unggahan → tampilkan logo bawaan
  const isDefault = !uploaded && !!defUrl;
  const [bg, setBg] = useState<'light' | 'dark'>(dark ? 'dark' : 'light');
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const [last, setLast] = useState<{ name: string; kb: number; at: string } | null>(null);
  const shown = url ? `${fileUrl(url)}${last ? `?v=${encodeURIComponent(last.at)}` : ''}` : null;
  const broken = !!shown && brokenUrl === shown;
  const upload = (input: HTMLInputElement) => {
    const f = input.files?.[0];
    if (!f) return;
    a.run(async () => {
      const fd = new FormData(); fd.append('file', f);
      const res = await fetch(`${API}/api/admin/settings/branding/logo?variant=${variant}`, { method: 'POST', headers: { authorization: `Bearer ${getToken()}` }, body: fd });
      const j = await res.json().catch(() => ({})); if (!res.ok) throw new Error(j.error ?? 'Upload gagal');
      // pastikan file yang baru tersimpan benar-benar bisa dibaca dari server (bukan hanya tercatat)
      const saved: string | null = j.branding?.[BRAND_KEY[variant]] ?? null;
      if (!saved) throw new Error('Server tidak mengembalikan alamat file baru');
      const ok = await new Promise<boolean>((resolve) => { const im = new Image(); im.onload = () => resolve(true); im.onerror = () => resolve(false); im.src = fileUrl(saved); });
      if (!ok) throw new Error('File tercatat tetapi tidak dapat dibaca dari server (cek volume uploads / alamat API)');
      setBrokenUrl(null); setLast({ name: f.name, kb: Math.round(f.size / 1024), at: new Date().toLocaleTimeString('id-ID') });
      input.value = '';
      await loadBranding(true); onDone();
    }, 'Tersimpan');
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">{title}</div>
        <div className="flex shrink-0 overflow-hidden rounded border border-slate-300 text-[10px]" role="group" aria-label="Latar pratinjau">
          <button type="button" className={`px-1.5 py-0.5 ${bg === 'light' ? 'bg-slate-200 font-semibold' : 'bg-white'}`} onClick={() => setBg('light')}>Terang</button>
          <button type="button" className={`px-1.5 py-0.5 ${bg === 'dark' ? 'bg-brand-900 font-semibold text-white' : 'bg-white'}`} onClick={() => setBg('dark')}>Gelap</button>
        </div>
      </div>
      <div className={`flex h-24 items-center justify-center rounded-lg border ${bg === 'dark' ? 'bg-brand-900' : 'bg-white'}`}>
        {shown && !broken ? <img key={shown} src={shown} alt={title} onError={() => setBrokenUrl(shown)} className="max-h-20 max-w-[85%] object-contain" /> : broken ? <span className="px-2 text-center text-xs text-red-600">Gambar tidak dapat dimuat dari server</span> : <span className="text-xs text-slate-400">Belum ada</span>}
      </div>
      {url && <p className="truncate text-[11px] text-slate-500" title={url}>{isDefault ? 'Logo bawaan aplikasi (belum ada unggahan)' : last ? `Baru diunggah ${last.at}: ${last.name} (${last.kb} KB)` : 'Berkas aktif'} · <a className="text-brand-700 hover:underline" href={fileUrl(url)} target="_blank" rel="noreferrer">buka</a></p>}
      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => upload(e.target)} className="w-full text-xs" />
      <p className="text-xs text-slate-500">{hint}</p>
      {uploaded && <button className="btn-ghost !px-2.5 !py-1 !text-xs !border-red-300 !text-red-600 hover:!bg-red-50" onClick={() => a.run(async () => { await api(`/admin/settings/branding/logo?variant=${variant}`, { method: 'DELETE' }); setLast(null); await loadBranding(true); onDone(); }, 'Dihapus — kembali ke logo bawaan')}>Hapus (pakai bawaan)</button>}
      <Msg m={a.msg} />
    </div>
  );
}

/** URL aplikasi untuk tautan di email/WhatsApp/Telegram — atur di sini agar tidak bergantung IP server. */
function AppUrlField({ d, reload }: { d: any; reload: () => void }) {
  const [v, setV] = useState<string>(d.appUrl?.value ?? '');
  const a = useAction();
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <label className="label">URL aplikasi (untuk tautan di notifikasi)</label>
      <div className="flex flex-wrap gap-2">
        <input className="input min-w-0 flex-1" value={v} onChange={(e) => setV(e.target.value)} placeholder={d.appUrl?.envValue ?? 'https://wo.perusahaan.co.id'} />
        <button className="btn" disabled={a.busy} onClick={() => a.run(async () => { await api('/admin/settings/app', { method: 'PUT', body: { publicUrl: v.trim() } }); reload(); }, 'URL aplikasi disimpan — berlaku ≤ 10 detik')}>Simpan URL</button>
      </div>
      <p className="mt-1 text-xs text-slate-500">Dipakai pada tautan WO di email, WhatsApp & Telegram. Kosongkan untuk memakai nilai server ({d.appUrl?.envValue}). Cukup ganti di sini bila IP/domain berubah — tanpa deploy ulang. Label QR aset otomatis memakai alamat yang sedang dibuka.</p>
    </div>
  );
}

function BrandingCard({ d, reload }: { d: any; reload: () => void }) {
  const b = d.branding;
  const [f, setF] = useState({ appName: b.appName ?? 'MAUNG | SuperApps', companyName: b.companyName, tagline: b.tagline, subtitle: b.subtitle, loginText: b.loginText, primary: b.colors.primary, accent: b.colors.accent, charts: [...b.colors.charts] as string[] });
  const a = useAction();
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));
  const valid = HEXRE.test(f.primary) && HEXRE.test(f.accent) && f.charts.every((c) => HEXRE.test(c));
  const lines: string[] = String(f.loginText).split('\n').filter(Boolean);
  const save = () => a.run(async () => {
    await api('/admin/settings/branding', { method: 'PUT', body: { appName: f.appName, companyName: f.companyName, tagline: f.tagline, subtitle: f.subtitle, loginText: f.loginText, colors: { primary: f.primary, accent: f.accent, charts: f.charts } } });
    await loadBranding(true); reload();
  }, 'Tampilan & brand disimpan — langsung berlaku');
  const reset = async () => { if (!(await confirmDialog('Kembalikan teks dan warna ke bawaan panduan MAUNG by LIV? (Logo tidak dihapus)'))) return; a.run(async () => { await api('/admin/settings/branding/reset', { body: {} }); await loadBranding(true); reload(); setTimeout(() => window.location.reload(), 600); }, 'Dikembalikan ke bawaan'); };
  return (
    <div className="card space-y-5">
      <div><h2 className="font-semibold">Tampilan & brand</h2><p className="text-sm text-slate-500">Logo, tagline, teks halaman login, dan warna. Dipakai di halaman login, top bar, dashboard, dan banner foto lapangan.</p></div>

      <div className="grid gap-4 md:grid-cols-4">
        <UploadBox title="Logo horizontal (latar gelap)" hint="Teks putih/terang, sebaiknya TANPA tagline (tagline tampil terpisah & bisa diganti). Dipakai di login dan banner foto. PNG/WEBP transparan ≤ 2 MB." url={b.logoUrl} dark variant="horizontal" onDone={reload} />
        <UploadBox title="Ikon / logo ringkas (top bar)" hint="Hanya lambang tanpa teks, mendekati persegi. Dipakai di top bar bersama nama brand. ≤ 1 MB. Contoh: docs/branding/logo-mark.png" url={b.logoMarkUrl} dark variant="mark" onDone={reload} />
        <UploadBox title="Logo tegak (latar terang)" hint="Untuk cetakan/dokumen latar putih. ≤ 2 MB." url={b.logoStackedUrl} variant="stacked" onDone={reload} />
        <UploadBox title="Logo untuk foto GPS (logo perusahaan)" hint="Logo PT yang ditempel di banner foto lapangan (bersama koordinat GPS). Terpisah dari logo aplikasi; bila kosong dipakai logo horizontal. PNG/WEBP ≤ 2 MB." url={b.gpsLogoUrl} dark variant="gps" onDone={reload} />
        <UploadBox title="Kop surat A4 (dokumen PR, BA, laporan)" hint="Gambar kop satu halaman penuh (A4 portrait, mis. 2480×3508 px) dengan area isi kosong di tengah. Bila kosong dipakai kop bawaan. JPG/PNG/WEBP ≤ 3 MB." url={b.kopUrl} variant="kop" onDone={reload} />
        <UploadBox title="Logo Formulir Berlangganan" hint="Logo merek di pojok kanan atas formulir (bawaan: Sunmori). PNG/WEBP transparan ≤ 2 MB." url={b.formLogoUrl} variant="formlogo" onDone={reload} />
        <UploadBox title="Tanda tangan Manager Marketing (opsional)" hint="Gambar tanda tangan (PNG transparan ≤ 1 MB) yang tercetak di formulir. Bila kosong, kolom dibiarkan kosong untuk tanda tangan basah." url={b.mgrSignUrl} variant="mgrsign" onDone={reload} />
        <UploadBox title="Gambar latar login (opsional)" hint="Foto lanskap/pegunungan. Diberi lapisan navy otomatis. JPG/WEBP ≤ 6 MB." url={b.loginBgUrl} dark variant="loginbg" onDone={reload} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Nama brand / perusahaan (juga tertulis di foto)"><input className="input" value={f.companyName} onChange={(e) => set('companyName', e.target.value)} /></Field>
        <Field label="Tagline" help="Tampil di halaman login, dashboard, dan sidebar. Kosongkan untuk menyembunyikan."><input className="input" value={f.tagline} onChange={(e) => set('tagline', e.target.value)} /></Field>
        <Field label="Nama aplikasi" help="Dipakai sebagai nama pengirim & penutup email/notifikasi, mis. MAUNG | SuperApps"><input className="input" value={f.appName} maxLength={60} onChange={(e) => set('appName', e.target.value)} /></Field>
        <Field label="Sub-judul (di bawah logo)"><input className="input" value={f.subtitle} onChange={(e) => set('subtitle', e.target.value)} /></Field>
        <Field label="Teks halaman login" help="Satu baris per paragraf."><textarea className="input" rows={3} value={f.loginText} onChange={(e) => set('loginText', e.target.value)} /></Field>
      </div>

      <div className="space-y-3">
        <div className="text-sm font-medium">Warna</div>
        <div className="flex flex-wrap gap-4"><ColorField label="Utama (navy)" value={f.primary} onChange={(v) => set('primary', v)} /><ColorField label="Aksen (emas)" value={f.accent} onChange={(v) => set('accent', v)} /></div>
        <div className="flex flex-wrap gap-4">{f.charts.map((c, i) => <ColorField key={i} label={COLOR_LABELS[i]} value={c} onChange={(v) => set('charts', f.charts.map((x, j) => (j === i ? v : x)))} />)}</div>
        <p className="text-xs text-slate-500">Warna utama dan aksen menurunkan seluruh skala warna aplikasi. Warna grafik dipakai pada dashboard (jenis WO); status (hijau/merah/kuning) tetap. Pilih warna yang serumpun dengan navy dan emas agar tetap selaras.</p>
      </div>

      <div className="rounded-xl border p-3">
        <div className="subheader mb-2">Pratinjau panel login</div>
        <div className="relative isolate overflow-hidden rounded-lg p-5 text-white" style={{ background: f.primary }}>
          <div className="contour absolute inset-0 -z-10 opacity-60" />
          {b.logoUrl ? <img src={imgUrl(b.logoUrl, { w: 300, trim: true })} alt="" className="mb-2 h-12 w-auto object-contain" /> : <div className="mb-2 font-display text-2xl font-extrabold">{f.companyName}</div>}
          <div className="text-[11px] tracking-[0.16em] text-slate-300">{f.subtitle}</div>
          <div className="mt-3 font-display text-xl font-semibold" style={{ color: f.accent }}>{f.tagline}</div>
          <div className="my-2 h-0.5 w-10" style={{ background: f.accent }} />
          <div className="font-display text-sm text-slate-100">{lines.map((l, i) => <p key={i}>{l}</p>)}</div>
          <div className="mt-3 flex gap-2"><span className="rounded-md px-3 py-1 text-xs font-semibold" style={{ background: f.accent, color: f.primary }}>Tombol utama</span>{f.charts.map((c, i) => <i key={i} className="h-6 w-6 rounded" style={{ background: c }} />)}</div>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={b.requireGps} onChange={(e) => a.run(async () => { await api('/admin/settings/app', { method: 'PUT', body: { requireGps: e.target.checked } }); await loadBranding(true); reload(); }, 'Kebijakan GPS disimpan')} /> Wajibkan GPS pada foto teknisi (FOC) <span className="text-xs text-slate-500">— matikan hanya untuk uji coba tanpa HTTPS</span></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={b.optimizeImages} onChange={(e) => a.run(async () => { await api('/admin/settings/app', { method: 'PUT', body: { optimizeImages: e.target.checked } }); await loadBranding(true); reload(); }, 'Kompresi tampilan gambar disimpan')} /> Tampilkan gambar terkompresi <span className="text-xs text-slate-500">— berkas asli tetap tersimpan utuh; matikan untuk kembali memakai berkas asli (rollback)</span></label>
      <AppUrlField d={d} reload={reload} />
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={a.busy || !valid} onClick={save}>Simpan tampilan</button>
        <button className="btn-ghost" disabled={a.busy} onClick={reset}>Kembalikan ke bawaan MAUNG</button>
        {!valid && <span className="text-xs text-red-600">Format warna harus #RRGGBB</span>}
      </div>
      <Msg m={a.msg} />
    </div>
  );
}

function SmtpCard({ d, reload }: { d: any; reload: () => void }) {
  const s = d.smtp;
  const [f, setF] = useState({ host: s.host, port: String(s.port), secure: s.secure, user: s.user, pass: '', from: s.from });
  const [to, setTo] = useState('');
  const a = useAction();
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Email (SMTP pengirim)</h2><Badge tone={s.source === 'db' ? 'green' : s.source === 'env' ? 'blue' : 'amber'}>{s.source === 'db' ? 'Diatur di sini' : s.source === 'env' ? 'Dari .env' : 'Belum diatur (dry-run)'}</Badge></div>
      {s.host && (
        <label className={`flex items-start gap-3 rounded-lg border px-3 py-2 text-sm ${s.enabled ? 'border-green-300 bg-green-50 dark:bg-slate-800' : 'border-amber-300 bg-amber-50 dark:bg-slate-800'}`}>
          <input type="checkbox" className="mt-1" checked={s.enabled} disabled={a.busy} onChange={(e) => a.run(async () => { await api('/admin/settings/smtp/enabled', { method: 'PUT', body: { enabled: e.target.checked } }); reload(); }, e.target.checked ? 'Pengiriman email diaktifkan' : 'Pengiriman email dinonaktifkan')} />
          <span><b>Kirim email: {s.enabled ? 'AKTIF' : 'NONAKTIF'}</b><span className="block text-xs text-slate-600">{s.enabled ? 'Notifikasi dikirim ke email penerima.' : 'Email tidak dikirim (tercatat "Tidak terkirim" di Log notifikasi dan bisa dikirim ulang nanti) — cocok saat uji coba / pengisian data awal.'}</span></span>
        </label>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Server SMTP" help="mis. smtp.gmail.com / smtp.office365.com / mail.perusahaan.co.id"><input className="input" value={f.host} onChange={(e) => set('host', e.target.value)} placeholder="smtp.contoh.com" /></Field>
        <Field label="Port" help="587 (STARTTLS) atau 465 (SSL)"><input className="input" type="number" value={f.port} onChange={(e) => set('port', e.target.value)} /></Field>
        <Field label="Username"><input className="input" value={f.user} onChange={(e) => set('user', e.target.value)} autoComplete="off" /></Field>
        <Field label="Password / App Password" help={s.hasPass ? 'Tersimpan (terenkripsi). Kosongkan untuk tetap memakai yang lama.' : 'Disimpan terenkripsi di database.'}><PasswordInput className="input" value={f.pass} onChange={(e) => set('pass', e.target.value)} placeholder={s.hasPass ? '••••••••' : ''} autoComplete="new-password" /></Field>
        <Field label="Alamat pengirim (From)" help='contoh: noreply@perusahaan.co.id — nama pengirim otomatis memakai Nama aplikasi; alamat harus yang diizinkan SMTP Anda'><input className="input" value={f.from} onChange={(e) => set('from', e.target.value)} /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={f.secure} onChange={(e) => set('secure', e.target.checked)} /> SSL langsung (port 465)</label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={a.busy} onClick={() => a.run(async () => { await api('/admin/settings/smtp', { method: 'PUT', body: { host: f.host, port: Number(f.port), secure: f.secure, user: f.user, from: f.from, ...(f.pass ? { pass: f.pass } : {}) } }); set('pass', ''); reload(); }, f.host ? 'Pengaturan SMTP disimpan' : 'Pengaturan SMTP dihapus (kembali ke .env/dry-run)')}>Simpan SMTP</button>
        <input className="input w-64" type="email" placeholder="kirim email uji ke…" value={to} onChange={(e) => setTo(e.target.value)} />
        <button className="btn-ghost" disabled={a.busy || !to} onClick={() => a.run(() => api('/admin/settings/smtp/test', { body: { to } }), `Email uji terkirim ke ${to} — cek inbox/spam`)}>Kirim tes</button>
      </div>
      <Msg m={a.msg} />
    </div>
  );
}

function TelegramCard({ d, reload }: { d: any; reload: () => void }) {
  const t = d.telegram;
  const [token, setToken] = useState('');
  const [chats, setChats] = useState<Record<string, string>>(t.roleChats ?? {});
  const [base, setBase] = useState(() => (API.startsWith('https://') ? API : ''));
  const [chatId, setChatId] = useState('');
  const [info, setInfo] = useState<any>(null);
  const a = useAction();
  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between"><h2 className="font-semibold">Bot Telegram</h2><Badge tone={t.hasToken ? 'green' : 'amber'}>{t.hasToken ? `Token ${t.tokenHint}${t.botUsername ? ` · @${t.botUsername}` : ''}` : 'Belum diatur (dry-run)'}</Badge></div>
      <ol className="list-decimal space-y-0.5 pl-5 text-sm text-slate-600">
        <li>Di Telegram buka <b>@BotFather</b> → kirim <code>/newbot</code> → ikuti langkahnya → salin <b>token</b>.</li>
        <li>Tempel token di bawah → <b>Simpan</b> → <b>Cek bot</b>.</li>
        <li>Isi URL API publik (<b>https</b>) → <b>Pasang webhook</b> agar bot bisa menautkan akun (<code>/link</code>) — butuh domain HTTPS (mode Caddy).</li>
        <li>Opsional: buat grup divisi, tambahkan bot, kirim <code>/id</code> di grup, tempel angka chat ID di kolom divisi.</li>
      </ol>
      <details className="rounded-lg border bg-slate-50 p-3 text-sm dark:bg-slate-800">
        <summary className="cursor-pointer font-medium">Apa itu webhook, dan kapan dipakai?</summary>
        <div className="mt-2 space-y-2 text-slate-600">
          <p><b>Webhook</b> = alamat di server kita yang <i>dihubungi Telegram</i> setiap ada pesan masuk ke bot (kebalikan dari notifikasi, di mana kita yang mengirim). Di sini dipakai agar karyawan bisa menautkan akunnya: buka halaman <b>Profil → Buat kode tautan</b>, lalu kirim <code>/link KODE</code> ke bot. Telegram meneruskan pesan itu ke webhook, aplikasi mencocokkan kode, dan akun terhubung.</p>
          <p><b>Contoh alurnya:</b> Andi mengirim <code>/link 9F3A1C2B</code> → Telegram melakukan <code>POST https://api.perusahaan.co.id/api/telegram/webhook/&lt;secret&gt;</code> dengan isi <code>{'{'}"message":{'{'}"chat":{'{'}"id":123456789{'}'},"text":"/link 9F3A1C2B"{'}'}{'}'}</code> → aplikasi menyimpan chat id 123456789 pada akun Andi dan membalas “✅ Akun berhasil terhubung”.</p>
          <p><b>Syarat:</b> alamat harus <b>HTTPS publik</b> (domain, mis. lewat mode Caddy). Tanpa webhook, notifikasi keluar ke Telegram <u>tetap jalan</u>; hanya perintah <code>/link</code> yang tidak bisa dipakai. <i>Secret</i> di ujung alamat dibuat otomatis agar hanya Telegram yang bisa memanggilnya.</p>
        </div>
      </details>
      <Field label="Token bot" help={t.hasToken ? 'Tersimpan terenkripsi. Kosongkan untuk tetap memakai yang lama.' : 'Format: 123456789:AA…'}><PasswordInput className="input max-w-xl" value={token} onChange={(e) => setToken(e.target.value)} placeholder={t.hasToken ? t.tokenHint : ''} autoComplete="new-password" /></Field>
      <div>
        <div className="mb-1 text-sm font-medium">Grup/chat per divisi (opsional)</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {Object.keys(ROLE_LABEL).map((r) => (
            <label key={r} className="text-xs text-slate-500">{ROLE_LABEL[r]}<input className="input mt-0.5" placeholder="-1001234567890" value={chats[r] ?? ''} onChange={(e) => setChats((p) => ({ ...p, [r]: e.target.value }))} /></label>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn" disabled={a.busy} onClick={() => a.run(async () => { await api('/admin/settings/telegram', { method: 'PUT', body: { ...(token ? { token } : {}), roleChats: chats } }); setToken(''); reload(); }, 'Pengaturan Telegram disimpan')}>Simpan</button>
        <button className="btn-ghost" disabled={a.busy} onClick={() => a.run(async () => { const r = await api('/admin/settings/telegram/check', { body: {} }); setInfo(r); reload(); }, 'Bot terhubung')}>Cek bot</button>
      </div>
      {info && <p className="rounded-lg bg-slate-100 p-3 text-sm">Bot: <b>@{info.bot.username}</b> ({info.bot.name}) · Webhook: {info.webhook.url || <span className="text-amber-700">belum dipasang</span>}{info.webhook.lastError && <span className="text-red-600"> · error terakhir: {info.webhook.lastError}</span>} · antrean: {info.webhook.pending}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="URL API publik (https)" help="Alamat yang bisa dijangkau Telegram — pada mode SSL satu-domain sama dengan alamat aplikasi, mis. https://wo.perusahaan.co.id"><input className="input w-80" value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://wo.contoh.co.id" /></Field>
        <button className="btn-ghost" disabled={a.busy || !base} onClick={() => a.run(() => api('/admin/settings/telegram/webhook', { body: { baseUrl: base } }), 'Webhook terpasang')}>Pasang webhook</button>
        <button className="btn-ghost" disabled={a.busy} onClick={() => a.run(() => api('/admin/settings/telegram/delete-webhook', { body: {} }), 'Webhook dihapus')}>Hapus webhook</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input w-64" placeholder="chat ID untuk tes" value={chatId} onChange={(e) => setChatId(e.target.value)} />
        <button className="btn-ghost" disabled={a.busy || !chatId} onClick={() => a.run(() => api('/admin/settings/telegram/test', { body: { chatId } }), 'Pesan uji terkirim')}>Kirim tes</button>
      </div>
      <Msg m={a.msg} />
    </div>
  );
}

function RadiusCard() {
  const { data, reload } = useFetch<any>('/admin/radius');
  const [v, setV] = useState<any>(null);
  const [token, setToken] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const cur = v ?? data;
  if (!cur) return null;
  const upd = (k: string, val: unknown) => setV({ ...cur, [k]: val });
  const save = async () => {
    setErr(''); setBusy(true);
    try { await api('/admin/radius', { method: 'PUT', body: { baseUrl: cur.baseUrl, token: token || undefined, enabled: cur.enabled, intervalMin: Number(cur.intervalMin), autoForm: cur.autoForm !== false } }); toast.success('Pengaturan MSRadius disimpan'); setToken(''); setV(null); await reload(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const test = async () => { setErr(''); setBusy(true); try { const r = await api<any>('/admin/radius/test', { body: {} }); toast.success(`Koneksi MSRadius OK (${r.users} user terdaftar di master).`); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  return (
    <div className="card space-y-3">
      <h2 className="font-semibold">Integrasi MSRadius (baca-saja)</h2>
      <p className="text-sm text-slate-500">Maung hanya <b>membaca</b> data pelanggan &amp; paket dari MSRadius — tidak pernah menulis/menghapus di sana. Token dibuat di MSRadius (Setting → User → Panel). Alamat API memakai HTTP polos; sebaiknya diakses lewat jaringan internal/VPN.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="mb-1 block text-sm font-medium">URL dasar API</label><input className="input" value={cur.baseUrl} onChange={(e) => upd('baseUrl', e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="mb-1 block text-sm font-medium">Token API {cur.tokenSet && <span className="text-xs font-normal text-slate-500">(tersimpan {cur.tokenHint} — kosongkan bila tidak diganti)</span>}</label><PasswordInput className="input font-mono" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={cur.tokenSet ? '••••••••' : 'tempel token di sini'} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cur.enabled} onChange={(e) => upd('enabled', e.target.checked)} /> Sinkron otomatis</label>
        <div><label className="mb-1 block text-sm font-medium">Interval otomatis (menit)</label><input className="input" type="number" min={5} max={1440} value={cur.intervalMin} onChange={(e) => upd('intervalMin', e.target.value)} /></div>
        <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" className="mt-1" checked={cur.autoForm !== false} onChange={(e) => upd('autoForm', e.target.checked)} /><span><b>Buat Formulir Berlangganan otomatis</b> untuk pelanggan berstatus <b>Waiting</b> di MSRadius<span className="block text-xs text-slate-500">Satu formulir per pelanggan (tidak ganda), sumber "MSRadius"; Marketing mendapat notifikasi lalu melanjutkannya menjadi WO Pasang Baru. Status layanan MSRadius (Waiting/Online/Offline/Isolir/Disable) dan area pelanggan ikut disinkron.</span></span></label>
        <p className="text-xs text-slate-500 sm:col-span-2">Nama pelanggan dirapikan otomatis: garis bawah (_) dianggap spasi, dan nama huruf besar semua dijadikan huruf kapital di awal kata (PANJI_AGUNG → Panji Agung).</p>
      </div>
      <ErrorMsg>{err}</ErrorMsg>
      <div className="flex flex-wrap gap-2"><button className="btn" disabled={busy} onClick={save}>Simpan</button><button className="btn-ghost" disabled={busy || !cur.tokenSet} onClick={test}>Uji koneksi</button></div>
      {cur.runs.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">Riwayat sinkron</h3>
          <Table head={['Mulai', 'Pemicu', 'Status', 'Baru', 'Diperbarui', 'Tetap', 'Hilang di MSRadius', 'Paket', 'Area']}>
            {cur.runs.map((r: any) => <tr key={r.id}><td className="td text-xs">{fmtDate(r.startedAt)}</td><td className="td text-xs">{r.trigger}</td><td className="td"><Badge tone={r.status === 'OK' ? 'green' : r.status === 'ERROR' ? 'red' : 'blue'}>{r.status}</Badge>{r.error && <div className="text-xs text-red-600">{r.error}</div>}</td><td className="td">{r.created}</td><td className="td">{r.updated}</td><td className="td">{r.unchanged}</td><td className="td">{r.missing}</td><td className="td">{r.packages}</td><td className="td">{r.areas}</td></tr>)}
          </Table>
        </div>
      )}
    </div>
  );
}

function SubFormCard() {
  const { data, reload } = useFetch<any>('/subscription-settings');
  const [v, setV] = useState<any>(null);
  const [err, setErr] = useState('');
  const cur = v ?? data;
  if (!cur) return null;
  const f = (k: string, label: string, help?: string, rows?: number) => (
    <div><label className="mb-1 block text-sm font-medium">{label}</label>{rows ? <textarea className="input" rows={rows} value={cur[k]} onChange={(e) => setV({ ...cur, [k]: e.target.value })} /> : <input className="input" value={cur[k]} onChange={(e) => setV({ ...cur, [k]: e.target.value })} />}{help && <p className="mt-0.5 text-xs text-slate-500">{help}</p>}</div>
  );
  return (
    <div className="card space-y-3">
      <h2 className="font-semibold">Formulir Berlangganan</h2>
      <p className="text-sm text-slate-500">Reg. No. dibentuk <b>{cur.regPrefix}{cur.year3}</b> + nomor urut otomatis 4 digit (3 digit tahun otomatis: 2027 → 027). Logo formulir & tanda tangan Manager Marketing diunggah di kartu Branding.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {f('regPrefix', 'Awalan Reg. No.', 'Huruf saja, mis. SM')}
        {f('managerName', 'Manager Marketing (bawaan)')}
        <div><label className="mb-1 block text-sm font-medium">Nomor urut pertama tahun ini</label><input className="input" type="number" min={1} value={cur.regSeqStart ?? 1} onChange={(e) => setV({ ...cur, regSeqStart: e.target.value })} /><p className="mt-0.5 text-xs text-slate-500">Reg. No. dibuat otomatis berurutan ({cur.regPrefix}{cur.year3}0001, …). Isi bila perlu melanjutkan nomor lama, mis. 120 → {cur.regPrefix}{cur.year3}0120.</p></div>
        <div className="sm:col-span-2 rounded-lg border p-3"><label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={cur.regEditable !== false} onChange={(e) => setV({ ...cur, regEditable: e.target.checked })} /><span><b>Nomor Reg. dapat diisi/diubah Marketing</b> (masa migrasi) — kosong = otomatis, bila diisi tercatat sesuai isian (tidak boleh sama dengan nomor yang sudah ada) dan urutan otomatis melanjutkan dari nomor tertinggi. <b>Matikan</b> setelah migrasi selesai agar nomor selalu otomatis berurutan.</span></label></div>
        {f('city', 'Kota')}{f('ppnNote', 'Keterangan PPN biaya langganan')}
        {f('bankName', 'Nama bank')}{f('accName', 'Atas nama rekening')}{f('accNo', 'No. rekening')}
        <div><label className="mb-1 block text-sm font-medium">Pembayaran bawaan</label><Select className="input" value={cur.defaultPayment} onChange={(e) => setV({ ...cur, defaultPayment: e.target.value })}><option value="TRANSFER">Transfer</option><option value="CASH">Tunai</option><option value="DEBIT">Debet</option></Select></div>
        <div className="sm:col-span-2">{f('footer', 'Teks kaki halaman (alamat, telepon, web)', undefined, 3)}</div>
      </div>
      <ErrorMsg>{err}</ErrorMsg>
      <button className="btn" onClick={async () => { setErr(''); try { const { year3, ...body } = cur; void year3; await api('/admin/settings/subform', { method: 'PUT', body: { ...body } }); toast.success('Pengaturan formulir disimpan'); setV(null); await reload(); } catch (e) { setErr((e as Error).message); } }}>Simpan</button>
    </div>
  );
}

function ServiceOrderCard() {
  const { data, reload } = useFetch<any>('/admin/settings/service-order');
  const [v, setV] = useState<any>(null);
  const [err, setErr] = useState('');
  const cur = v ?? data;
  if (!cur) return null;
  const f = (k: string, label: string, help: string, rows: number) => (
    <div><label className="mb-1 block text-sm font-medium">{label}</label><textarea className="input" rows={rows} value={cur[k]} onChange={(e) => setV({ ...cur, [k]: e.target.value })} /><p className="mt-0.5 text-xs text-slate-500">{help}</p></div>
  );
  return (
    <div className="card space-y-3">
      <h2 className="font-semibold">Berita Acara &amp; Garansi — Order Jasa/Produk</h2>
      <p className="text-sm text-slate-500">Template BA untuk order non-internet (dari penawaran CRM). Dipakai pada pesan BA dan halaman cetak. Kata pengganti yang tersedia: <code>{'{nama}'}</code> <code>{'{penawaran}'}</code> <code>{'{nomor_ba}'}</code> <code>{'{alamat}'}</code> <code>{'{tanggal}'}</code>. Kosongkan kolom lalu simpan untuk kembali ke teks bawaan.</p>
      <div><label className="mb-1 block text-sm font-medium">Judul BA</label><input className="input" value={cur.baTitle} onChange={(e) => setV({ ...cur, baTitle: e.target.value })} /></div>
      {f('baIntro', 'Kalimat pembuka', 'Contoh: Yth. {nama}, pekerjaan sesuai penawaran {penawaran} telah selesai…', 4)}
      {f('warrantyText', 'Ketentuan garansi', 'Dicantumkan pada bagian "Garansi" di BA. Atur masa garansi barang & jasa sesuai kebijakan.', 6)}
      {f('baFooter', 'Kalimat penutup', 'Muncul di bawah garansi, di atas tanda tangan.', 3)}
      <ErrorMsg>{err}</ErrorMsg>
      <div className="flex gap-2">
        <button className="btn" onClick={async () => { setErr(''); try { const { defaults: _d, ...body } = cur; void _d; await api('/admin/settings/service-order', { method: 'PUT', body }); toast.success('Template BA jasa disimpan'); setV(null); await reload(); } catch (e) { setErr((e as Error).message); } }}>Simpan</button>
        <button className="btn-ghost" onClick={() => setV({ ...cur, baTitle: '', baIntro: '', warrantyText: '', baFooter: '' })}>Isi ulang dengan bawaan</button>
      </div>
    </div>
  );
}

function DocsCard() {
  const { data, reload } = useFetch<any>('/settings/docs');
  const [v, setV] = useState<any>(null);
  const cur = v ?? data;
  const [err, setErr] = useState('');
  if (!cur) return null;
  const f = (k: string, label: string, help?: string, type = 'text') => (
    <div><label className="mb-1 block text-sm font-medium">{label}</label><input className="input" type={type} value={cur[k]} onChange={(e) => setV({ ...cur, [k]: e.target.value })} />{help && <p className="mt-0.5 text-xs text-slate-500">{help}</p>}</div>
  );
  return (
    <div className="card space-y-3">
      <h2 className="font-semibold">Dokumen (Purchase Request)</h2>
      <p className="text-sm text-slate-500">Nomor surat berformat <b>{cur.seqStart}/{String(cur.codePrefix).replace('{ALIAS}', 'BDG')}/X/{new Date().getFullYear()}</b> (nomor urut / kode / bulan romawi / tahun). Nomor urut berjalan per tahun.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {f('codePrefix', 'Kode surat', 'Gunakan {ALIAS} untuk singkatan area PR, mis. L1V/PNJ-{ALIAS} → L1V/PNJ-BDG. Atur singkatan di Master Data → Area.')}
        {f('city', 'Kota penandatanganan')}
        {f('seqStart', 'Nomor urut pertama tahun ini', 'Isi bila perlu melanjutkan nomor dari dokumen lama (mis. 251)', 'number')}
        {f('taxPct', 'PPN bawaan (%)', undefined, 'number')}
        {f('minVendors', 'Minimal vendor per baris perbandingan', undefined, 'number')}
      </div>
      <h3 className="pt-1 text-sm font-semibold">Penandatangan bawaan (dapat diubah GA/Procurement saat menerbitkan PR)</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {f('signRequesterTitle', 'Jabatan pengaju (bawaan)', 'Kosong = jabatan pembuat PR')}<div />
        {f('signKnow', 'Mengetahui — nama')}{f('signKnowTitle', 'Mengetahui — jabatan')}
        {f('signApprove', 'Menyetujui — nama')}{f('signApproveTitle', 'Menyetujui — jabatan')}
      </div>
      <ErrorMsg>{err}</ErrorMsg>
      <button className="btn" onClick={async () => { setErr(''); try { await api('/admin/settings/docs', { method: 'PUT', body: { ...cur } }); toast.success('Pengaturan dokumen disimpan'); setV(null); await reload(); } catch (e) { setErr((e as Error).message); } }}>Simpan</button>
    </div>
  );
}

function WhatsappCard({ d, reload }: { d: any; reload: () => void }) {
  const w = d.whatsapp;
  const [f, setF] = useState({ provider: w.provider as string, baseUrl: w.baseUrl as string, headerName: w.headerName as string, bodyTemplate: w.bodyTemplate as string, workspaceId: (w.workspaceId ?? '') as string, templateId: (w.templateId ?? '') as string, channelId: (w.channelId ?? '') as string, varMode: (w.varMode ?? '1') as string, token: '' });
  const [to, setTo] = useState('');
  const [eps, setEps] = useState<any>(null);
  const [sample, setSample] = useState<Record<string, any>>({});
  const a = useAction();
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));
  const loadEps = () => api<any>('/admin/whatsapp/endpoints').then(setEps).catch(() => {});
  useEffect(() => { loadEps(); }, [w.provider, w.hasToken]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">WhatsApp (gateway pihak ketiga)</h2><Badge tone={w.hasToken ? 'green' : 'amber'}>{w.hasToken ? `Token ${w.tokenHint}` : 'Belum diatur'}</Badge></div>
        <p className="text-sm text-slate-500">Dipakai untuk mengirim BA Digital (dan notifikasi lain bila diaktifkan) lewat WhatsApp. Setiap pesan <b>berbiaya</b> di penyedia gateway, karena itu pengiriman <b>bawaan MATI</b> — nyalakan dengan sakelar di bawah hanya saat dibutuhkan.</p>
        <label className={`flex items-start gap-3 rounded-lg border px-3 py-2 text-sm ${w.enabled ? 'border-green-300 bg-green-50 dark:bg-slate-800' : 'border-amber-300 bg-amber-50 dark:bg-slate-800'}`}>
          <input type="checkbox" className="mt-1" checked={w.enabled} disabled={a.busy} onChange={(e) => a.run(async () => { await api('/admin/settings/whatsapp/enabled', { method: 'PUT', body: { enabled: e.target.checked } }); reload(); }, e.target.checked ? 'Pengiriman WhatsApp diaktifkan' : 'Pengiriman WhatsApp dinonaktifkan')} />
          <span><b>Kirim WhatsApp: {w.enabled ? 'AKTIF' : 'NONAKTIF'}</b><span className="block text-xs text-slate-600">{w.enabled ? 'Pesan dikirim lewat gateway (berbiaya).' : 'Pesan WhatsApp tidak dikirim — tercatat "Tidak terkirim" di Log notifikasi dan dapat dikirim ulang setelah sakelar dinyalakan.'}</span></span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Penyedia"><Select className="input" value={f.provider} onChange={(e) => { set('provider', e.target.value); set('baseUrl', e.target.value === 'fonnte' ? 'https://api.fonnte.com' : e.target.value === 'kanca' ? 'https://kanca.space' : ''); }}><option value="fonnte">Fonnte (siap pakai)</option><option value="kanca">Kanca (WhatsApp Business / WABA)</option><option value="custom">Gateway lain (HTTP umum)</option></Select></Field>
          <Field label="Token / API key" help={w.hasToken ? 'Tersimpan terenkripsi. Kosongkan untuk tetap memakai yang lama.' : 'Dari dashboard penyedia; disimpan terenkripsi.'}><PasswordInput className="input" value={f.token} onChange={(e) => set('token', e.target.value)} autoComplete="off" /></Field>
          <Field label={f.provider === 'custom' ? 'URL endpoint kirim pesan' : 'URL dasar'} help={f.provider === 'fonnte' ? 'Bawaan https://api.fonnte.com' : f.provider === 'kanca' ? 'Bawaan https://kanca.space (sama dengan Inbound URL di dashboard Kanca); bila gagal coba https://api.kanca.space' : 'mis. https://gateway.contoh.id/api/send'}><input className="input" value={f.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} /></Field>
          {f.provider === 'kanca' && <Field label="Workspace ID" help="Slug workspace Kanca, mis. tokomakmur-4231 (dashboard → Integrasi)"><input className="input" value={f.workspaceId} onChange={(e) => set('workspaceId', e.target.value)} /></Field>}
          {f.provider === 'kanca' && <Field label="Template notifikasi (UUID)" help="Template WABA berstatus APPROVED. Kosong = kirim teks bebas (hanya sampai ke penerima yang chat dalam 24 jam). Pilih dari daftar di menu API Kanca."><input className="input font-mono text-xs" value={f.templateId} onChange={(e) => set('templateId', e.target.value)} placeholder="9388eb83-…" /></Field>}
          {f.provider === 'kanca' && <Field label="Variabel template" help="Sesuaikan dengan jumlah {{ }} di template Anda"><Select className="input" value={f.varMode} onChange={(e) => set('varMode', e.target.value)}><option value="1">1 variabel: {'{{1}}'} = judul — isi</option><option value="2">2 variabel: {'{{1}}'} = judul, {'{{2}}'} = isi</option></Select></Field>}
          {f.provider === 'kanca' && <Field label="Channel ID (opsional)" help="Hanya bila workspace punya lebih dari 1 channel WABA"><input className="input font-mono text-xs" value={f.channelId} onChange={(e) => set('channelId', e.target.value)} /></Field>}
          {f.provider === 'custom' && <Field label="Nama header token" help="mis. Authorization atau X-API-KEY"><input className="input" value={f.headerName} onChange={(e) => set('headerName', e.target.value)} /></Field>}
          {f.provider === 'custom' && <div className="sm:col-span-2"><Field label="Templat body JSON" help="Wajib memuat {{to}} dan {{message}} (otomatis diberi tanda kutip). Contoh: {&quot;to&quot;:{{to}},&quot;message&quot;:{{message}}}"><textarea className="input font-mono text-xs" rows={3} value={f.bodyTemplate} onChange={(e) => set('bodyTemplate', e.target.value)} /></Field></div>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn" disabled={a.busy} onClick={() => a.run(async () => { await api('/admin/settings/whatsapp', { method: 'PUT', body: { provider: f.provider, baseUrl: f.baseUrl, headerName: f.headerName, bodyTemplate: f.bodyTemplate, workspaceId: f.workspaceId, templateId: f.templateId, channelId: f.channelId, varMode: f.varMode, ...(f.token ? { token: f.token } : {}) } }); set('token', ''); reload(); }, 'Pengaturan WhatsApp disimpan')}>Simpan WhatsApp</button>
          <input className="input w-56" placeholder="nomor uji, mis. 0812…" value={to} onChange={(e) => setTo(e.target.value)} />
          <button className="btn-ghost" disabled={a.busy || !to || !w.hasToken} onClick={() => a.run(() => api('/admin/settings/whatsapp/test', { body: { to } }), `Pesan uji dikirim ke ${to} (berbiaya)`)}>Kirim tes</button>
        </div>
        <Msg m={a.msg} />
      </div>
      <div className="card space-y-3">
        <h2 className="font-semibold">Endpoint API WhatsApp yang dapat ditarik</h2>
        <p className="text-sm text-slate-500">Daftar endpoint penyedia yang dipakai/dapat dipakai, dengan contoh respons nyata untuk yang <b>tidak berbiaya</b>. Endpoint pengiriman pesan tidak diberi contoh otomatis (berbiaya) — gunakan <b>Kirim tes</b>. Daftar mengikuti dokumentasi umum penyedia; cocokkan dengan dokumen resmi akun Anda.</p>
        {!eps || !eps.endpoints.length ? <p className="text-sm text-slate-400">{eps ? (w.provider === 'kanca' ? 'Untuk Kanca, lihat info workspace, saldo, template dan riwayat pesan di menu Sistem → API Kanca.' : 'Penyedia "gateway lain" tidak punya katalog bawaan — pakai Kirim tes untuk memeriksa koneksi.') : 'Memuat…'}</p> : eps.endpoints.map((e: any) => (
          <div key={e.key} className="space-y-1.5 rounded-lg border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0"><div className="font-medium">{e.title}</div><code className="break-all text-xs text-slate-600">{e.method} {eps.baseUrl}{e.path}</code></div>
              {e.safe ? <button className="btn-ghost" disabled={!eps.tokenSet} onClick={async () => { setSample((x) => ({ ...x, [e.key]: { loading: true } })); try { setSample((x) => ({ ...x, [e.key]: { out: undefined } })); const out = await api<any>(`/admin/whatsapp/endpoints/${e.key}/sample`, { body: {} }); setSample((x) => ({ ...x, [e.key]: { out } })); } catch (er) { setSample((x) => ({ ...x, [e.key]: { err: (er as Error).message } })); } }}>Ambil contoh</button> : <Badge tone="amber">berbiaya</Badge>}
            </div>
            <p className="text-xs text-slate-500">{e.note}</p>
            {sample[e.key]?.err && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{sample[e.key].err}</p>}
            {sample[e.key]?.out && <pre className="max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(sample[e.key].out.sample, null, 2)}</pre>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** SSL & Domain (Let's Encrypt via Caddy): status sertifikat, sakelar HTTPS, paksa-redirect. */
function SslCard() {
  const { data, error, reload } = useFetch<any>('/admin/ssl');
  const [f, setF] = useState<any>(null);
  const a = useAction();
  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  if (!data) return <p className="text-slate-500">Memuat…</p>;
  const cfg = f ?? data.cfg;
  const set = (k: string, v: any) => setF({ ...cfg, [k]: v });
  const cert = data.cert;
  const dirty = !!f;
  const save = () => a.run(async () => { await api('/admin/ssl', { method: 'PUT', body: cfg }); setF(null); reload(); }, 'Disimpan — Caddy memuat ulang otomatis (beberapa detik)');
  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="font-semibold">SSL & Domain (Let&apos;s Encrypt)</h2><p className="text-sm text-slate-500">Sertifikat HTTPS diterbitkan <b>dan diperpanjang otomatis</b> oleh Caddy (±30 hari sebelum habis). Syarat: domain mengarah ke IP publik server dan port 80 &amp; 443 terbuka.</p></div>
        <Badge tone={!data.available ? 'slate' : !data.cfg.enabled ? 'amber' : cert?.ok ? 'green' : 'amber'}>{!data.available ? 'Mode HTTPS belum dipasang' : !data.cfg.enabled ? 'SSL nonaktif' : cert?.ok ? 'SSL aktif' : 'Menunggu sertifikat'}</Badge>
      </div>
      {!data.available && <p className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800">Server ini berjalan tanpa Caddy (HTTP saja). Aktifkan HTTPS dengan: <code>bash scripts/deploy.sh --domain wo.perusahaan.co.id --email admin@perusahaan.co.id</code>. Setelah itu halaman ini dapat dipakai untuk mengatur SSL.</p>}
      {data.available && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm"><span className="label">Domain</span><input className="input" value={cfg.domain} onChange={(e) => set('domain', e.target.value)} placeholder="wo.perusahaan.co.id" /><span className="mt-0.5 block text-xs text-slate-500">DNS A record: {data.dnsIps.length ? <b>{data.dnsIps.join(', ')}</b> : <i>belum terdeteksi</i>}</span></label>
            <label className="block text-sm"><span className="label">Email pemberitahuan Let&apos;s Encrypt</span><input className="input" value={cfg.email} onChange={(e) => set('email', e.target.value)} placeholder="admin@perusahaan.co.id" /><span className="mt-0.5 block text-xs text-slate-500">Dipakai Let&apos;s Encrypt bila perpanjangan bermasalah.</span></label>
          </div>
          <label className="flex items-start gap-3 rounded-lg border px-3 py-2 text-sm"><input type="checkbox" className="mt-1" checked={cfg.enabled} onChange={(e) => set('enabled', e.target.checked)} /><span><b>SSL (HTTPS) aktif</b><span className="block text-xs text-slate-600">Mematikan SSL membuat aplikasi hanya melayani HTTP biasa (kamera/GPS di HP dan webhook Telegram memerlukan HTTPS). Sertifikat yang sudah terbit tetap tersimpan dan dapat dipakai lagi saat SSL dinyalakan.</span></span></label>
          <label className={`flex items-start gap-3 rounded-lg border px-3 py-2 text-sm ${cfg.enabled ? '' : 'opacity-50'}`}><input type="checkbox" className="mt-1" disabled={!cfg.enabled} checked={cfg.forceRedirect} onChange={(e) => set('forceRedirect', e.target.checked)} /><span><b>Paksa HTTPS (alihkan HTTP → HTTPS otomatis)</b><span className="block text-xs text-slate-600">Dinyalakan otomatis begitu sertifikat sah terpasang, supaya Anda tidak terkunci saat sertifikat belum terbit. Akses lewat alamat IP tetap HTTP biasa (jalur pemulihan).</span></span></label>
          <div className="rounded-lg border p-3 text-sm">
            <div className="mb-1 font-medium">Status sertifikat</div>
            {!data.cfg.enabled ? <p className="text-slate-500">SSL nonaktif.</p> : !cert ? <p className="text-slate-500">—</p> : cert.ok ? (
              <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-3"><div><dt className="text-xs text-slate-500">Penerbit</dt><dd>{cert.issuer || '-'}</dd></div><div><dt className="text-xs text-slate-500">Berlaku sampai</dt><dd>{fmtDate(cert.validTo)}</dd></div><div><dt className="text-xs text-slate-500">Sisa</dt><dd><Badge tone={cert.daysLeft > 14 ? 'green' : 'amber'}>{cert.daysLeft} hari</Badge> <span className="text-xs text-slate-500">diperpanjang otomatis</span></dd></div></dl>
            ) : <p className="text-amber-700 dark:text-amber-300">{cert.error ?? 'Sertifikat belum terpasang'} — Caddy mencoba menerbitkan otomatis. Pastikan DNS sudah mengarah ke server &amp; port 80/443 terbuka; cek <code>docker compose logs caddy</code>. Selama belum terbit, aplikasi tetap bisa dibuka lewat HTTP.</p>}
            {data.cfg.enabled && <p className="mt-2 text-xs text-slate-500">Redirect HTTP→HTTPS: <b>{data.redirectActive ? 'AKTIF' : cfg.forceRedirect ? 'menunggu sertifikat' : 'nonaktif'}</b></p>}
          </div>
          <div className="flex flex-wrap items-center gap-3"><button className="btn" disabled={a.busy || !dirty} onClick={save}>Simpan & terapkan</button>{dirty && <button className="btn-ghost" onClick={() => setF(null)}>Batal</button>}<button className="btn-ghost" onClick={reload}>↻ Periksa ulang</button></div>
          <Msg m={a.msg} />
          <details className="text-xs"><summary className="cursor-pointer text-slate-500">Lihat Caddyfile yang diterapkan</summary><pre className="mt-1 max-h-60 overflow-auto rounded-lg bg-slate-900 p-3 text-slate-100">{data.preview}</pre></details>
        </>
      )}
    </div>
  );
}

const bytes = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const KIND_LABEL: Record<string, string> = { manual: 'Manual', auto: 'Otomatis harian', 'pre-purge': 'Sebelum purge', 'pre-restore': 'Sebelum restore/demo', unknown: '?' };

/** Data & Backup: backup, restore, purge, data demo, foto. Hanya Admin asli. */
function DataCard() {
  const { user } = useAuth();
  const { data, error, reload } = useFetch<any>(user?.realAdmin ? null : '/admin/data/overview');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [restore, setRestore] = useState<any>(null);
  const [purge, setPurge] = useState({ scope: 1, deleteUsers: false, deleteFiles: true, reseed: false, backupFirst: true, confirm: '' });
  const [demoConfirm, setDemoConfirm] = useState('');
  const [out, setOut] = useState<{ ok: boolean; text: string } | null>(null);
  if (user?.realAdmin) return <ErrorMsg>Berhenti &quot;bertindak sebagai&quot; peran lain dulu untuk memakai menu ini.</ErrorMsg>;
  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  if (!data) return <p className="text-slate-500">Memuat…</p>;
  const run = async (key: string, fn: () => Promise<string>) => { setBusy(key); setOut(null); try { setOut({ ok: true, text: await fn() }); reload(); } catch (e) { setOut({ ok: false, text: (e as Error).message }); } finally { setBusy(''); } };
  const upload = async (path: string, file: File) => {
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch(`${API}/api${path}`, { method: 'POST', headers: { authorization: `Bearer ${getToken()}` }, body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error ?? `Gagal (${res.status})`);
    return j;
  };
  const c = data.counts;
  const scopes = [
    { v: 1, t: 'Transaksi saja', d: 'Hapus semua WO, riwayat, foto laporan, PR/PO, Form Berlangganan, notifikasi, log audit & mutasi stok. Pelanggan, aset, stok, dan master tetap.' },
    { v: 2, t: 'Transaksi + pelanggan, aset & stok', d: 'Seperti di atas, ditambah semua pelanggan (hasil sinkron MSRadius dapat ditarik ulang), aset ber-SN, dan jumlah stok. Master (barang, gudang, area, paket, vendor, merk) tetap.' },
    { v: 3, t: 'Semua data operasional', d: 'Semuanya kecuali akun pengguna & pengaturan: termasuk master barang, gudang, area, paket, vendor. Bisa diisi ulang dengan master awal.' },
  ];
  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h2 className="font-semibold">Ringkasan data</h2>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-4">{[['Pengguna', c.users], ['Pelanggan', c.customers], ['Work Order', c.workOrders], ['Aset ber-SN', c.assets], ['Barang', c.items], ['Gudang', c.warehouses], ['Purchase Request', c.purchaseRequests], ['Form Berlangganan', c.subscriptions]].map(([k, v]) => <div key={k as string}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-semibold">{v}</dd></div>)}</dl>
        <p className="text-xs text-slate-500">Foto/berkas: {data.uploads.files} berkas ({bytes(data.uploads.bytes)}) · folder backup <code>{data.backupDir}</code>{data.disk && <> · ruang disk kosong {bytes(data.disk.freeBytes)} dari {bytes(data.disk.totalBytes)}</>}</p>
      </div>

      {out && <p className={`rounded-lg px-3 py-2 text-sm ${out.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{out.text}</p>}

      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Backup & restore data</h2>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={data.autoDaily} onChange={(e) => run('auto', async () => { await api('/admin/data/auto', { method: 'PUT', body: { autoDaily: e.target.checked } }); return e.target.checked ? 'Backup otomatis harian dinyalakan' : 'Backup otomatis dimatikan'; })} /> Backup otomatis harian (02:30, simpan 7 terakhir)</label></div>
        <p className="text-sm text-slate-500">Backup berisi seluruh data database (pelanggan beserta riwayat perubahannya, WO, stok, PR/PO, akun, pengaturan). Disimpan di server dan bisa diunduh/diunggah. Foto dicadangkan terpisah (bagian bawah). <b>Simpan salinan backup di luar server ini.</b></p>
        <div className="flex flex-wrap items-center gap-2">
          <input className="input w-64" placeholder="catatan (opsional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn" disabled={!!busy} onClick={() => run('backup', async () => { const m = await api<any>('/admin/data/backup', { body: { note } }); setNote(''); return `Backup dibuat: ${m.name} (${bytes(m.size)})`; })}>{busy === 'backup' ? 'Membuat…' : 'Buat backup sekarang'}</button>
          <label className="btn-ghost cursor-pointer">Unggah backup (.json.gz)<input type="file" accept=".gz,.json.gz" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) run('up', async () => { const m = await upload('/admin/data/backups/upload', f); return `Backup diunggah: ${m.name}`; }); }} /></label>
        </div>
        {!data.backups.length ? <p className="text-sm text-slate-400">Belum ada backup.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th className="py-1 pr-3">Waktu</th><th className="pr-3">Jenis</th><th className="pr-3">Ukuran</th><th className="pr-3">Berkas / catatan</th><th /></tr></thead><tbody className="divide-y">
            {data.backups.map((b: any) => (
              <tr key={b.name} className="align-top"><td className="whitespace-nowrap py-1.5 pr-3 text-xs">{fmtDate(b.createdAt)}</td><td className="pr-3"><Badge tone={b.kind === 'manual' ? 'green' : 'slate'}>{KIND_LABEL[b.kind] ?? b.kind}</Badge></td><td className="whitespace-nowrap pr-3">{bytes(b.size)}</td>
                <td className="max-w-[12rem] pr-3 text-xs"><code className="block truncate" title={b.name}>{b.name}</code>{b.note && <div className="text-slate-500">{b.note}</div>}{!b.valid && <div className="text-red-600">{b.error}</div>}</td>
                <td className="whitespace-nowrap text-xs">{b.valid && <><button className="text-brand-700 hover:underline" onClick={() => download(`/admin/data/backups/${b.name}/download`, b.name).catch((e) => setOut({ ok: false, text: e.message }))}>Unduh</button><button className="ml-3 text-amber-700 hover:underline" onClick={() => setRestore({ name: b.name, includeSettings: false, confirm: '' })}>Restore</button></>}<button className="ml-3 text-red-600 hover:underline" onClick={async () => { if (await confirmDialog(`Hapus berkas backup ${b.name}?`, { danger: true })) run('del', async () => { await api(`/admin/data/backups/${b.name}`, { method: 'DELETE' }); return 'Backup dihapus'; }); }}>Hapus</button></td></tr>
            ))}
          </tbody></table></div>
        )}
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold">Foto & berkas unggahan</h2>
        <p className="text-sm text-slate-500">Foto laporan lapangan, logo, dan avatar ada di folder berkas (bukan di database). Unduh sebagai satu berkas .tar.gz atau pulihkan dari berkas serupa. Memulihkan <b>menambahkan/menimpa</b> berkas bernama sama; tidak menghapus yang lain.</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" disabled={!!busy} onClick={() => run('dl', async () => { await download('/admin/data/uploads.tar.gz', `maung-foto-${new Date().toISOString().slice(0, 10)}.tar.gz`); return 'Unduhan foto dimulai'; })}>Unduh backup foto (.tar.gz)</button>
          <label className="btn-ghost cursor-pointer">Pulihkan foto (.tar.gz)<input type="file" accept=".gz,.tgz" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) run('upf', async () => { const r = await upload('/admin/data/uploads/restore', f); return `${r.files} berkas foto dipulihkan`; }); }} /></label>
        </div>
      </div>

      <div className="card space-y-3 border-red-200">
        <h2 className="font-semibold text-red-700">Purge data (hapus data uji)</h2>
        <p className="text-sm text-slate-500">Untuk membersihkan data percobaan sebelum dipakai sungguhan. <b>Akun Admin Anda, logo, dan pengaturan tidak pernah terhapus.</b> Sebelum menghapus, backup otomatis dibuat (bisa di-restore dari daftar di atas).</p>
        <div className="space-y-2">{scopes.map((sc) => <label key={sc.v} className={`flex items-start gap-3 rounded-lg border px-3 py-2 text-sm ${purge.scope === sc.v ? 'border-red-300 bg-red-50 dark:bg-slate-800' : ''}`}><input type="radio" className="mt-1" checked={purge.scope === sc.v} onChange={() => setPurge({ ...purge, scope: sc.v, reseed: sc.v === 3 ? purge.reseed : false })} /><span><b>{sc.t}</b><span className="block text-xs text-slate-600">{sc.d}</span></span></label>)}</div>
        <div className="grid gap-1 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={purge.deleteFiles} onChange={(e) => setPurge({ ...purge, deleteFiles: e.target.checked })} /> Hapus juga berkas foto laporan (logo tidak dihapus)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={purge.deleteUsers} onChange={(e) => setPurge({ ...purge, deleteUsers: e.target.checked })} /> Hapus semua akun <b>non-Admin</b> (akun Admin tetap)</label>
          {purge.scope === 3 && <label className="flex items-center gap-2"><input type="checkbox" checked={purge.reseed} onChange={(e) => setPurge({ ...purge, reseed: e.target.checked })} /> Isi ulang master awal (gudang, barang, paket, area standar) setelah purge</label>}
          <label className="flex items-center gap-2"><input type="checkbox" checked={purge.backupFirst} onChange={(e) => setPurge({ ...purge, backupFirst: e.target.checked })} /> Buat backup dulu <span className="text-xs text-slate-500">(sangat disarankan)</span></label>
        </div>
        <div className="flex flex-wrap items-center gap-2"><input className="input w-56" placeholder="ketik: HAPUS DATA" value={purge.confirm} onChange={(e) => setPurge({ ...purge, confirm: e.target.value })} /><button className="btn !bg-red-600 !text-white" disabled={!!busy || purge.confirm !== 'HAPUS DATA'} onClick={() => run('purge', async () => { const r = await api<any>('/admin/data/purge', { body: purge }); setPurge({ ...purge, confirm: '' }); const total = Object.values(r.deleted as Record<string, number>).reduce((a, b) => a + b, 0); return `Purge selesai: ${total} baris & ${r.removedFiles} berkas dihapus.${r.backup ? ` Backup: ${r.backup}` : ''}`; })}>{busy === 'purge' ? 'Menghapus…' : 'Hapus data'}</button></div>
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold">Data demo</h2>
        <p className="text-sm text-slate-500">Memuat akun demo (<code>mkt@</code>, <code>noc@</code>, <code>citra@</code>, <code>budi@</code>, <code>andi@</code>, <code>ga@</code>, <code>fin@</code> — password = SEED_PASSWORD di <code>.env</code>) beserta WO, pelanggan, stok, dan PR/PO contoh di setiap tahap alur. <b>Akun Admin yang sudah ada tidak diubah</b> (password & akses tetap), jadi Admin tidak terkunci. Backup otomatis dibuat sebelum memuat. Jangan dimuat di data produksi yang sudah berjalan — gunakan Purge dulu bila perlu.</p>
        <div className="flex flex-wrap items-center gap-2"><input className="input w-56" placeholder="ketik: MUAT DEMO" value={demoConfirm} onChange={(e) => setDemoConfirm(e.target.value)} /><button className="btn-ghost" disabled={!!busy || demoConfirm !== 'MUAT DEMO'} onClick={() => run('demo', async () => { await api('/admin/data/demo', { body: { confirm: demoConfirm } }); setDemoConfirm(''); return 'Data demo dimuat'; })}>{busy === 'demo' ? 'Memuat… (beberapa menit)' : 'Muat data demo'}</button></div>
      </div>

      {restore && (
        <Modal title="Restore dari backup" onClose={() => setRestore(null)}>
          <div className="space-y-3 text-sm">
            <p><code className="break-all text-xs">{restore.name}</code></p>
            <p className="rounded-lg bg-amber-100 px-3 py-2 text-amber-800">Restore <b>mengganti seluruh data saat ini</b> dengan isi backup. Backup kondisi sekarang dibuat otomatis lebih dulu. Bila backup gagal dimuat, data tidak berubah (dibatalkan penuh). Akun Admin Anda tetap ada dan password Anda saat ini dipertahankan.</p>
            <label className="flex items-center gap-2"><input type="checkbox" checked={restore.includeSettings} onChange={(e) => setRestore({ ...restore, includeSettings: e.target.checked })} /> Ikut pulihkan <b>pengaturan</b> (SMTP, Telegram, WhatsApp, brand, SSL…) <span className="text-xs text-slate-500">— kredensial terenkripsi hanya terbaca bila JWT_SECRET server sama</span></label>
            <input className="input" placeholder="ketik: RESTORE" value={restore.confirm} onChange={(e) => setRestore({ ...restore, confirm: e.target.value })} />
            <div className="flex justify-end gap-2"><button className="btn-ghost" onClick={() => setRestore(null)}>Batal</button><button className="btn !bg-red-600 !text-white" disabled={restore.confirm !== 'RESTORE' || !!busy} onClick={() => { const r = restore; setRestore(null); run('restore', async () => { const x = await api<any>(`/admin/data/backups/${r.name}/restore`, { body: { includeSettings: r.includeSettings, confirm: r.confirm } }); return `Restore selesai: ${x.rows} baris di ${x.tables} tabel. Backup sebelumnya: ${x.preBackup}. Muat ulang halaman bila ada yang tampak lama.`; }); }}>Restore sekarang</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Pemilih ikon dengan pratinjau: kisi ikon bawaan (Lucide, ISC) per kelompok, atau unggah ikon sendiri (PNG/JPEG/WebP → PNG 192 px). */
function IconPicker({ value, iconUrl, onChange, name, description }: { value: string; iconUrl?: string | null; onChange: (v: { icon?: string; iconUrl?: string | null }) => void; name: string; description: string }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState({ busy: false, err: '' });
  const cur = APP_ICON_ALIAS[value] ?? value;
  const groups = [...new Set(APP_ICONS.map((i) => i.group))];
  async function upload(f: File | undefined) {
    if (!f) return;
    setUp({ busy: true, err: '' });
    try {
      const fd = new FormData(); fd.append('file', f);
      const r = await fetch(`${API}/api/admin/launcher/icon`, { method: 'POST', headers: { authorization: `Bearer ${getToken()}` }, body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `Gagal (${r.status})`);
      onChange({ iconUrl: j.url }); setUp({ busy: false, err: '' });
    } catch (e) { setUp({ busy: false, err: (e as Error).message }); }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="label !mb-0">Ikon</span>
        <button type="button" className="btn-ghost !px-3 !py-2" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="flex items-center gap-2"><AppTileIcon icon={cur} iconUrl={iconUrl} size={22} /><span className="text-sm">{iconUrl ? 'Ikon sendiri' : APP_ICONS.find((i) => i.key === cur)?.label ?? 'Pilih ikon'}</span><Icon name="chevronDown" size={14} /></span>
        </button>
        <label className="btn-ghost cursor-pointer !px-3 !py-2 text-sm">{up.busy ? 'Mengunggah…' : '⬆ Unggah ikon sendiri'}<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={up.busy} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} /></label>
        {iconUrl && <button type="button" className="text-sm text-red-600 underline" onClick={() => onChange({ iconUrl: null })}>Hapus ikon sendiri</button>}
        {/* pratinjau ubin seperti di beranda */}
        <div className="card flex w-56 flex-col items-start p-3">
          <span className="mb-2 grid h-11 w-11 place-items-center rounded-xl bg-accent-500/15 text-accent-600"><AppTileIcon icon={cur} iconUrl={iconUrl} size={24} /></span>
          <span className="text-sm font-semibold text-slate-800">{name || 'Nama aplikasi'}</span>
          {description && <span className="mt-0.5 text-xs text-slate-500">{description}</span>}
        </div>
      </div>
      {up.err && <p className="text-sm text-red-600" role="alert">{up.err}</p>}
      <p className="text-[11px] text-slate-400">Ikon sendiri: PNG/JPEG/WebP maks. 2 MB, disarankan persegi dengan latar transparan (otomatis dijadikan 192×192 px). SVG tidak diterima demi keamanan.</p>
      {open && (
        <div className="space-y-3 rounded-lg border p-3">
          {groups.map((g) => (
            <div key={g}>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{g}</div>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
                {APP_ICONS.filter((i) => i.group === g).map((i) => (
                  <button type="button" key={i.key} title={i.label} aria-label={i.label} aria-pressed={!iconUrl && cur === i.key} onClick={() => { onChange({ icon: i.key, iconUrl: null }); setOpen(false); }}
                    className={`flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[11px] leading-tight transition hover:bg-slate-50 dark:hover:bg-slate-800 ${!iconUrl && cur === i.key ? 'border-accent-500 bg-accent-500/10 text-accent-600' : 'border-slate-200 text-slate-600'}`}>
                    <AppIcon name={i.key} size={24} /><span className="line-clamp-2 text-center">{i.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-slate-400">Ikon bawaan: Lucide (lisensi ISC, bebas dipakai komersial). Tambah ikon bawaan lain: scripts/gen-app-icons.py.</p>
        </div>
      )}
    </div>
  );
}

/** Aplikasi (beranda satu pintu): teks beranda, ubin WO, dan aplikasi lain di jalur domain yang sama. Siapa yang melihat ikonnya diatur di Hak Akses. */
function AppsCard() {
  const { data, reload } = useFetch<any>('/admin/launcher');
  const [apps, setApps] = useState<any[] | null>(null);
  const [home, setHome] = useState<any>(null);
  const [wo, setWo] = useState<any>(null);
  const [err, setErr] = useState('');
  const a = useAction();
  useEffect(() => { if (data) { setApps(data.apps); setHome(data.home); setWo(data.wo); } }, [data]);
  if (!data || !apps || !home || !wo) return <p className="text-slate-500">Memuat…</p>;
  const upd = (i: number, patch: Record<string, unknown>) => setApps((p) => p!.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const dirty = JSON.stringify({ apps, home, wo }) !== JSON.stringify({ apps: data.apps, home: data.home, wo: data.wo });
  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h2 className="font-semibold">Beranda (menu utama)</h2>
        <p className="text-sm text-slate-500">Setelah login, pengguna melihat beranda berisi ikon aplikasi. Dari dalam aplikasi, pengguna kembali lewat tombol <b>{home.backLabel || 'Menu Utama'}</b> (header dan menu samping). Pada teks, <code>{'{nama}'}</code> = nama lengkap dan <code>{'{nama_depan}'}</code> = kata pertama.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2"><span className="label">Judul beranda</span><input className="input" value={home.title} maxLength={80} onChange={(e) => setHome({ ...home, title: e.target.value })} /></label>
          <label className="text-sm sm:col-span-2"><span className="label">Kalimat di bawah judul</span><input className="input" value={home.subtitle} maxLength={200} onChange={(e) => setHome({ ...home, subtitle: e.target.value })} /></label>
          <label className="text-sm"><span className="label">Nama tombol kembali</span><input className="input" value={home.backLabel} maxLength={24} onChange={(e) => setHome({ ...home, backLabel: e.target.value })} /></label>
          <label className="flex items-start gap-2 text-sm sm:mt-6"><input type="checkbox" className="mt-1" checked={home.alwaysShow} onChange={(e) => setHome({ ...home, alwaysShow: e.target.checked })} /><span>Selalu tampilkan beranda &amp; tombol kembali walau baru ada satu aplikasi</span></label>
        </div>
        <div className="space-y-2 rounded-lg border p-3">
          <div className="text-sm font-semibold">Ubin "Work Order &amp; Inventori"</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-sm"><span className="label">Nama</span><input className="input" value={wo.name} maxLength={40} onChange={(e) => setWo({ ...wo, name: e.target.value })} /></label>
            <label className="text-sm"><span className="label">Keterangan singkat</span><input className="input" value={wo.description} maxLength={120} onChange={(e) => setWo({ ...wo, description: e.target.value })} /></label>
          </div>
          <IconPicker value={wo.icon} iconUrl={wo.iconUrl} onChange={(v) => setWo({ ...wo, ...v })} name={wo.name} description={wo.description} />
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold">Aplikasi lain di beranda</h2>
        <p className="text-sm text-slate-500">Aplikasi lain berjalan di jalur domain yang sama (mis. <code>/crm</code>) dan memakai login yang sama. Setelah menyimpan, atur siapa yang melihat ikonnya di <b>Hak Akses</b> (kelompok "Aplikasi"). Aplikasi itu tetap wajib memeriksa token dan perannya sendiri.</p>
        {apps.length === 0 && <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">Belum ada aplikasi lain.</p>}
        {apps.map((x, i) => (
          <div key={i} className="space-y-2 rounded-lg border p-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="text-sm"><span className="label">ID</span><input className="input font-mono" value={x.id} onChange={(e) => upd(i, { id: e.target.value.toLowerCase() })} placeholder="crm" /></label>
              <label className="text-sm"><span className="label">Nama</span><input className="input" value={x.name} onChange={(e) => upd(i, { name: e.target.value })} placeholder="CRM Sales & Marketing" /></label>
              <label className="text-sm"><span className="label">Jalur</span><input className="input font-mono" value={x.path} onChange={(e) => upd(i, { path: e.target.value.toLowerCase() })} placeholder="/crm" /></label>
            </div>
            <label className="block text-sm"><span className="label">Keterangan singkat</span><input className="input" value={x.description} onChange={(e) => upd(i, { description: e.target.value })} placeholder="Aktivitas lapangan sales & marketing" /></label>
            <IconPicker value={x.icon} iconUrl={x.iconUrl} onChange={(v) => upd(i, v)} name={x.name} description={x.description} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={x.enabled} onChange={(e) => upd(i, { enabled: e.target.checked })} /> Tampil di beranda</label>
              <button className="btn-ghost !border-red-300 !text-red-600" onClick={() => setApps((p) => p!.filter((_, j) => j !== i))}>Hapus</button>
            </div>
            <p className="text-xs text-slate-500">Di server: berkas <code>proxy/apps/{x.id || 'nama'}.caddy</code> berisi <code>handle {x.path || '/jalur'}/* {'{'} reverse_proxy {x.id || 'nama'}-web:3000 {'}'}</code> (lihat docs/SUPER-APPS.md).</p>
          </div>
        ))}
        <button className="btn-ghost" onClick={() => setApps((p) => [...p!, { id: '', name: '', description: '', icon: 'users', iconUrl: null, path: '/', enabled: false }])}>+ Tambah aplikasi</button>
      </div>

      <ErrorMsg>{err}</ErrorMsg>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={a.busy || !dirty} onClick={() => { setErr(''); a.run(async () => { try { await api('/admin/launcher', { method: 'PUT', body: { apps, home, wo } }); reload(); } catch (e) { setErr((e as any).fields ? Object.values((e as any).fields).join(' · ') : (e as Error).message); throw e; } }, 'Beranda disimpan.'); }}>Simpan</button>
        <button className="btn-ghost" disabled={a.busy} onClick={() => { setHome(data.defaults.home); setWo({ ...data.defaults.wo }); }}>Kembalikan teks & ubin WO ke bawaan</button>
        {dirty && <span className="text-xs text-amber-600">Ada perubahan belum disimpan</span>}
      </div>
      <Msg m={a.msg} />
    </div>
  );
}

/** Hak Akses: matriks fitur × sub-role per divisi. Admin selalu punya semua akses. */
function AccessCard() {
  const { data, reload } = useFetch<any>('/admin/access');
  const [m, setM] = useState<Record<string, string[]> | null>(null);
  const [div, setDiv] = useState('MKT');
  const a = useAction();
  useEffect(() => { if (data) setM(data.matrix); }, [data]);
  if (!data || !m) return <p className="text-slate-500">Memuat…</p>;
  const has = (k: string, t: string) => m[k]?.includes(t);
  const toggle = (k: string, t: string) => setM((p) => { const cur = new Set(p![k]); if (cur.has(t)) cur.delete(t); else cur.add(t); return { ...p!, [k]: [...cur] }; });
  const groups = [...new Set<string>(data.features.map((f: any) => f.group))];
  const dirty = JSON.stringify(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v].sort()]))) !== JSON.stringify(Object.fromEntries(Object.entries(data.matrix as Record<string, string[]>).map(([k, v]) => [k, [...v].sort()])));
  return (
    <div className="card space-y-3">
      <h2 className="font-semibold">Hak akses divisi & sub-role</h2>
      <p className="text-sm text-slate-500">Atur menu & fitur yang dapat dipakai tiap divisi dan sub-role (Manager / Supervisor / Staff). Admin selalu memiliki semua akses. Perubahan berlaku paling lambat 10 detik; pengguna yang sedang login cukup memuat ulang halaman. Alur Work Order (siapa boleh membuat/menyetujui tiap tahap) tidak diubah di sini.</p>
      <div className="flex flex-wrap gap-1">{data.divisions.map((d: string) => <button key={d} className={div === d ? 'btn' : 'btn-ghost'} onClick={() => setDiv(d)}>{ROLE_LABEL[d] ?? d}</button>)}</div>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr><th className="th text-left">Fitur</th>{data.subRoles.map((s: string) => <th key={s} className="th w-24 text-center">{SUBROLE_LABEL[s] ?? s}</th>)}</tr></thead>
        <tbody>{groups.map((g) => (
          <Fragment key={g}>
            <tr><td colSpan={4} className="bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800">{g}</td></tr>
            {data.features.filter((f: any) => f.group === g).map((f: any) => (
              <tr key={f.key} className="border-t"><td className="td"><div className="font-medium">{f.label}{f.custom && <span className="ml-2 text-xs font-normal text-amber-600">diubah</span>}</div><div className="text-xs text-slate-500">{f.desc}</div></td>
                {data.subRoles.map((s: string) => <td key={s} className="td text-center"><input type="checkbox" className="h-4 w-4" checked={!!has(f.key, `${div}:${s}`)} onChange={() => toggle(f.key, `${div}:${s}`)} aria-label={`${f.label} — ${ROLE_LABEL[div]} ${SUBROLE_LABEL[s]}`} /></td>)}</tr>
            ))}
          </Fragment>
        ))}</tbody>
      </table></div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={a.busy || !dirty} onClick={() => a.run(async () => { await api('/admin/access', { method: 'PUT', body: { matrix: m } }); reload(); }, 'Hak akses disimpan.')}>Simpan</button>
        <button className="btn-ghost" disabled={a.busy} onClick={() => { if (confirm('Kembalikan semua hak akses ke bawaan?')) a.run(async () => { await api('/admin/access/reset', { method: 'POST', body: {} }); reload(); }, 'Dikembalikan ke bawaan.'); }}>Kembalikan ke bawaan</button>
        {dirty && <span className="text-xs text-amber-600">Ada perubahan belum disimpan</span>}
      </div>
      <Msg m={a.msg} />
    </div>
  );
}

/** Keamanan: batas sesi diam. */
function SecurityCard({ d, reload }: { d: any; reload: () => void }) {
  const [m, setM] = useState<string>(String(d.security?.sessionMinutes ?? 30));
  const a = useAction();
  return (
    <div className="card space-y-3">
      <h2 className="font-semibold">Keamanan sesi</h2>
      <p className="text-sm text-slate-500">Pengguna otomatis keluar bila tidak ada aktivitas (klik, ketik, sentuh, scroll) selama batas ini. Dua menit sebelumnya muncul peringatan dengan tombol <b>Tetap masuk</b>. Sesi aktif diperpanjang otomatis. Perubahan berlaku untuk login berikutnya.</p>
      <label className="block max-w-xs text-sm"><span className="label">Batas diam (menit)</span><input className="input" type="number" min={5} max={720} value={m} onChange={(e) => setM(e.target.value)} /><span className="mt-0.5 block text-xs text-slate-500">5–720 menit. Bawaan 30.</span></label>
      <div className="flex items-center gap-3"><button className="btn" disabled={a.busy} onClick={() => a.run(async () => { await api('/admin/settings/security', { method: 'PUT', body: { sessionMinutes: Number(m) } }); reload(); }, 'Disimpan — berlaku untuk login berikutnya')}>Simpan</button></div>
      <Msg m={a.msg} />
    </div>
  );
}

function AssetInfoCard({ d, reload }: { d: any; reload: () => void }) {
  const ai = d.assetInfo;
  const [f, setF] = useState({ intro: ai.intro as string, footer: ai.footer as string, contacts: { ...ai.contacts } as Record<string, string> });
  const a = useAction();
  const setC = (k: string, v: string) => setF((p) => ({ ...p, contacts: { ...p.contacts, [k]: v } }));
  const preview = f.intro.replace('{KODE}', 'GA-002').replace('{BARANG}', 'Laptop Kantor').replace('{MERK}', ' (Lenovo ThinkPad)').replace('{PERUSAHAAN}', d.branding.companyName).replace('{LOKASI}', ', berada di Kantor Bandung');
  return (
    <div className="card space-y-3">
      <h2 className="font-semibold">Informasi aset (halaman label QR)</h2>
      <p className="text-sm text-slate-500">Halaman ini terbuka untuk siapa saja yang memindai label QR aset (tanpa login). Atur kalimat info dan tombol kontak agar penemu aset bisa menghubungi perusahaan.</p>
      <Field label="Kalimat info" help="Penanda: {KODE} {BARANG} {MERK} {PERUSAHAAN} {LOKASI}"><textarea className="input" rows={2} value={f.intro} onChange={(e) => setF({ ...f, intro: e.target.value })} /></Field>
      <p className="rounded-lg bg-slate-50 p-2 text-sm dark:bg-slate-800"><span className="text-xs text-slate-500">Contoh tampilan: </span>{preview}</p>
      <Field label="Teks kaki halaman" help="Boleh memakai {PERUSAHAAN}"><input className="input" value={f.footer} onChange={(e) => setF({ ...f, footer: e.target.value })} /></Field>
      <h3 className="pt-1 text-sm font-semibold">Tombol kontak (kosongkan yang tidak dipakai)</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email"><input className="input" placeholder="info@perusahaan.co.id" value={f.contacts.email} onChange={(e) => setC('email', e.target.value)} /></Field>
        <Field label="WhatsApp" help="Nomor, mis. 0812xxxxxxx"><input className="input" value={f.contacts.whatsapp} onChange={(e) => setC('whatsapp', e.target.value)} /></Field>
        <Field label="Telegram" help="Username (tanpa @) atau tautan t.me"><input className="input" value={f.contacts.telegram} onChange={(e) => setC('telegram', e.target.value)} /></Field>
        <Field label="Facebook" help="Tautan halaman"><input className="input" placeholder="https://facebook.com/…" value={f.contacts.facebook} onChange={(e) => setC('facebook', e.target.value)} /></Field>
        <Field label="Instagram" help="Username (tanpa @) atau tautan"><input className="input" value={f.contacts.instagram} onChange={(e) => setC('instagram', e.target.value)} /></Field>
      </div>
      <button className="btn" disabled={a.busy} onClick={() => a.run(async () => { await api('/admin/settings/asset-info', { method: 'PUT', body: f }); reload(); }, 'Informasi aset disimpan')}>Simpan informasi aset</button>
      <Msg m={a.msg} />
    </div>
  );
}

/* ───────── Pusat Admin: navigasi bertingkat (Platform / Work Order / aplikasi lain / Data) ───────── */
const NAV: { group: string; items: { key: string; label: string }[] }[] = [
  { group: 'Platform', items: [
    { key: 'users', label: 'Pengguna' }, { key: 'access', label: 'Hak Akses' }, { key: 'apps', label: 'Aplikasi (Beranda)' }, { key: 'brand', label: 'Tampilan & brand' },
    { key: 'email', label: 'Email (SMTP)' }, { key: 'telegram', label: 'Telegram' }, { key: 'whatsapp', label: 'WhatsApp' }, { key: 'notif', label: 'Log notifikasi' },
    { key: 'ssl', label: 'SSL & Domain' }, { key: 'security', label: 'Keamanan' }, { key: 'audit', label: 'Log audit' },
    { key: 'apisistem', label: 'API Sistem' }, { key: 'apikanca', label: 'API Kanca (WhatsApp)' },
  ] },
  { group: 'Work Order', items: [
    { key: 'radius', label: 'MSRadius' }, { key: 'apimsradius', label: 'API MSRadius' }, { key: 'subform', label: 'Formulir Berlangganan' }, { key: 'docs', label: 'Dokumen PR' },
    { key: 'serviceorder', label: 'BA & Garansi Order Jasa' }, { key: 'assetinfo', label: 'Info aset (QR)' }, { key: 'out', label: 'Event ke Billing' },
  ] },
  { group: 'Data', items: [{ key: 'data', label: 'Data & Backup' }] },
];
/** Halaman admin milik aplikasi lain (dibuat & dipelihara aplikasi itu sendiri; WO hanya MENANAM-nya lewat iframe se-origin, ?embed=1). Data & Backup-nya muncul sebagai tab di bagian Data. */
const APP_ADMIN_LINKS: Record<string, { label: string; sub: string }[]> = {
  crm: [{ label: 'Pengaturan', sub: '/admin/settings' }],
};

function DataSection({ crm }: { crm?: { name: string; path: string } }) {
  const [app, setApp] = useState('wo');
  return (
    <>
      <Tabs value={app} onChange={setApp} tabs={[{ key: 'wo', label: 'Work Order' }, ...(crm ? [{ key: 'crm', label: crm.name }] : [])]} />
      {app === 'wo' && <DataCard />}
      {app === 'crm' && crm && <EmbedFrame src={`${crm.path}/admin/data`} title={`Data & Backup ${crm.name}`} />}
    </>
  );
}

export default function Admin() {
  const { user } = useAuth();
  const [sec, setSecRaw] = useState('users');
  useEffect(() => { try { const x = localStorage.getItem('maung_admin_sec2'); if (x) setSecRaw(x); } catch { /* abaikan */ } }, []);
  const setSec = (k: string) => { setSecRaw(k); try { localStorage.setItem('maung_admin_sec2', k); } catch { /* abaikan */ } };
  const isAdmin = user?.role === 'ADMIN';
  const { data: settings, error, reload } = useFetch<any>(isAdmin ? '/admin/settings' : null);
  const { data: launcher } = useFetch<{ apps: { id: string; name: string; path: string }[] }>(isAdmin ? '/launcher' : null);
  if (user && !isAdmin) return <ErrorMsg>Khusus Admin</ErrorMsg>;
  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  if (!settings) return <p className="text-slate-500">Memuat…</p>;
  const others = (launcher?.apps ?? []).filter((a) => a.id !== 'wo' && a.id !== 'admin' && APP_ADMIN_LINKS[a.id]);
  const crm = (launcher?.apps ?? []).find((a) => a.id === 'crm');
  const known = [...NAV, ...others.map((a) => ({ group: a.name, items: APP_ADMIN_LINKS[a.id].map((l) => ({ key: `app:${a.id}:${l.sub}`, label: l.label })) }))].flatMap((g) => g.items.map((i) => ({ ...i, group: g.group })));
  const cur = known.find((i) => i.key === sec) ?? known[0];
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <nav className="flex gap-1 overflow-x-auto pb-1 lg:sticky lg:top-20 lg:flex-col lg:gap-0.5 lg:overflow-visible" aria-label="Pusat Admin">
        {[...NAV, ...others.map((a) => ({ group: a.name, items: APP_ADMIN_LINKS[a.id].map((l) => ({ key: `app:${a.id}:${l.sub}`, label: l.label })) }))].map((g: any) => (
          <Fragment key={g.group}>
            <div className="hidden px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 first:pt-0 lg:block">{g.group}</div>
            {g.items.map((s: { key: string; label: string }) => (
              <button key={s.key} onClick={() => setSec(s.key)} className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition ${cur.key === s.key ? 'bg-accent-100 font-semibold text-brand-900' : 'text-slate-600 hover:bg-slate-100'}`}>{s.label}</button>
            ))}
          </Fragment>
        ))}
      </nav>
      <div className="min-w-0 max-w-5xl space-y-4">
        <div><div className="subheader text-accent-600">{cur.group}</div><h1 className="font-display text-xl font-bold text-brand-900">{cur.label}</h1></div>
        {cur.key === 'users' && <Users />}
        {cur.key === 'access' && <AccessCard />}
        {cur.key === 'apps' && <AppsCard />}
        {cur.key === 'brand' && <BrandingCard d={settings} reload={reload} />}
        {cur.key === 'email' && <SmtpCard d={settings} reload={reload} />}
        {cur.key === 'telegram' && <TelegramCard d={settings} reload={reload} />}
        {cur.key === 'whatsapp' && <WhatsappCard d={settings} reload={reload} />}
        {cur.key === 'notif' && <Notifs />}
        {cur.key === 'ssl' && <SslCard />}
        {cur.key === 'security' && <SecurityCard d={settings} reload={reload} />}
        {cur.key === 'audit' && <AuditLog />}
        {cur.key === 'radius' && <RadiusCard />}
        {cur.key === 'apimsradius' && <ApiMsradius />}
        {cur.key === 'apisistem' && <ApiSistem />}
        {cur.key === 'apikanca' && <ApiKanca />}
        {cur.key === 'subform' && <SubFormCard />}
        {cur.key === 'docs' && <DocsCard />}
        {cur.key === 'serviceorder' && <ServiceOrderCard />}
        {cur.key === 'assetinfo' && <AssetInfoCard d={settings} reload={reload} />}
        {cur.key === 'out' && <Outbound />}
        {others.map((a) => APP_ADMIN_LINKS[a.id].map((l) => cur.key === `app:${a.id}:${l.sub}` && <EmbedFrame key={cur.key} src={`${a.path}${l.sub}`} title={`${l.label} ${a.name}`} />))}
        {cur.key === 'data' && <DataSection crm={crm && APP_ADMIN_LINKS.crm ? { name: crm.name, path: crm.path } : undefined} />}
      </div>
    </div>
  );
}
