'use client';
import { use } from 'react';
import { useFetch } from '@/lib/api';
import { DocPage, DocShell, longDate, rupiah } from '@/components/DocSheet';
import { ErrorMsg } from '@/components/ui';

/** Surat Pengajuan (PR) sesuai format perusahaan: halaman 1 rincian biaya + tanda tangan, halaman 2 perbandingan vendor. */
export default function PrPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: pr, error } = useFetch<any>(`/purchase-requests/${id}`);
  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  if (!pr) return <p className="p-6 text-slate-500">Memuat…</p>;
  const draft = !pr.number;
  const th = 'border border-black px-2 py-1 text-center font-semibold';
  const td = 'border border-black px-2 py-1 align-top';
  const chosen = (l: any) => l.quotes.find((q: any) => q.chosen);
  return (
    <DocShell title={`PR ${pr.number ?? '(draft)'}`} back={`/purchase-requests/${id}`}>
      {draft && <p className="mx-auto mb-3 max-w-[210mm] rounded bg-amber-100 px-3 py-2 text-sm text-amber-900 print:hidden">PR ini belum diterbitkan — nomor surat & penandatangan akan terisi setelah GA/Procurement menerbitkan PDF.</p>}
      <DocPage>
        <h1 className="text-center text-[15pt] font-bold tracking-wide">PENGAJUAN</h1>
        <div className="mb-4 text-center font-semibold">{pr.number ?? '…/…/…/…/….'}</div>
        <table className="mb-3"><tbody><tr><td className="pr-3">Perihal</td><td className="pr-2">:</td><td>{pr.subject}</td></tr></tbody></table>
        <p className="mb-3">Dengan Surat ini kami mengajukan untuk pembelian (sesuai kebutuhan), berikut untuk rincian biayanya :</p>
        <table className="w-full border-collapse text-[10pt]">
          <thead><tr><th className={th} style={{ width: '6%' }}>No</th><th className={th}>Deskripsi</th><th className={th} style={{ width: '8%' }}>Qty</th><th className={th} style={{ width: '10%' }}>Satuan</th><th className={th} style={{ width: '17%' }}>Nominal</th><th className={th} style={{ width: '17%' }}>Total</th></tr></thead>
          <tbody>
            {pr.lines.map((l: any, i: number) => {
              const c = chosen(l);
              return <tr key={l.id}><td className={`${td} text-center`}>{i + 1}</td><td className={td}>{l.description}</td><td className={`${td} text-center`}>{l.qty}</td><td className={`${td} text-center`}>{l.unit}</td><td className={`${td} text-right`}>{c ? rupiah(c.unitPrice) : 'Rp.'}</td><td className={`${td} text-right`}>{c ? rupiah(l.qty * Number(c.unitPrice)) : 'Rp.'}</td></tr>;
            })}
            <tr><td className={td} colSpan={4} style={{ border: 'none' }} /><td className={`${td} text-right`}>PPN {Number(pr.taxPct)}%</td><td className={`${td} text-right`}>{rupiah(pr.totals.tax)}</td></tr>
            <tr><td className={td} colSpan={4} style={{ border: 'none' }} /><td className={`${td} text-right font-bold`}>Grand Total</td><td className={`${td} text-right font-bold`}>{rupiah(pr.totals.grandTotal)}</td></tr>
          </tbody>
        </table>
        <p className="mt-6">Demikian Surat Pengajuan ini saya buat, atas perhatian dan realisasinya saya ucapkan terima kasih.</p>
        <p className="mt-6 text-right">{pr.city}, {longDate(pr.docDate ?? new Date())}</p>
        <div className="mt-4 grid grid-cols-3 gap-4 text-center">
          {[['Mengajukan', pr.signRequester, pr.signRequesterTitle], ['Mengetahui', pr.signKnow, pr.signKnowTitle], ['Menyetujui', pr.signApprove, pr.signApproveTitle]].map(([h, name, title]) => (
            <div key={h as string}><div className="font-semibold">{h}</div><div className="h-20" /><div className="font-semibold underline">{name || ' '}</div>{title ? <div className="text-[10pt]">{title}</div> : null}</div>
          ))}
        </div>
      </DocPage>
      <DocPage>
        <h2 className="mb-2 text-[13pt] font-bold">Perbandingan:</h2>
        <table className="w-full border-collapse text-[10pt]">
          <thead><tr><th className={th} style={{ width: '5%' }}>No</th><th className={th}>Deskripsi</th><th className={th}>Vendor</th><th className={th} style={{ width: '17%' }}>Nominal</th><th className={th} style={{ width: '18%' }}>Total</th><th className={th}>Keterangan</th></tr></thead>
          <tbody>
            {pr.lines.map((l: any, i: number) => l.quotes.map((q: any, k: number) => (
              <tr key={q.id} className={q.chosen ? 'font-semibold' : ''}>
                {k === 0 && <td className={`${td} text-center`} rowSpan={l.quotes.length}>{i + 1}</td>}
                {k === 0 && <td className={td} rowSpan={l.quotes.length}>{l.description}<div className="text-[9pt] font-normal">Kebutuhan: {l.qty} {l.unit}</div></td>}
                <td className={td}>{q.vendor.name}</td>
                <td className={`${td} whitespace-nowrap text-right`}>{rupiah(q.unitPrice)}</td>
                <td className={`${td} whitespace-nowrap text-right`}>{rupiah(l.qty * Number(q.unitPrice))}</td>
                <td className={td}>{q.chosen ? '✓ Dipilih' : ''}{[q.note, k === 0 ? l.note : ''].filter(Boolean).map((t) => <div key={t} className="font-normal">{t}</div>)}</td>
              </tr>
            )))}
            <tr><td className={`${td} text-right font-bold`} colSpan={4}>Total (vendor terpilih, sebelum PPN)</td><td className={`${td} whitespace-nowrap text-right font-bold`}>{rupiah(pr.totals.subtotal)}</td><td className={td} /></tr>
          </tbody>
        </table>
        {pr.note && <p className="mt-3 text-[10pt]">Catatan: {pr.note}</p>}
      </DocPage>
    </DocShell>
  );
}
