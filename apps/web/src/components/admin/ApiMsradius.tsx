'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api, useFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, ErrorMsg } from '@/components/ui';

/** Katalog endpoint MSRadius yang dapat ditarik saat ini + contoh respons nyata (1 item) per endpoint. Khusus Admin, hanya baca. */
export function ApiMsradius() {
  const { user } = useAuth();
  const { data, error } = useFetch<any>(user?.role === 'ADMIN' ? '/admin/radius/endpoints' : null);
  const [res, setRes] = useState<Record<string, { loading?: boolean; err?: string; out?: any }>>({});
  if (user && user.role !== 'ADMIN') return <ErrorMsg>Khusus Admin</ErrorMsg>;
  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  if (!data) return <p className="text-slate-500">Memuat…</p>;
  const run = async (key: string) => {
    setRes((r) => ({ ...r, [key]: { loading: true } }));
    try { const out = await api<any>(`/admin/radius/endpoints/${key}/sample`, { body: {} }); setRes((r) => ({ ...r, [key]: { out } })); }
    catch (e) { setRes((r) => ({ ...r, [key]: { err: (e as Error).message } })); }
  };
  return (
    <>
      <p className="mb-3 text-sm text-slate-500">{`Endpoint yang dapat ditarik saat ini dari ${data.baseUrl} — hanya GET (baca-saja)`}</p>
      {!data.tokenSet && <p className="mb-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800">Token belum diisi — isi di <Link className="underline" href="/admin">Pusat Admin → Integrasi MSRadius</Link> agar contoh respons bisa diambil.</p>}
      <p className="mb-3 text-sm text-slate-500">Tombol <b>Ambil contoh</b> memanggil MSRadius sungguhan (1 panggilan; batas 10 permintaan/menit per token) dan hanya menampilkan <b>1 item pertama</b>. Data pelanggan bersifat pribadi — jangan dibagikan di luar keperluan analisis.</p>
      <div className="space-y-3">
        {data.endpoints.map((e: any) => {
          const r = res[e.key] ?? {};
          return (
            <div key={e.key} className="card space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="font-semibold">{e.title}</h2>
                  <code className="break-all text-xs text-slate-600">GET {data.baseUrl}/{e.path}</code>
                </div>
                <button className="btn-ghost" disabled={!data.tokenSet || r.loading} onClick={() => run(e.key)}>{r.loading ? 'Memanggil…' : 'Ambil contoh'}</button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <Badge tone={e.usedBy.startsWith('—') ? 'slate' : 'green'}>Dipakai: {e.usedBy}</Badge>
                {e.params.length > 0 && <span>Parameter wajib: <code>{e.params.join(', ')}</code></span>}
                <span>{e.note}</span>
              </div>
              {r.err && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{r.err}</p>}
              {r.out && (
                <div>
                  <p className="mb-1 text-xs text-slate-500">Jumlah data: <b>{r.out.count}</b> · bentuk: {r.out.shape}{r.out.params ? ` · param: ${JSON.stringify(r.out.params)}` : ''}</p>
                  <div className="relative">
                    <pre className="max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">{JSON.stringify(r.out.sample, null, 2)}</pre>
                    <button className="btn-ghost absolute right-2 top-2 !px-2 !py-0.5 !text-xs" onClick={() => navigator.clipboard?.writeText(JSON.stringify(r.out.sample, null, 2))}>Salin</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
