'use client';
import { Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, useFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DynamicForm } from '@/components/DynamicForm';
import { ErrorMsg, PageHeader } from '@/components/ui';

function NewWo() {
  const sp = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const { data: meta, error } = useFetch<any[]>('/work-orders/meta');
  const type = sp.get('type');
  const fromForm = sp.get('fromForm');
  const { data: sub } = useFetch<any>(fromForm ? `/subscriptions/${fromForm}` : null);
  const allowed = (meta ?? []).filter((m) => user?.role === 'ADMIN' || m.createRoles.includes(user?.role));
  const wf = allowed.find((m) => m.type === type);

  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  if (!meta || (fromForm && !sub)) return <p className="text-slate-500">Memuat…</p>;

  if (!wf)
    return (
      <>
        <PageHeader title="Buat Work Order" sub="Pilih jenis WO yang boleh dibuat divisi Anda" />
        <div className="grid gap-3 md:grid-cols-2">
          {allowed.map((m) => (
            <Link key={m.type} href={`/work-orders/new?type=${m.type}`} className="card hover:border-brand-500">
              <div className="font-semibold">{m.label}</div>
              <p className="text-sm text-slate-500">{m.description}</p>
            </Link>
          ))}
          {allowed.length === 0 && <p className="text-slate-500">Divisi Anda tidak memiliki hak membuat WO.</p>}
        </div>
      </>
    );

  return (
    <>
      <PageHeader title={`WO ${wf.label}`} sub={wf.description} />
      <div className="card max-w-2xl">
        <DynamicForm
          fields={wf.createFields}
          initial={sub ? { name: sub.name ?? '', phone: sub.phone ?? '', email: sub.email ?? '', address: sub.address ?? '', packageName: sub.packageName ?? '', notes: `Dari formulir berlangganan ${sub.regNo}` } : undefined}
          submitLabel="Ajukan WO"
          onSubmit={async (input) => {
            const r = await api<{ id: string }>('/work-orders', { body: { type: wf.type, input: fromForm ? { ...input, subscriptionId: fromForm } : input } });
            router.push(`/work-orders/${r.id}`);
          }}
        />
      </div>
    </>
  );
}

export default function NewWoPage() {
  return <Suspense fallback={<p>Memuat…</p>}><NewWo /></Suspense>;
}
