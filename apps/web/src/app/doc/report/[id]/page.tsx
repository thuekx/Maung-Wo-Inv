'use client';
import { use } from 'react';
import { imgUrl, useFetch } from '@/lib/api';
import { DocPage, DocShell, longDate } from '@/components/DocSheet';
import { ErrorMsg } from '@/components/ui';

/** Laporan Instalasi (Pasang Baru) / Laporan Troubleshooting (Trouble Ticket & Maintenance mandiri) berkop surat, siap cetak PDF. */
export default function ReportPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: wo, error } = useFetch<any>(`/work-orders/${id}`);
  const { data: foc } = useFetch<any[]>('/users/lookup?role=FOC');
  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  if (!wo) return <p className="p-6 text-slate-500">Memuat…</p>;
  const r = wo.data?.report, kind = wo.docs?.reportKind as 'INS' | 'TBS' | null;
  if (!kind || !r) return <ErrorMsg>Laporan baru tersedia setelah teknisi mengirim laporan lapangan.</ErrorMsg>;
  const refs: Record<string, string> = wo.refs ?? {};
  const c = wo.customer;
  const install = kind === 'INS';
  const manager = (foc ?? []).filter((u) => u.subRole === 'MANAGER');
  const photos: any[] = (wo.attachments ?? []).filter((a: any) => a.kind !== 'LOGO');
  const progress = photos.filter((a) => a.kind === 'PROGRESS'), final = photos.filter((a) => a.kind !== 'PROGRESS');
  const row = (k: string, v: React.ReactNode) => <tr><td className="w-44 py-0.5 align-top">{k}</td><td className="w-4 align-top">:</td><td className="py-0.5">{v === undefined || v === null || v === '' ? '-' : v}</td></tr>;
  const coord = r.lat != null && r.lng != null ? `${Number(r.lat).toFixed(6)}, ${Number(r.lng).toFixed(6)}` : c?.lat != null ? `${Number(c.lat).toFixed(6)}, ${Number(c.lng).toFixed(6)}` : null;
  const devices: string[] = [...(r.serials ?? []), ...(r.serialsNew ?? [])].map((s: string) => refs[s] ?? s);
  const removed: string[] = (r.serialsOld ?? []).map((s: string) => refs[s] ?? s);
  const mats: { itemId: string; qty: number }[] = r.materials ?? [];
  const team: string[] = r.team?.length ? r.team : (wo.team ?? []).map((t: any) => t.name);
  const gallery = (list: any[]) => (
    <div className="grid grid-cols-3 gap-2">
      {list.map((a) => (
        <figure key={a.id} className="break-inside-avoid">
          <img src={imgUrl(a.url, { w: 1200 })} alt="" className="aspect-[4/3] w-full rounded border bg-white object-contain" style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' } as React.CSSProperties} />
          <figcaption className="mt-0.5 text-[8pt] leading-tight text-gray-600">{a.note ? `${a.note} · ` : ''}{a.takenAt ? new Date(a.takenAt).toLocaleString('id-ID') : ''}{a.lat != null ? ` · ${Number(a.lat).toFixed(5)}, ${Number(a.lng).toFixed(5)}` : ''}</figcaption>
        </figure>
      ))}
    </div>
  );
  const number = wo.docs.reportNumber;
  const hasPhotos = progress.length + final.length > 0;
  const sigBlock = (
        <div className="mt-8 grid grid-cols-2 gap-8 break-inside-avoid text-center">
          <div><div>Pelaksana,</div><div>FOC Staff</div><div className="h-20" /><div className="font-semibold underline">{r.submittedBy ?? team[0] ?? ' '}</div></div>
          <div><div>Mengetahui,</div><div>FOC Manager</div><div className="h-20" /><div className="font-semibold underline">{manager.length === 1 ? manager[0].name : ' '}</div>{manager.length > 1 && <div className="text-[9pt] text-gray-500">(Manager FOC)</div>}</div>
        </div>
  );
  return (
    <DocShell title={`${install ? 'Laporan Instalasi' : 'Laporan Troubleshooting'} ${number}`} fileName={String(number)} back={`/work-orders/${id}`}>
      <DocPage>
        <h1 className="text-center text-[14pt] font-bold underline">{install ? 'LAPORAN INSTALASI' : 'LAPORAN TROUBLESHOOTING'}</h1>
        <div className="mb-5 text-center font-semibold">No. {number}</div>

        {install ? (
          <>
            <p className="mb-1 font-semibold">Data Pelanggan</p>
            <table className="mb-4 w-full"><tbody>
              {row('ID Pelanggan', c?.code)}{row('Nama Pelanggan', c?.name)}{row('Telepon / WA', c?.phone)}{row('Alamat Pemasangan', c?.address)}{row('Paket Layanan', c?.packageName)}
              {row('ODP / Port', `${r.odp ?? c?.odp ?? '-'} / ${r.port ?? c?.port ?? '-'}`)}
            </tbody></table>
            <p className="mb-1 font-semibold">Perangkat Terpasang</p>
            {devices.length ? <ul className="mb-4 list-disc pl-6">{devices.map((d, i) => <li key={i}>{d}</li>)}</ul> : <p className="mb-4">-</p>}
          </>
        ) : (
          <>
            <p className="mb-1 font-semibold">Referensi</p>
            <table className="mb-4 w-full"><tbody>
              {row('Nomor WO', wo.number)}
              {wo.type === 'MAINTENANCE' ? <>{row('Kegiatan', wo.title.replace(/^Maintenance – /, ''))}{row('Kategori', wo.data?.category)}{row('Lokasi', wo.data?.location)}</> : <>{row('Pelanggan', c ? `${c.name} (${c.code})` : '-')}{row('Alamat', c?.address)}{row('Keluhan', wo.data?.description)}</>}
            </tbody></table>
          </>
        )}

        <p className="mb-1 font-semibold">Data Teknis</p>
        <table className="mb-4 w-full"><tbody>
          {row('POP', r.pop ?? c?.pop)}{row('Main Splitter', r.mainSplitter)}
          {!install && row('ODP', r.odp ?? c?.odp)}
          {row('Koordinat', coord ? <>{coord} <a className="text-blue-700 underline print:no-underline" href={`https://www.google.com/maps?q=${coord.replace(' ', '')}`} target="_blank" rel="noreferrer">peta</a></> : null)}
          {row('Signal', r.signalDbm != null ? `${r.signalDbm} dBm` : null)}{row('Redaman', r.attenuationDb != null ? `${r.attenuationDb} dB` : r.opmDbm != null ? `${Math.abs(r.opmDbm)} dB` : null)}
          {install && row('Tanggal pelaksanaan', longDate(r.at))}
          {row('Tim Pelaksana', team.length ? team.join(', ') : null)}
        </tbody></table>

        {!install && (
          <>
            <p className="mb-1 font-semibold">Langkah Troubleshooting</p>
            {r.findings || r.actions || r.result ? (
              <table className="mb-4 w-full"><tbody>{row('Temuan', <span className="whitespace-pre-wrap">{r.findings}</span>)}{row('Tindakan', <span className="whitespace-pre-wrap">{r.actions}</span>)}{row('Hasil', <span className="whitespace-pre-wrap">{r.result}</span>)}</tbody></table>
            ) : <p className="mb-4 whitespace-pre-wrap">{r.note || '-'}</p>}
            {removed.length > 0 && <><p className="mb-1 font-semibold">Perangkat Diambil</p><ul className="mb-4 list-disc pl-6">{removed.map((d, i) => <li key={i}>{d}</li>)}</ul></>}
            {devices.length > 0 && <><p className="mb-1 font-semibold">Perangkat Baru Terpasang</p><ul className="mb-4 list-disc pl-6">{devices.map((d, i) => <li key={i}>{d}</li>)}</ul></>}
          </>
        )}

        {mats.length > 0 && (
          <>
            <p className="mb-1 font-semibold">Penggunaan Material</p>
            <table className="mb-4 w-full border-collapse text-[10pt]"><thead><tr className="border-b"><th className="py-0.5 text-left">Barang</th><th className="w-20 py-0.5 text-right">Jumlah</th></tr></thead>
              <tbody>{mats.map((m, i) => <tr key={i} className="border-b border-gray-300"><td className="py-0.5">{refs[m.itemId] ?? m.itemId}</td><td className="py-0.5 text-right">{m.qty}</td></tr>)}</tbody></table>
          </>
        )}
        {install && r.note && <><p className="mb-1 font-semibold">Catatan</p><p className="mb-4 whitespace-pre-wrap">{r.note}</p></>}

        {!hasPhotos && sigBlock}
      </DocPage>
      {hasPhotos && (
        <DocPage>
          <h2 className="mb-3 text-center font-bold">LAMPIRAN FOTO — {number}</h2>
          {progress.length > 0 && <><p className="mb-1 font-semibold">Lampiran Foto Progress</p><div className="mb-4">{gallery(progress)}</div></>}
          {final.length > 0 && <><p className="mb-1 font-semibold">Foto Akhir</p><div className="mb-4">{gallery(final)}</div></>}

          {sigBlock}
        </DocPage>
      )}
    </DocShell>
  );
}
