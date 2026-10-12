'use client';
import { useState } from 'react';
import { api, useFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, ErrorMsg } from '@/components/ui';

type Sample = { loading?: boolean; err?: string; out?: any };

/** API sistem ini untuk dibaca aplikasi lain: autentikasi, daftar endpoint, contoh curl, dan contoh respons nyata (khusus Admin). */
export function ApiSistem() {
  const { user } = useAuth();
  const { data, error } = useFetch<any>(user?.role === 'ADMIN' ? '/admin/system-api' : null);
  const [res, setRes] = useState<Record<string, Sample>>({});
  if (user && user.role !== 'ADMIN') return <ErrorMsg>Khusus Admin</ErrorMsg>;
  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  if (!data) return <p className="text-slate-500">Memuat…</p>;
  const run = async (id: string, body: object) => {
    setRes((r) => ({ ...r, [id]: { loading: true } }));
    try { const out = await api<any>('/admin/system-api/sample', { body }); setRes((r) => ({ ...r, [id]: { out } })); }
    catch (e) { setRes((r) => ({ ...r, [id]: { err: (e as Error).message } })); }
  };
  const Sample = ({ id }: { id: string }) => {
    const r = res[id] ?? {};
    return (<>
      {r.err && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{r.err}</p>}
      {r.out && <div><p className="mb-1 text-xs text-slate-500">HTTP {r.out.httpStatus} · contoh respons nyata (dipotong 1 data)</p><pre className="max-h-80 overflow-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">{JSON.stringify(r.out.sample, null, 2)}</pre></div>}
    </>);
  };
  const base = data.baseUrl;
  return (
    <>
      <p className="mb-3 text-sm text-slate-500">"Endpoint Maung-Wo-Inv yang dapat dibaca aplikasi lain (BI, billing, tracking sales, dll)"</p>
      <div className="space-y-4">
        <div className="card space-y-2 text-sm">
          <h2 className="font-semibold">Autentikasi & aturan umum</h2>
          <ul className="list-disc space-y-1 pl-5 text-slate-600">
            <li>Base URL: <code>{base}</code> (pakai alamat HTTPS publik bila diakses dari luar jaringan).</li>
            <li>Kunci dikirim di header <code>x-api-key</code> (atau <code>Authorization: Bearer …</code>). Kunci <b>Ekspor</b>: <Badge tone={data.export.enabled ? 'green' : 'amber'}>{data.export.enabled ? `aktif ${data.export.keyHint}` : 'nonaktif — isi EXPORT_API_KEY di .env'}</Badge> · kunci <b>Billing</b>: <Badge tone={data.billing.enabled ? 'green' : 'amber'}>{data.billing.enabled ? `aktif ${data.billing.keyHint}` : 'belum diisi'}</Badge>.</li>
            <li>Mengganti/memutar kunci: ubah <code>EXPORT_API_KEY</code> / <code>BILLING_API_KEY</code> di <code>.env</code> lalu <code>docker compose up -d</code>. Kunci memberi akses ke seluruh data — simpan seperti password dan pakai HTTPS.</li>
            <li>Batas: {data.export.rateLimit}. Respons galat: <code>401</code> kunci salah, <code>503</code> API nonaktif. Dokumentasi lengkap & riwayat perubahan: <code>docs/API.md</code> di repo (diperbarui setiap ada perubahan).</li>
          </ul>
        </div>

        <div className="card space-y-3">
          <h2 className="font-semibold">Ekspor data (baca-saja) <span className="text-sm font-normal text-slate-500">— GET, JSON atau CSV</span></h2>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-slate-500"><th className="py-1 pr-3">Parameter</th><th className="py-1">Keterangan</th></tr></thead>
            <tbody>{data.export.params.map(([k, v]: string[]) => <tr key={k} className="border-b last:border-0"><td className="py-1 pr-3 font-mono text-xs">{k}</td><td className="py-1 text-slate-600">{v}</td></tr>)}</tbody></table></div>
          {data.export.resources.map((e: any) => (
            <div key={e.key} className="space-y-1.5 rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0"><code className="break-all text-sm font-semibold">GET {e.path}</code><p className="text-sm text-slate-500">{e.description}</p></div>
                <button className="btn-ghost" disabled={!data.export.enabled || res[`e-${e.key}`]?.loading} onClick={() => run(`e-${e.key}`, { kind: 'export', resource: e.key })}>{res[`e-${e.key}`]?.loading ? 'Memanggil…' : 'Ambil contoh'}</button>
              </div>
              <pre className="overflow-x-auto rounded bg-slate-100 p-2 text-xs dark:bg-slate-800">{`curl -H "x-api-key: <KUNCI>" "${base}${e.path}?limit=100&since=2026-10-01"`}</pre>
              <Sample id={`e-${e.key}`} />
            </div>
          ))}
        </div>

        <div className="card space-y-3">
          <h2 className="font-semibold">Integrasi Billing <span className="text-sm font-normal text-slate-500">— dua arah</span></h2>
          {data.billing.endpoints.map((e: any) => (
            <div key={e.path} className="space-y-1.5 rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0"><code className="break-all text-sm font-semibold">{e.method} {e.path}</code><p className="text-sm text-slate-500">{e.description}</p></div>
                {e.method === 'GET' && <button className="btn-ghost" disabled={res.bill?.loading} onClick={() => run('bill', { kind: 'billing-customer' })}>Ambil contoh</button>}
              </div>
              {e.body && <pre className="overflow-x-auto rounded bg-slate-100 p-2 text-xs dark:bg-slate-800">{`curl -X POST ${base}${e.path} -H "x-api-key: <KUNCI>" -H "content-type: application/json" \\\n  -d '${e.body}'`}</pre>}
              {e.method === 'GET' && <Sample id="bill" />}
            </div>
          ))}
        </div>

        <div className="card space-y-3">
          <h2 className="font-semibold">Publik (tanpa kunci)</h2>
          {data.public.endpoints.map((e: any) => (
            <div key={e.path} className="space-y-1.5 rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><code className="break-all text-sm font-semibold">{e.method} {e.path}</code><p className="text-sm text-slate-500">{e.description}</p></div>
                <button className="btn-ghost" disabled={res.pub?.loading} onClick={() => run('pub', { kind: 'public-asset' })}>Ambil contoh</button></div>
              <Sample id="pub" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
