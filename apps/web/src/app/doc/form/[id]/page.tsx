'use client';
import { use } from 'react';
import { fileUrl, useFetch } from '@/lib/api';
import { DocShell, longDate } from '@/components/DocSheet';
import { ErrorMsg } from '@/components/ui';
import { useBranding } from '@/lib/photo';
import { TERMS } from '@/lib/terms';

/** Paket terpilih + maks. 3 varian yang mirip (awalan sama, beda angka belakang) — sama dengan pilihan di form. */
const split = (name: string) => { const m = /^(.*?)[-_ ]?(\d+(?:[.,]\d+)?)\s*(?:m|mb|mbps)?$/i.exec(name.trim()); return m ? { base: m[1].toLowerCase(), n: Number(m[2].replace(',', '.')) } : { base: name.toLowerCase(), n: NaN }; };
function shortlist(all: any[], selected: string | null, max = 3) {
  const cur = all.find((p) => p.name === selected);
  if (!cur) return all.slice(0, 4); // belum memilih paket: tampilkan beberapa saja
  const a = split(cur.name);
  return [cur, ...all.filter((p) => p.name !== cur.name && split(p.name).base === a.base).sort((x, y) => Math.abs(split(x.name).n - a.n) - Math.abs(split(y.name).n - a.n) || x.name.localeCompare(y.name)).slice(0, max)].sort((x, y) => split(x.name).n - split(y.name).n);
}

const Box = ({ on }: { on: boolean }) => <span className="mr-1.5 inline-block w-[1.1em] text-center">{on ? '☑' : '☐'}</span>;
const Bar = ({ a, b }: { a: string; b: string }) => <div className="bg-black px-1.5 py-[1px] text-[9pt] font-bold uppercase text-white">{a} <span className="mx-1">|</span> {b}</div>;
const Line = ({ label, value, h = 'h-6' }: { label: string; value?: React.ReactNode; h?: string }) => (
  <div className={`flex ${h} items-end`}><div className="w-[40mm] shrink-0 whitespace-nowrap text-[9.5pt]">{label}</div><div className="mr-2 text-[9.5pt]">:</div><div className="flex-1 border-b border-black pb-px text-[10pt]">{value}</div></div>
);

/** Formulir Berlangganan (A4): halaman 1 formulir, halaman berikutnya Syarat & Ketentuan (2 kolom). Tanpa kop L1V (memakai logo merek formulir). */
export default function FormPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const brand = useBranding();
  const { data: s, error } = useFetch<any>(`/subscriptions/${id}`);
  const { data: pkgs } = useFetch<any[]>('/packages');
  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  if (!s) return <p className="p-6 text-slate-500">Memuat…</p>;
  const c = s.settings;
  const logo = brand.formLogoUrl ? fileUrl(brand.formLogoUrl) : '/sunmori-logo.png';
  const rp = (n: unknown) => (n == null ? '' : Math.round(Number(n)).toLocaleString('id-ID'));
  const list = shortlist(pkgs ?? [], s.packageName);
  const inList = list.some((p) => p.name === s.packageName);
  return (
    <DocShell title={`Formulir ${s.regNo}`} fileName={String(s.regNo)} back={`/subscriptions/${id}`}>
      <style>{`@media print { .form-p1 { height: 296mm !important; min-height: 0 !important; overflow: hidden } }`}</style>
      <section className="doc-page form-p1 relative mx-auto mb-6 box-border bg-white text-black shadow-lg print:mb-0 print:shadow-none" style={{ width: '210mm', minHeight: '297mm', padding: '12mm 18mm 26mm', pageBreakAfter: 'always', breakAfter: 'page', fontSize: '10pt' }}>
        <img src={logo} alt="" className="absolute right-[18mm] top-[10mm] h-[24mm] w-auto" />
        <div className="pt-[10mm] text-center font-bold leading-tight"><div className="text-[11pt]">FORMULIR BERLANGGANAN</div><div className="text-[11pt]">SUBSCRIPTION FORMS</div></div>
        <div className="mt-[8mm] flex items-end justify-between text-[10pt]"><div><b>Tanggal</b> | Date <span className="ml-2 border-b border-black px-2">{longDate(s.formDate)}</span></div><div><b>Reg. No.</b> <span className="font-mono">{s.regNo}</span></div></div>
        <div className="mt-1"><Bar a="DATA PELANGGAN" b="SUBSCRIBER DATA" />
          <Line label="Nama | Name" value={s.name} /><Line label="Alamat | Address" value={s.address} h="min-h-6" /><Line label="Telpon | Telephone" value={s.phone} /><Line label="Email" value={s.email} /><Line label="Referral" value={s.referral} /></div>
        <div className="mt-2"><Bar a="JENIS LAYANAN YANG DIINGINKAN" b="SERVICE PREFERENCE REQUEST" />
          <div className="mt-1 text-[9pt]">Beri tanda untuk layanan yang anda inginkan | For service preference request please tick</div>
          <div className="mt-1 space-y-0.5 pl-4 text-[10pt]">
            {list.map((p) => <div key={p.id}><Box on={s.packageName === p.name} /><b>{p.name}</b>{p.speed ? ` — ${p.speed}` : ''}{p.priceSell != null ? ` — Rp. ${rp(p.priceSell)}` : ''}</div>)}
            {s.packageName && !inList && <div><Box on /><b>{s.packageName}</b></div>}
          </div>
          <div className="mt-1 flex text-[9.5pt]"><b className="w-14">Note :</b><span className="flex-1 border-b border-black">{s.serviceNote ?? '-'}</span></div></div>
        <div className="mt-2"><Bar a="INFORMASI TAGIHAN" b="BILLING PAYMENT METHOD" />
          <div className="mt-1 space-y-1 text-[9.5pt]">
            <div>Biaya Pemasangan | Installation Fee : <span className="border-b border-black px-1">Rp. {rp(s.installFee)}</span> (Pasca Bayar)</div>
            <div>Biaya Langganan Jaringan per bulan | Monthly Fee : <span className="border-b border-black px-1">Rp. {rp(s.monthlyFee)}</span> ({c.ppnNote})</div>
          </div>
          <Line label="Penanggungjawab | PIC" value={s.picName} /><Line label="Telepon | Telephone" value={s.picPhone} />
          <div className="mt-2 flex flex-wrap gap-x-6 text-[10pt]"><span>Pembayaran | Payment</span><span><Box on={s.payment === 'CASH'} />Tunai | Cash</span><span><Box on={s.payment === 'TRANSFER'} />Transfer</span><span><Box on={s.payment === 'DEBIT'} />Debet | Debit</span></div></div>
        <div className="mt-3 text-[9.5pt]"><b>Pembayaran dapat dilakukan ke</b>
          <table className="mt-1 ml-6"><tbody><tr><td className="pr-3">Bank Name</td><td>: {c.bankName}</td></tr><tr><td className="pr-3">Acc. Name</td><td>: {c.accName}</td></tr><tr><td className="pr-3">Acc. No</td><td>: {c.accNo}</td></tr></tbody></table></div>
        <p className="mt-3 text-[9.5pt]">Pelanggan menyetujui berlangganan setidaknya selama 12 bulan layanan, apabila berhenti sebelum 12 bulan maka <b>akan dikenakan penalti sesuai ketentuan.</b></p>
        <table className="mt-2 w-full border-collapse text-center text-[9.5pt]"><tbody><tr>
          <td className="w-1/3 border border-black p-1.5 align-top">Kami menyetujui Syarat dan ketentuan Berlangganan<br />| herewith We agree to Terms of subscription<div className="h-[26mm]" /><div className="mx-2 border-b border-black" /></td>
          <td className="w-1/3 border border-black p-1.5 align-top"><b>Marketing</b><div className="h-[26mm]" /><div className="mx-2 border-b border-black pb-px">{s.marketingName}</div></td>
          <td className="w-1/3 border border-black p-1.5 align-top"><b>Manager Marketing</b><div className="flex h-[26mm] items-center justify-center">{brand.mgrSignUrl && <img src={fileUrl(brand.mgrSignUrl)} alt="" className="max-h-[24mm] max-w-[90%]" />}</div><div className="mx-2 border-b border-black pb-px font-semibold">{s.managerName}</div></td>
        </tr></tbody></table>
        <div className="absolute bottom-[8mm] left-[18mm] right-[18mm] whitespace-pre-line text-left text-[7.5pt] leading-tight text-slate-600">{c.footer}</div>
      </section>
      <section className="doc-page form-p1 relative mx-auto mb-6 box-border bg-white text-black shadow-lg print:mb-0 print:shadow-none" style={{ width: "210mm", minHeight: "297mm", padding: "10mm 14mm 22mm" }}>
        <div style={{ columnCount: 2, columnGap: '8mm', fontSize: '6.4pt', lineHeight: 1.2, textAlign: 'justify' }}>
          {TERMS.map((t, i) => t.k === 'h' ? <h3 key={i} className="mb-1 mt-2 break-after-avoid text-center font-bold" style={{ fontSize: '7.4pt' }}>{t.t}</h3>
            : t.k === 'p' ? <p key={i} className="mb-1">{t.t}</p>
            : <div key={i} className="mb-0.5 flex gap-1.5 break-inside-avoid" style={{ paddingLeft: `${(t.lvl ?? 0) * 5}mm` }}><span className="w-4 shrink-0">{t.n}</span><span>{t.t}</span></div>)}
          <p className="mt-3 break-inside-avoid">{c.city}, {longDate(s.formDate)}</p>
        </div>
        <div className="absolute bottom-[8mm] left-[14mm] right-[14mm] whitespace-pre-line text-left text-[7.5pt] leading-tight text-slate-600">{c.footer}</div>
      </section>
    </DocShell>
  );
}
