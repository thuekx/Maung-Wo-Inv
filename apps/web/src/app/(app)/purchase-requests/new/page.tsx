'use client';
import { useRouter } from 'next/navigation';
import { useFetch } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import { emptyLine, PrEditor } from '@/components/PrEditor';

export default function NewPr() {
  const router = useRouter();
  const { data: docs } = useFetch<any>('/settings/docs');
  if (!docs) return <p className="text-slate-500">Memuat…</p>;
  return (
    <>
      <PageHeader pretitle="Pengadaan" title="Purchase Request baru" sub="Isi barang/jasa dan bandingkan harga minimal 2 vendor per baris. Nomor surat & penandatangan diisi GA/Procurement saat menerbitkan PDF." />
      <PrEditor initial={{ subject: '', note: '', taxPct: docs.taxPct, lines: [emptyLine()] }} minVendors={docs.minVendors} onSaved={(id) => router.replace(`/purchase-requests/${id}`)} />
    </>
  );
}
