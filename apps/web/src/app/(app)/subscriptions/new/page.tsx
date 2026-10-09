'use client';
import { useRouter } from 'next/navigation';
import { useFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { SubForm } from '@/components/SubForm';

export default function NewSubscription() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: cfg } = useFetch<any>('/subscription-settings');
  if (!cfg || !user) return <p className="text-slate-500">Memuat…</p>;
  return (
    <>
      <PageHeader pretitle="Marketing" title="Formulir Berlangganan baru" sub="Isian bersifat opsional kecuali nomor registrasi. Paket & harga mengikuti hasil pencatatan MSRadius." />
      <SubForm onSaved={(id) => router.replace(`/subscriptions/${id}`)}
        initial={{ formDate: new Date().toISOString().slice(0, 10), regSuffix: '', name: '', address: '', phone: '', email: '', referral: '', packageName: '', serviceNote: '', installFee: '', monthlyFee: '', picName: '', picPhone: '', payment: cfg.defaultPayment, marketingName: user.name, managerName: cfg.managerName }} />
    </>
  );
}
