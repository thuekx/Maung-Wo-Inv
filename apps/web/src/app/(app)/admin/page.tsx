'use client';
import { useState } from 'react';
import { API, api, fileUrl, fmtDate, getToken, ROLE_LABEL, useFetch } from '@/lib/api';
import { loadBranding } from '@/lib/photo';
import { useAuth } from '@/lib/auth';
import { DynamicForm } from '@/components/DynamicForm';
import { Badge, ErrorMsg, PageHeader, Table, Tabs } from '@/components/ui';

function Users() {
  const { data, reload } = useFetch<any[]>('/users');
  const [show, setShow] = useState(false);
  return (
    <>
      <button className="btn mb-3" onClick={() => setShow(!show)}>+ Tambah user</button>
      {show && (
        <div className="card mb-4 max-w-lg">
          <DynamicForm submitLabel="Buat user" onSubmit={async (v) => { await api('/users', { body: v }); setShow(false); await reload(); }}
            fields={[
              { name: 'name', label: 'Nama', type: 'text', required: true },
              { name: 'email', label: 'Email', type: 'text', required: true },
              { name: 'role', label: 'Divisi', type: 'select', required: true, options: Object.keys(ROLE_LABEL) },
              { name: 'password', label: 'Password awal (min 8)', type: 'password', required: true },
              { name: 'telegramChatId', label: 'Telegram chat ID (opsional — atau user menautkan sendiri via /link)', type: 'text' },
            ]} />
        </div>
      )}
      <Table head={['Nama', 'Email', 'Divisi', 'Telegram', 'Aktif']}>
        {data?.filter((u) => u.email !== 'system@l1v.local').map((u) => (
          <tr key={u.id}>
            <td className="td">{u.name}</td><td className="td">{u.email}</td><td className="td"><Badge>{ROLE_LABEL[u.role]}</Badge></td>
            <td className="td">{u.telegramChatId ? '✓ terhubung' : '-'}</td>
            <td className="td"><button className="text-brand-700 hover:underline" onClick={async () => { await api(`/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }); reload(); }}>{u.active ? 'Aktif' : 'Nonaktif'}</button></td>
          </tr>
        ))}
      </Table>
    </>
  );
}

const sTone = (s: string): any => (s === 'SENT' ? 'green' : s === 'FAILED' ? 'red' : s === 'SKIPPED' ? 'slate' : 'amber');

function Notifs() {
  const { data, error } = useFetch<any[]>('/admin/notifications');
  return (
    <>
      <ErrorMsg>{error}</ErrorMsg>
      <Table head={['Waktu', 'Kanal', 'Tujuan', 'Subjek', 'Status']}>
        {data?.map((n) => (
          <tr key={n.id}><td className="td">{fmtDate(n.createdAt)}</td><td className="td">{n.channel}</td><td className="td text-xs">{n.target}</td><td className="td">{n.subject}</td>
            <td className="td"><Badge tone={sTone(n.status)}>{n.status}</Badge>{n.error && <div className="text-xs text-red-600">{n.error}</div>}</td></tr>
        ))}
      </Table>
    </>
  );
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

function BrandingCard({ d, reload }: { d: any; reload: () => void }) {
  const [name, setName] = useState(d.branding.companyName);
  const a = useAction();
  const upload = async (f: File | undefined) => {
    if (!f) return;
    await a.run(async () => {
      const fd = new FormData(); fd.append('file', f);
      const res = await fetch(`${API}/api/admin/settings/branding/logo`, { method: 'POST', headers: { authorization: `Bearer ${getToken()}` }, body: fd });
      const j = await res.json().catch(() => ({})); if (!res.ok) throw new Error(j.error ?? 'Upload gagal');
      await loadBranding(true); reload();
    }, 'Logo disimpan');
  };
  return (
    <div className="card space-y-3">
      <h2 className="font-semibold">Logo & identitas PT</h2>
      <p className="text-sm text-slate-500">Dipakai pada halaman login, menu samping, dan ditempel di setiap foto lapangan teknisi bersama koordinat GPS.</p>
      <div className="flex items-center gap-4">
        <div className="flex h-20 w-32 items-center justify-center rounded-lg border bg-slate-50">{d.branding.logoUrl ? <img src={fileUrl(d.branding.logoUrl)} alt="logo" className="max-h-16 max-w-28 object-contain" /> : <span className="text-xs text-slate-400">Belum ada logo</span>}</div>
        <div className="space-y-2">
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => upload(e.target.files?.[0])} className="text-sm" />
          <p className="text-xs text-slate-500">PNG/JPG/WEBP ≤ 2 MB. Disarankan PNG latar transparan/putih, rasio mendatar.</p>
          {d.branding.logoUrl && <button className="text-xs text-red-600 hover:underline" onClick={() => a.run(async () => { await api('/admin/settings/branding/logo', { method: 'DELETE' }); await loadBranding(true); reload(); }, 'Logo dihapus')}>Hapus logo</button>}
        </div>
      </div>
      <Field label="Nama PT (tampil di foto & login)"><input className="input max-w-sm" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.branding.requireGps} onChange={(e) => a.run(async () => { await api('/admin/settings/app', { method: 'PUT', body: { requireGps: e.target.checked } }); await loadBranding(true); reload(); }, 'Kebijakan GPS disimpan')} /> Wajibkan GPS pada foto teknisi (FOC) <span className="text-xs text-slate-500">— matikan hanya untuk uji coba tanpa HTTPS</span></label>
      <div className="flex items-center gap-3"><button className="btn" disabled={a.busy} onClick={() => a.run(async () => { await api('/admin/settings/branding', { method: 'PUT', body: { companyName: name } }); await loadBranding(true); reload(); }, 'Identitas disimpan')}>Simpan nama</button></div>
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
      <PageHeader title="Admin" sub="User, pengaturan (logo PT, SMTP, Telegram), dan log notifikasi" />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'users', label: 'User' }, { key: 'settings', label: 'Pengaturan' }, { key: 'notif', label: 'Log notifikasi' }, { key: 'out', label: 'Event ke Billing' }]} />
      {tab === 'users' && <Users />}
      {tab === 'settings' && <Settings />}
      {tab === 'notif' && <Notifs />}
      {tab === 'out' && <Outbound />}
    </>
  );
}
