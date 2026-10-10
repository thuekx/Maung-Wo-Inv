'use client';
import { useEffect, useState } from 'react';
import { API, api, doDelete, fileUrl, imgUrl, fmtDate, getToken, ROLE_LABEL, SUBROLE_LABEL, useFetch } from '@/lib/api';
import { confirmDialog, toast } from '@/lib/dialog';
import { DEFAULT_LOGOS, loadBranding } from '@/lib/brand';
import { useAuth } from '@/lib/auth';
import { DynamicForm, Field as FormField } from '@/components/DynamicForm';
import { Column, DataTable } from '@/components/DataTable';
import { Badge, ErrorMsg, LinkBtn, Modal, PageHeader, Table, Tabs } from '@/components/ui';
import { Select } from '@/components/Select';

function PwResult({ list, onClose }: { list: { name: string; email: string; password?: string }[]; onClose: () => void }) {
  const csv = () => {
    const body = 'nama,email,password_sementara\n' + list.map((u) => `"${u.name}",${u.email},${u.password ?? ''}`).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' })); a.download = 'password-sementara.csv'; a.click();
  };
  const hasPw = list.some((u) => u.password);
  return (
    <Modal title="Password berhasil direset" onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        {hasPw ? <p className="rounded-lg bg-amber-100 px-3 py-2 text-amber-800">Catat/unduh sekarang — password acak <b>hanya ditampilkan sekali</b> dan tidak dapat dilihat lagi.</p> : <p>Password disetel sama untuk semua user yang dipilih.</p>}
        <Table head={['Nama', 'Email', 'Password sementara']}>
          {list.map((u) => <tr key={u.email}><td className="td">{u.name}</td><td className="td">{u.email}</td><td className="td font-mono">{u.password ?? '(sesuai yang Anda isi)'}</td></tr>)}
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
  const [opt, setOpt] = useState({ mode: 'random', password: '', mustChange: true, notify: true, sendPassword: false });
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
            {opt.mode === 'same' && <input className="input" type="text" placeholder="min 8 karakter" value={opt.password} onChange={(e) => setOpt({ ...opt, password: e.target.value })} />}
            <label className="flex items-center gap-2"><input type="checkbox" checked={opt.mustChange} onChange={(e) => setOpt({ ...opt, mustChange: e.target.checked })} /> Wajib ganti password saat login berikutnya</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={opt.notify} onChange={(e) => setOpt({ ...opt, notify: e.target.checked })} /> Kirim notifikasi ke user (email + Telegram)</label>
            {opt.notify && <label className="ml-6 flex items-center gap-2"><input type="checkbox" checked={opt.sendPassword} onChange={(e) => setOpt({ ...opt, sendPassword: e.target.checked })} /> Sertakan password sementara di pesan <span className="text-xs text-amber-700">(kurang aman — email/chat dapat tersimpan)</span></label>}
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
        <Field label="Password / App Password" help={s.hasPass ? 'Tersimpan (terenkripsi). Kosongkan untuk tetap memakai yang lama.' : 'Disimpan terenkripsi di database.'}><input className="input" type="password" value={f.pass} onChange={(e) => set('pass', e.target.value)} placeholder={s.hasPass ? '••••••••' : ''} autoComplete="new-password" /></Field>
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
      <Field label="Token bot" help={t.hasToken ? 'Tersimpan terenkripsi. Kosongkan untuk tetap memakai yang lama.' : 'Format: 123456789:AA…'}><input className="input max-w-xl" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={t.hasToken ? t.tokenHint : ''} autoComplete="new-password" /></Field>
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
        <Field label="URL API publik (https)" help="Alamat yang bisa dijangkau Telegram, mis. https://api-wo.perusahaan.co.id"><input className="input w-80" value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://api-wo.contoh.co.id" /></Field>
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
    try { await api('/admin/radius', { method: 'PUT', body: { baseUrl: cur.baseUrl, token: token || undefined, enabled: cur.enabled, intervalMin: Number(cur.intervalMin) } }); toast.success('Pengaturan MSRadius disimpan'); setToken(''); setV(null); await reload(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const test = async () => { setErr(''); setBusy(true); try { const r = await api<any>('/admin/radius/test', { body: {} }); toast.success(`Koneksi MSRadius OK (${r.users} user terdaftar di master).`); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  return (
    <div className="card space-y-3">
      <h2 className="font-semibold">Integrasi MSRadius (baca-saja)</h2>
      <p className="text-sm text-slate-500">Maung hanya <b>membaca</b> data pelanggan &amp; paket dari MSRadius — tidak pernah menulis/menghapus di sana. Token dibuat di MSRadius (Setting → User → Panel). Alamat API memakai HTTP polos; sebaiknya diakses lewat jaringan internal/VPN.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="mb-1 block text-sm font-medium">URL dasar API</label><input className="input" value={cur.baseUrl} onChange={(e) => upd('baseUrl', e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="mb-1 block text-sm font-medium">Token API {cur.tokenSet && <span className="text-xs font-normal text-slate-500">(tersimpan {cur.tokenHint} — kosongkan bila tidak diganti)</span>}</label><input className="input font-mono" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={cur.tokenSet ? '••••••••' : 'tempel token di sini'} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cur.enabled} onChange={(e) => upd('enabled', e.target.checked)} /> Sinkron otomatis</label>
        <div><label className="mb-1 block text-sm font-medium">Interval otomatis (menit)</label><input className="input" type="number" min={5} max={1440} value={cur.intervalMin} onChange={(e) => upd('intervalMin', e.target.value)} /></div>
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
          <Field label="Token / API key" help={w.hasToken ? 'Tersimpan terenkripsi. Kosongkan untuk tetap memakai yang lama.' : 'Dari dashboard penyedia; disimpan terenkripsi.'}><input className="input" type="password" value={f.token} onChange={(e) => set('token', e.target.value)} autoComplete="off" /></Field>
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

const SETTING_SECTIONS = [
  { key: 'brand', label: 'Tampilan & brand' },
  { key: 'email', label: 'Email (SMTP)' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'radius', label: 'MSRadius' },
  { key: 'subform', label: 'Formulir Berlangganan' },
  { key: 'docs', label: 'Dokumen PR' },
  { key: 'assetinfo', label: 'Info aset (QR)' },
] as const;

function Settings() {
  const { data, error, reload } = useFetch<any>('/admin/settings');
  const [sec, setSecRaw] = useState<string>('brand');
  useEffect(() => { try { const x = localStorage.getItem('maung_admin_sec'); if (x && SETTING_SECTIONS.some((s) => s.key === x)) setSecRaw(x); } catch { /* abaikan */ } }, []);
  const setSec = (k: string) => { setSecRaw(k); try { localStorage.setItem('maung_admin_sec', k); } catch { /* abaikan */ } };
  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  if (!data) return <p className="text-slate-500">Memuat…</p>;
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <nav className="flex gap-1 overflow-x-auto lg:sticky lg:top-20 lg:flex-col lg:overflow-visible" aria-label="Bagian pengaturan">
        {SETTING_SECTIONS.map((s) => (
          <button key={s.key} onClick={() => setSec(s.key)} className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition ${sec === s.key ? 'bg-accent-100 font-semibold text-brand-900 dark:bg-slate-700 dark:text-white' : 'text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{s.label}</button>
        ))}
      </nav>
      <div className="min-w-0 max-w-4xl space-y-4">
        {sec === 'brand' && <BrandingCard d={data} reload={reload} />}
        {sec === 'email' && <SmtpCard d={data} reload={reload} />}
        {sec === 'telegram' && <TelegramCard d={data} reload={reload} />}
        {sec === 'whatsapp' && <WhatsappCard d={data} reload={reload} />}
        {sec === 'radius' && <RadiusCard />}
        {sec === 'subform' && <SubFormCard />}
        {sec === 'docs' && <DocsCard />}
        {sec === 'assetinfo' && <AssetInfoCard d={data} reload={reload} />}
      </div>
    </div>
  );
}

export default function Admin() {
  const { user } = useAuth();
  const [tab, setTab] = useState('users');
  if (user?.role !== 'ADMIN') return <ErrorMsg>Khusus Admin</ErrorMsg>;
  return (
    <>
      <PageHeader pretitle="Sistem" title="Admin" sub="User, pengaturan (logo PT, SMTP, Telegram), dan log notifikasi" />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'users', label: 'User' }, { key: 'settings', label: 'Pengaturan' }, { key: 'notif', label: 'Log notifikasi' }, { key: 'audit', label: 'Log audit' }, { key: 'out', label: 'Event ke Billing' }]} />
      {tab === 'users' && <Users />}
      {tab === 'settings' && <Settings />}
      {tab === 'notif' && <Notifs />}
      {tab === 'audit' && <AuditLog />}
      {tab === 'out' && <Outbound />}
    </>
  );
}
