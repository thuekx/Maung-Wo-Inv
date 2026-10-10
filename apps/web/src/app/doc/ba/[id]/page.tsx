'use client';
import { use, useEffect, useState } from 'react';
import { api, fileUrl, useFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DocPage, DocShell, longDate } from '@/components/DocSheet';
import { ErrorMsg } from '@/components/ui';
import { useBranding } from '@/lib/photo';

/** Pratinjau Berita Acara Aktivasi Layanan (BA Digital) dari data WO Pasang Baru. */
/** Redaman (dB, positif); data lama menyimpan opmDbm negatif. */
const att = (r: any) => (r?.attenuationDb != null ? r.attenuationDb : r?.opmDbm != null ? Math.abs(r.opmDbm) : null);

export default function BaPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const brand = useBranding();
  const { data: wo, error } = useFetch<any>(`/work-orders/${id}`);
  const [devices, setDevices] = useState<{ sn: string; name: string }[]>([]);
  const serials: string[] = wo?.data?.report?.serials ?? [];
  useEffect(() => {
    if (!serials.length) return;
    Promise.all(serials.map((sn) => api<any>(`/assets/by-serial/${encodeURIComponent(sn)}`).then((a) => ({ sn, name: [a.item?.name, a.brand?.name, a.model?.name].filter(Boolean).join(' · ') })).catch(() => ({ sn, name: '' })))).then(setDevices);
  }, [serials.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (user && !['MKT', 'ADMIN'].includes(user.role)) return <ErrorMsg>BA Digital hanya dapat dilihat dan dikirim oleh Marketing.</ErrorMsg>;
  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  if (!wo) return <p className="p-6 text-slate-500">Memuat…</p>;
  if (wo.type !== 'NEW_INSTALL' || !wo.data?.activation) return <ErrorMsg>BA hanya tersedia untuk WO Pasang Baru yang sudah diaktivasi NOC.</ErrorMsg>;
  const c = wo.customer, act = wo.data.activation, ba = wo.data.ba;
  const number = ba?.number ?? wo.docs?.baNumber ?? `BAA/XXX/${wo.number}`;
  const row = (k: string, v: React.ReactNode) => <tr><td className="w-44 py-0.5 align-top">{k}</td><td className="w-4 align-top">:</td><td className="py-0.5">{v || '-'}</td></tr>;
  return (
    <DocShell title={`BA ${number}`} back={`/work-orders/${id}`}>
      {!ba && <p className="mx-auto mb-3 max-w-[210mm] rounded bg-amber-100 px-3 py-2 text-sm text-amber-900 print:hidden">Ini pratinjau — BA belum dikirim. Periksa isinya, lalu kembali ke WO dan klik &quot;Kirim BA Digital ke pelanggan&quot;.</p>}
      <DocPage>
        <h1 className="text-center text-[14pt] font-bold underline">BERITA ACARA AKTIVASI LAYANAN</h1>
        <div className="mb-5 text-center font-semibold">No. {number}</div>
        <p className="mb-3">Pada hari ini, {longDate(act.at)}, telah dilakukan instalasi dan aktivasi layanan internet dengan data sebagai berikut:</p>
        <table className="mb-4 w-full"><tbody>
          {row('ID Pelanggan', c.code)}{row('Nama Pelanggan', c.name)}{row('Telepon / WA', c.phone)}{row('Alamat Pemasangan', c.address)}{row('Paket Layanan', c.packageName)}
          {row('Tanggal Aktif', longDate(c.activatedAt ?? act.at))}{row('ODP / Port', `${c.odp ?? '-'} / ${c.port ?? '-'}`)}
        </tbody></table>
        <p className="mb-1 font-semibold">Perangkat terpasang</p>
        {devices.length ? <ul className="mb-4 list-disc pl-6">{devices.map((d) => <li key={d.sn}><span className="font-mono">{d.sn}</span>{d.name ? ` — ${d.name}` : ''}</li>)}</ul> : <p className="mb-4">-</p>}
        <p className="mb-1 font-semibold">Hasil pengujian layanan</p>
        <table className="mb-4 w-full"><tbody>
          {row('Profil bandwidth', act.profile)}{row('Ping / Latency', `${act.pingMs} ms${act.jitterMs != null && act.jitterMs !== '' ? ` · jitter ${act.jitterMs} ms` : ''}`)}{row('Speedtest', `Download ${act.downMbps} Mbps · Upload ${act.upMbps} Mbps`)}{row('Signal', wo.data.report?.signalDbm != null ? `${wo.data.report.signalDbm} dBm` : '')}{row('Redaman', att(wo.data.report) != null ? `${att(wo.data.report)} dB` : '')}
        </tbody></table>
        <p className="mb-6">Dengan ini kedua belah pihak menyatakan bahwa layanan telah terpasang dan berfungsi dengan baik, serta pelanggan menyetujui ketentuan berlangganan {brand.companyName}.</p>
        <div className="grid grid-cols-2 gap-8 text-center">
          <div><div>Pihak Pertama</div><div className="font-semibold">{brand.companyName}</div><div className="h-20" /><div className="font-semibold underline">{user?.name ?? ' '}</div><div className="text-[10pt]">Marketing</div></div>
          <div><div>Pihak Kedua</div><div className="font-semibold">Pelanggan</div><div className="h-20" /><div className="font-semibold underline">{c.name}</div></div>
        </div>
      </DocPage>
      {(act.photos?.length ?? 0) > 0 && (
        <DocPage>
          <h2 className="mb-1 text-center font-bold">LAMPIRAN — BUKTI HASIL SPEEDTEST</h2>
          <div className="mb-4 text-center text-[10pt]">No. {number}</div>
          <div className="space-y-4">{act.photos.map((u: string) => <img key={u} src={fileUrl(u)} alt="Hasil speedtest" className="mx-auto max-h-[110mm] max-w-full rounded border object-contain" />)}</div>
        </DocPage>
      )}
    </DocShell>
  );
}
