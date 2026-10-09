'use client';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useFetch } from '@/lib/api';
import { ErrorMsg, PageHeader } from '@/components/ui';
import { PrEditor } from '@/components/PrEditor';

export default function EditPr({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: pr, error } = useFetch<any>(`/purchase-requests/${id}`);
  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  if (!pr) return <p className="text-slate-500">Memuat…</p>;
  return (
    <>
      <PageHeader pretitle="Pengadaan" title="Ubah draft PR" />
      <PrEditor
        prId={id}
        minVendors={pr.docs.minVendors}
        initial={{
          subject: pr.subject, note: pr.note ?? '', taxPct: Number(pr.taxPct),
          lines: pr.lines.map((l: any) => ({ description: l.description, qty: l.qty, unit: l.unit, itemId: l.itemId ?? '', note: l.note ?? '', quotes: [...l.quotes.map((q: any) => ({ vendorId: q.vendorId, unitPrice: Number(q.unitPrice), note: q.note ?? '', chosen: q.chosen })), ...Array.from({ length: Math.max(0, pr.docs.minVendors - l.quotes.length) }, () => ({ vendorId: '', unitPrice: '' as number | string, note: '', chosen: false }))] })),
        }}
        onSaved={() => router.replace(`/purchase-requests/${id}`)}
      />
    </>
  );
}
