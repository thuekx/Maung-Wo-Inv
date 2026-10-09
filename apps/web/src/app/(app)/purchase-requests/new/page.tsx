'use client';
import { useRouter } from 'next/navigation';
import { useFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { emptyLine, PrEditor } from '@/components/PrEditor';

export default function NewPr() {
  const router = useRouter();
  const { user } = useAuth();
  const ga = user?.role === 'GA' || user?.role === 'ADMIN';
  const { data: docs } = useFetch<any>('/settings/docs');
  if (!docs) return <p className="text-slate-500">Memuat…</p>;
  return (
    <>
      <PageHeader pretitle="Pengadaan" title="Purchase Request baru" sub={ga ? `Input perbandingan harga minimal ${docs.minVendors} vendor per item, simpan sebagai draft atau langsung terbitkan PR (tidak perlu diajukan ke GA).` : 'Isi barang/jasa yang dibutuhkan. Perbandingan harga vendor dan PPN diisi GA/Procurement setelah PR diajukan.'} />
      <PrEditor initial={{ subject: '', note: '', taxPct: docs.taxPct, lines: [emptyLine()] }} minVendors={docs.minVendors} onSaved={(id, o) => router.replace(`/purchase-requests/${id}${o?.issue ? '?issue=1' : ''}`)} />
    </>
  );
}
