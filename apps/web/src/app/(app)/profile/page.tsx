'use client';
import { useState } from 'react';
import { api, ROLE_LABEL } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DynamicForm } from '@/components/DynamicForm';
import { PageHeader } from '@/components/ui';

export default function Profile() {
  const { user } = useAuth();
  const [code, setCode] = useState<{ command: string; expiresInSec: number } | null>(null);
  const [msg, setMsg] = useState('');
  if (!user) return null;
  return (
    <div className="max-w-xl space-y-4">
      <PageHeader title="Profil" sub={`${user.email} · ${ROLE_LABEL[user.role]}`} />
      <div className="card space-y-2">
        <h2 className="font-semibold">Notifikasi Telegram {user.telegramLinked && <span className="text-sm font-normal text-green-700">✓ terhubung</span>}</h2>
        <p className="text-sm text-slate-500">Buat kode, lalu kirim perintah di bawah ke bot Telegram perusahaan. Email selalu aktif.</p>
        <button className="btn-ghost" onClick={async () => setCode(await api('/auth/telegram-code', { body: {} }))}>Buat kode tautan</button>
        {code && <p className="rounded-lg bg-slate-100 p-3 font-mono text-sm">{code.command} <span className="font-sans text-xs text-slate-500">(berlaku {code.expiresInSec / 60} menit)</span></p>}
      </div>
      <div className="card">
        <h2 className="mb-2 font-semibold">Ganti password</h2>
        <DynamicForm submitLabel="Ganti password" onSubmit={async (v) => { await api('/auth/change-password', { body: { current: v.current, next: v.next } }); setMsg('Password diganti.'); }}
          fields={[{ name: 'current', label: 'Password lama', type: 'password', required: true }, { name: 'next', label: 'Password baru (min 8)', type: 'password', required: true }]} />
        {msg && <p className="mt-2 text-sm text-green-700">{msg}</p>}
      </div>
    </div>
  );
}
