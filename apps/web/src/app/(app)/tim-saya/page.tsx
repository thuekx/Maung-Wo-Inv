'use client';
import { useState } from 'react';
import { api, SUBROLE_LABEL, useFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { toast } from '@/lib/dialog';
import { DynamicForm } from '@/components/DynamicForm';
import { Badge, ErrorMsg, LinkBtn, Modal, PageHeader, Table } from '@/components/ui';

const SUB_OPTS = ['STAFF', 'SUPERVISOR'];

/** Manager menambah & mengatur supervisor/staf di divisinya sendiri. */
export default function TimSaya() {
  const { user } = useAuth();
  const ok = user?.role !== 'ADMIN' && user?.subRole === 'MANAGER';
  const { data, error, reload } = useFetch<any[]>(ok ? '/team' : null);
  const [show, setShow] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const [pw, setPw] = useState<any>(null);
  if (user && !ok) return <ErrorMsg>Khusus Manager divisi</ErrorMsg>;
  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  const patch = async (id: string, body: object) => { try { await api(`/team/${id}`, { method: 'PATCH', body }); reload(); } catch (e) { toast.error((e as Error).message); } };
  return (
    <>
      <PageHeader title="Tim Saya" sub="Tambah dan atur supervisor / staf di divisi Anda">
        <button className="btn" onClick={() => setShow(true)}>+ Tambah anggota</button>
      </PageHeader>
      <Table head={['Nama', 'Email', 'Sub-role', 'Status', '']} empty="Belum ada anggota">
        {(data ?? []).map((u) => {
          const locked = u.subRole === 'MANAGER';
          return (
            <tr key={u.id}>
              <td className="td">{u.name}</td><td className="td">{u.email}</td>
              <td className="td"><Badge>{SUBROLE_LABEL[u.subRole] ?? u.subRole}</Badge></td>
              <td className="td">{locked ? <Badge tone="green">Aktif</Badge> : <button className="btn-ghost !px-2.5 !py-1 !text-xs !text-brand-700" onClick={() => patch(u.id, { active: !u.active })}>{u.active ? 'Aktif' : 'Nonaktif'}</button>}{u.mustChangePassword && <div><Badge tone="amber">wajib ganti password</Badge></div>}</td>
              <td className="td whitespace-nowrap">{!locked && <><LinkBtn onClick={() => setEdit(u)}>Edit</LinkBtn><LinkBtn onClick={() => setPw(u)}>Reset PW</LinkBtn></>}</td>
            </tr>
          );
        })}
      </Table>
      {show && (
        <Modal title="Tambah anggota tim" onClose={() => setShow(false)}>
          <DynamicForm submitLabel="Tambah" onSubmit={async (v) => { await api('/team', { body: v }); setShow(false); toast.success('Anggota ditambahkan — wajib ganti password saat login pertama'); reload(); }}
            fields={[{ name: 'name', label: 'Nama', type: 'text', required: true }, { name: 'email', label: 'Email', type: 'text', required: true }, { name: 'subRole', label: 'Sub-role', type: 'select', required: true, options: SUB_OPTS }, { name: 'password', label: 'Password awal (min 8)', type: 'password', required: true }]} />
        </Modal>
      )}
      {edit && (
        <Modal title={`Edit ${edit.email}`} onClose={() => setEdit(null)}>
          <DynamicForm submitLabel="Simpan" initial={edit} onSubmit={async (v) => { await api(`/team/${edit.id}`, { method: 'PATCH', body: { name: v.name, subRole: v.subRole } }); setEdit(null); reload(); }}
            fields={[{ name: 'name', label: 'Nama', type: 'text', required: true }, { name: 'subRole', label: 'Sub-role', type: 'select', required: true, options: SUB_OPTS }]} />
        </Modal>
      )}
      {pw && (
        <Modal title={`Reset password ${pw.email}`} onClose={() => setPw(null)}>
          <DynamicForm submitLabel="Setel password" onSubmit={async (v) => { await api(`/team/${pw.id}`, { method: 'PATCH', body: { password: v.password } }); setPw(null); toast.success('Password diganti — wajib diganti lagi saat login'); reload(); }}
            fields={[{ name: 'password', label: 'Password baru (min 8)', type: 'password', required: true }]} />
        </Modal>
      )}
    </>
  );
}
