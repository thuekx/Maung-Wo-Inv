'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useFetch } from '@/lib/api';
import { Badge, custTone, ErrorMsg, PageHeader, Table } from '@/components/ui';


export default function Customers() {
  const [q, setQ] = useState('');
  const { data, error } = useFetch<any[]>(`/customers?q=${encodeURIComponent(q)}`);
  return (
    <>
      <PageHeader title="Pelanggan" sub="Pelanggan baru dibuat lewat WO Pasang Baru (Marketing)" />
      <input className="input mb-3 max-w-sm" placeholder="Cari nama / kode / telepon / IP…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorMsg>{error}</ErrorMsg>
      <Table head={['Kode', 'Nama', 'Paket', 'IP', 'Status']}>
        {data?.map((c) => (
          <tr key={c.id} className="hover:bg-slate-50">
            <td className="td"><Link className="font-medium text-brand-700 hover:underline" href={`/customers/${c.id}`}>{c.code}</Link></td>
            <td className="td">{c.name}</td>
            <td className="td">{c.packageName}</td>
            <td className="td font-mono text-xs">{c.ip ?? '-'}</td>
            <td className="td"><Badge tone={custTone(c.status)}>{c.status}</Badge></td>
          </tr>
        ))}
      </Table>
    </>
  );
}
