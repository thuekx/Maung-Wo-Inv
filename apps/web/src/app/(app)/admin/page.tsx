'use client';
import { useState } from 'react';
import { api, fmtDate, ROLE_LABEL, useFetch } from '@/lib/api';
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

const sTone = (s: string): any => (s === 'SENT' ? 'green' : s === 'FAILED' ? 'red' : 'amber');

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

export default function Admin() {
  const { user } = useAuth();
  const [tab, setTab] = useState('users');
  if (user?.role !== 'ADMIN') return <ErrorMsg>Khusus Admin</ErrorMsg>;
  return (
    <>
      <PageHeader title="Admin" sub="User, log notifikasi (email/Telegram), dan event ke aplikasi billing" />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'users', label: 'User' }, { key: 'notif', label: 'Log notifikasi' }, { key: 'out', label: 'Event ke Billing' }]} />
      {tab === 'users' && <Users />}
      {tab === 'notif' && <Notifs />}
      {tab === 'out' && <Outbound />}
    </>
  );
}
