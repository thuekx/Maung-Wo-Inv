'use client';
import { useState } from 'react';
import { API, api, doDelete, fileUrl, fmtDate, getToken, ROLE_LABEL, useFetch } from '@/lib/api';
import { confirmDialog, toast } from '@/lib/dialog';
import { loadBranding } from '@/lib/brand';
import { useAuth } from '@/lib/auth';
import { DynamicForm, Field as FormField } from '@/components/DynamicForm';
import { Column, DataTable } from '@/components/DataTable';
import { Badge, ErrorMsg, LinkBtn, Modal, PageHeader, Table, Tabs } from '@/components/ui';

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
      <Table head={['', 'Nama', 'Email', 'Divisi', 'Telegram', 'Status', '']}>
        {users.map((u) => (
          <tr key={u.id}>
            <td className="td"><input type="checkbox" checked={sel.includes(u.id)} onChange={() => toggle(u.id)} aria-label={`pilih ${u.name}`} /></td>
            <td className="td">{u.name}</td><td className="td">{u.email}</td><td className="td"><Badge>{ROLE_LABEL[u.role] ?? u.role}</Badge></td>
            <td className="td">{u.telegramChatId ? '✓ terhubung' : '-'}</td>
            <td className="td"><button className="text-brand-700 hover:underline" onClick={async () => { await api(`/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }).catch((e) => toast.error(e.message)); reload(); }}>{u.active ? 'Aktif' : 'Nonaktif'}</button>{u.mustChangePassword && <div><Badge tone="amber">wajib ganti password</Badge></div>}</td>
            <td className="td whitespace-nowrap"><LinkBtn onClick={() => setEdit(u)}>Edit</LinkBtn> · <LinkBtn onClick={() => { setErr(''); setPw({ ids: [u.id] }); }}>Reset PW</LinkBtn> · <LinkBtn danger onClick={async () => { if (await doDelete(`/users/${u.id}`, `user ${u.email}`)) reload(); }}>Hapus</LinkBtn></td>
          </tr>
        ))}
      </Table>
      {show && (
        <Modal title="Tambah user" onClose={() => setShow(false)}>
          <DynamicForm submitLabel="Buat user" onSubmit={async (v) => { await api('/users', { body: v }); setShow(false); await reload(); }} fields={[...userFields.slice(0, 3), { name: 'password', label: 'Password awal (min 8)', type: 'password', required: true }, userFields[3]]} />
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
    filters={<select className="input w-52" value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Jenis data"><option value="">Semua data</option>{['pelanggan', 'user', 'item', 'gudang', 'aset', 'paket', 'merk', 'tipe', 'PO', 'WO'].map((x) => <option key={x}>{x}</option>)}</select>} />;
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
    { key: 'status', header: 'Status', sort: 'status', render: (n) => <><Badge tone={sTone(n.status)}>{sLabel[n.status] ?? n.status}</Badge>{n.error && <div className="text-xs text-red-600">{n.error}</div>}</> },
    { key: 'act', header: '', render: (n) => (n.status === 'SENT' || n.status === 'PENDING' ? null : <button className="text-xs text-brand-700 hover:underline" onClick={() => resend(n.id)}>Kirim ulang</button>) },
  ];
  return <DataTable<any> path="/admin/notifications" columns={cols} params={{ status, r: String(n) }} defaultSort="createdAt" searchPlaceholder="Cari subjek / tujuan…"
    filters={<><button className="btn-ghost" onClick={resendAll}>Kirim ulang semua yang belum terkirim</button><select className="input w-40" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Semua status</option>{['PENDING', 'SENT', 'NOT_SENT', 'FAILED', 'SKIPPED'].map((x) => <option key={x} value={x}>{sLabel[x]}</option>)}</select></>} />;
}

function Outbound() {
  const { data, error } = useFetch<any[]>('/admin/outbound');
  return (
    <>
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

function UploadBox({ title, hint, url, dark, variant, onDone }: { title: string; hint: string; url: string | null; dark?: boolean; variant: string; onDone: () => void }) {
  const a = useAction();
  const upload = (f: File | undefined) => {
    if (!f) return;
    a.run(async () => {
      const fd = new FormData(); fd.append('file', f);
      const res = await fetch(`${API}/api/admin/settings/branding/logo?variant=${variant}`, { method: 'POST', headers: { authorization: `Bearer ${getToken()}` }, body: fd });
      const j = await res.json().catch(() => ({})); if (!res.ok) throw new Error(j.error ?? 'Upload gagal');
      await loadBranding(true); onDone();
    }, 'Tersimpan');
  };
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{title}</div>
      <div className={`flex h-24 items-center justify-center rounded-lg border ${dark ? 'bg-brand-900' : 'bg-white'}`}>{url ? <img src={fileUrl(url)} alt={title} className="max-h-20 max-w-[85%] object-contain" /> : <span className="text-xs text-slate-400">Belum ada</span>}</div>
      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => upload(e.target.files?.[0])} className="w-full text-xs" />
      <p className="text-xs text-slate-500">{hint}</p>
      {url && <button className="text-xs text-red-600 hover:underline" onClick={() => a.run(async () => { await api(`/admin/settings/branding/logo?variant=${variant}`, { method: 'DELETE' }); await loadBranding(true); onDone(); }, 'Dihapus')}>Hapus</button>}
      <Msg m={a.msg} />
    </div>
  );
}

function BrandingCard({ d, reload }: { d: any; reload: () => void }) {
  const b = d.branding;
  const [f, setF] = useState({ companyName: b.companyName, tagline: b.tagline, subtitle: b.subtitle, loginText: b.loginText, primary: b.colors.primary, accent: b.colors.accent, charts: [...b.colors.charts] as string[] });
  const a = useAction();
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));
  const valid = HEXRE.test(f.primary) && HEXRE.test(f.accent) && f.charts.every((c) => HEXRE.test(c));
  const lines: string[] = String(f.loginText).split('\n').filter(Boolean);
  const save = () => a.run(async () => {
    await api('/admin/settings/branding', { method: 'PUT', body: { companyName: f.companyName, tagline: f.tagline, subtitle: f.subtitle, loginText: f.loginText, colors: { primary: f.primary, accent: f.accent, charts: f.charts } } });
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
        <UploadBox title="Gambar latar login (opsional)" hint="Foto lanskap/pegunungan. Diberi lapisan navy otomatis. JPG/WEBP ≤ 6 MB." url={b.loginBgUrl} dark variant="loginbg" onDone={reload} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Nama brand / perusahaan (juga tertulis di foto)"><input className="input" value={f.companyName} onChange={(e) => set('companyName', e.target.value)} /></Field>
        <Field label="Tagline" help="Tampil di halaman login, dashboard, dan sidebar. Kosongkan untuk menyembunyikan."><input className="input" value={f.tagline} onChange={(e) => set('tagline', e.target.value)} /></Field>
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
          {b.logoUrl ? <img src={fileUrl(b.logoUrl)} alt="" className="mb-2 h-12 w-auto object-contain" /> : <div className="mb-2 font-display text-2xl font-extrabold">{f.companyName}</div>}
          <div className="text-[11px] tracking-[0.16em] text-slate-300">{f.subtitle}</div>
          <div className="mt-3 font-display text-xl font-semibold" style={{ color: f.accent }}>{f.tagline}</div>
          <div className="my-2 h-0.5 w-10" style={{ background: f.accent }} />
          <div className="font-display text-sm text-slate-100">{lines.map((l, i) => <p key={i}>{l}</p>)}</div>
          <div className="mt-3 flex gap-2"><span className="rounded-md px-3 py-1 text-xs font-semibold" style={{ background: f.accent, color: f.primary }}>Tombol utama</span>{f.charts.map((c, i) => <i key={i} className="h-6 w-6 rounded" style={{ background: c }} />)}</div>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={b.requireGps} onChange={(e) => a.run(async () => { await api('/admin/settings/app', { method: 'PUT', body: { requireGps: e.target.checked } }); await loadBranding(true); reload(); }, 'Kebijakan GPS disimpan')} /> Wajibkan GPS pada foto teknisi (FOC) <span className="text-xs text-slate-500">— matikan hanya untuk uji coba tanpa HTTPS</span></label>
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
      <div className="flex items-center justify-between"><h2 className="font-semibold">Email (SMTP pengirim)</h2><Badge tone={s.source === 'db' ? 'green' : s.source === 'env' ? 'blue' : 'amber'}>{s.source === 'db' ? 'Diatur di sini' : s.source === 'env' ? 'Dari .env' : 'Belum diatur (dry-run)'}</Badge></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Server SMTP" help="mis. smtp.gmail.com / smtp.office365.com / mail.perusahaan.co.id"><input className="input" value={f.host} onChange={(e) => set('host', e.target.value)} placeholder="smtp.contoh.com" /></Field>
        <Field label="Port" help="587 (STARTTLS) atau 465 (SSL)"><input className="input" type="number" value={f.port} onChange={(e) => set('port', e.target.value)} /></Field>
        <Field label="Username"><input className="input" value={f.user} onChange={(e) => set('user', e.target.value)} autoComplete="off" /></Field>
        <Field label="Password / App Password" help={s.hasPass ? 'Tersimpan (terenkripsi). Kosongkan untuk tetap memakai yang lama.' : 'Disimpan terenkripsi di database.'}><input className="input" type="password" value={f.pass} onChange={(e) => set('pass', e.target.value)} placeholder={s.hasPass ? '••••••••' : ''} autoComplete="new-password" /></Field>
        <Field label="Alamat pengirim (From)" help='contoh: L1V WO <noreply@perusahaan.co.id> — harus alamat yang diizinkan SMTP Anda'><input className="input" value={f.from} onChange={(e) => set('from', e.target.value)} /></Field>
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

function Settings() {
  const { data, error, reload } = useFetch<any>('/admin/settings');
  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  if (!data) return <p className="text-slate-500">Memuat…</p>;
  return (
    <div className="max-w-4xl space-y-4">
      <BrandingCard d={data} reload={reload} />
      <SmtpCard d={data} reload={reload} />
      <TelegramCard d={data} reload={reload} />
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
