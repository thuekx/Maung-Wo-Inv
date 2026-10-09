'use client';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useFetch } from '@/lib/api';
import { ErrorMsg, PageHeader } from '@/components/ui';
import { SubForm } from '@/components/SubForm';

export default function EditSubscription({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: s, error } = useFetch<any>(`/subscriptions/${id}`);
  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  if (!s) return <p className="text-slate-500">Memuat…</p>;
  const prefixLen = s.settings.regPrefix.length + 3;
  const str = (x: unknown) => (x === null || x === undefined ? '' : String(x));
  return (
    <>
      <PageHeader pretitle="Marketing" title={`Ubah formulir ${s.regNo}`} />
      <SubForm id={id} onSaved={() => router.replace(`/subscriptions/${id}`)}
        initial={{ formDate: String(s.formDate).slice(0, 10), regSuffix: s.regNo.slice(prefixLen), name: str(s.name), address: str(s.address), phone: str(s.phone), email: str(s.email), referral: str(s.referral), packageName: str(s.packageName), serviceNote: str(s.serviceNote), installFee: s.installFee == null ? '' : String(Math.round(Number(s.installFee))), monthlyFee: s.monthlyFee == null ? '' : String(Math.round(Number(s.monthlyFee))), picName: str(s.picName), picPhone: str(s.picPhone), payment: s.payment, marketingName: str(s.marketingName), managerName: str(s.managerName) }} />
    </>
  );
}
