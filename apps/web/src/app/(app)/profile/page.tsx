'use client';
import { useState } from 'react';
import { API, api, getToken, ROLE_LABEL } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DynamicForm } from '@/components/DynamicForm';
import { Avatar, PageHeader } from '@/components/ui';
import { toast } from '@/lib/dialog';

export default function Profile() {
  const { user } = useAuth();
  const [code, setCode] = useState<{ command: string; expiresInSec: number; botUsername?: string } | null>(null);
  const [msg, setMsg] = useState('');
  if (!user) return null;
  return (
    <div className="max-w-xl space-y-4">
      {user.mustChangePassword && <p className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800">⚠ Password Anda diatur ulang oleh Admin. Ganti password di bawah sebelum melanjutkan.</p>}
      <PageHeader title="Profil" sub={`${user.email} · ${ROLE_LABEL[user.role]}`} />
      <div className="card space-y-4">
        <h2 className="font-semibold">Data profil</h2>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={user.name} size={72} url={user.avatarUrl} />
          <div className="space-y-1.5">
            <label className="btn-ghost cursor-pointer">Unggah foto
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return;
                const fd = new FormData(); fd.append('file', f);
                const res = await fetch(`${API}/api/auth/me/avatar`, { method: 'POST', headers: { authorization: `Bearer ${getToken()}` }, body: fd });
                if (!res.ok) return void toast.error((await res.json().catch(() => ({}))).error ?? 'Foto gagal diunggah');
                toast.success('Foto profil tersimpan'); window.location.reload();
              }} />
            </label>
            {user.avatarUrl && <button className="btn-ghost ml-2 !border-red-300 !text-red-600 hover:!bg-red-50" onClick={async () => { await api('/auth/me/avatar', { method: 'DELETE' }); window.location.reload(); }}>Hapus foto</button>}
            <p className="text-xs text-slate-500">JPG/PNG/WEBP, maks. 2 MB. Tampil di pojok kanan atas dan menu samping.</p>
          </div>
        </div>
        <DynamicForm submitLabel="Simpan profil" initial={{ name: user.name, email: user.email }}
          fields={[{ name: 'name', label: 'Nama', type: 'text', required: true }, { name: 'email', label: 'Email (juga dipakai untuk login & notifikasi)', type: 'text', required: true }]}
          onSubmit={async (v) => { await api('/auth/me', { method: 'PATCH', body: { name: v.name, email: v.email } }); toast.success('Profil tersimpan'); window.location.reload(); }} />
      </div>
      <div className="card space-y-2">
        <h2 className="font-semibold">Notifikasi Telegram {user.telegramLinked && <span className="text-sm font-normal text-green-700">✓ terhubung</span>}</h2>
        <p className="text-sm text-slate-500">Buat kode, lalu kirim perintah di bawah ke bot Telegram perusahaan. Email selalu aktif.</p>
        <button className="btn-ghost" onClick={async () => setCode(await api('/auth/telegram-code', { body: {} }))}>Buat kode tautan</button>
        {code && (
          <div className="space-y-1 rounded-lg bg-slate-100 p-3 text-sm">
            <p>1. Buka bot Telegram{code.botUsername ? <> <a className="font-medium text-brand-700 hover:underline" href={`https://t.me/${code.botUsername}`} target="_blank" rel="noreferrer">@{code.botUsername}</a></> : ' perusahaan (tanyakan Admin)'} lalu tekan <b>Start</b>.</p>
            <p>2. Kirim pesan ini ke bot: <span className="font-mono">{code.command}</span> <span className="text-xs text-slate-500">(berlaku {code.expiresInSec / 60} menit)</span></p>
          </div>
        )}
      </div>
      <div className="card">
        <h2 className="mb-2 font-semibold">Ganti password</h2>
        <DynamicForm submitLabel="Ganti password" onSubmit={async (v) => { await api('/auth/change-password', { body: { current: v.current, next: v.next } }); setMsg('Password diganti.'); if (user.mustChangePassword) window.location.href = '/'; }}
          fields={[{ name: 'current', label: 'Password lama', type: 'password', required: true }, { name: 'next', label: 'Password baru (min 8)', type: 'password', required: true }]} />
        {msg && <p className="mt-2 text-sm text-green-700">{msg}</p>}
      </div>
    </div>
  );
}
