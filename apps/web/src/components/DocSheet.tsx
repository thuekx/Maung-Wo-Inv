'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { fileUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useBranding } from '@/lib/photo';

/**
 * Lembar dokumen A4 berkop (gambar kop = latar penuh satu halaman; bisa diganti Admin di Branding, bawaan /kop-surat-a4.jpg).
 * Ruang isi di antara logo (atas) dan alamat (bawah). Dipakai PR, BA Digital, dan laporan. Cetak → "Simpan sebagai PDF".
 */
export function DocPage({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const brand = useBranding();
  const kop = brand.kopUrl ? fileUrl(brand.kopUrl) : '/kop-surat-a4.jpg';
  return (
    <section
      className={`doc-page relative mx-auto mb-6 box-border bg-white text-[11pt] leading-snug text-black shadow-lg print:mb-0 print:shadow-none ${className}`}
      style={{ width: '210mm', minHeight: '297mm', padding: '44mm 22mm 44mm', backgroundImage: `url(${kop})`, backgroundSize: '210mm 297mm', backgroundRepeat: 'repeat-y', pageBreakAfter: 'always', breakAfter: 'page' }}
    >
      {children}
    </section>
  );
}

/** Pembungkus halaman cetak: cek login, sembunyikan chrome aplikasi saat dicetak, tombol Cetak. */
export function DocShell({ title, fileName, back, children }: { title: string; /** nama berkas PDF saat "Simpan sebagai PDF" (= nomor dokumen) */ fileName?: string; back: string; children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();
  // Chrome memakai <title> sebagai nama berkas PDF → samakan dengan nomor dokumen (karakter terlarang diganti '-')
  useEffect(() => { const prev = document.title; document.title = (fileName ?? title).replace(/[\\/:*?"<>|]+/g, '-').trim(); return () => { document.title = prev; }; }, [fileName, title]);
  useEffect(() => { document.body.classList.add('free-print'); return () => document.body.classList.remove('free-print'); }, []);
  useEffect(() => { if (ready && !user) router.replace('/login'); }, [ready, user, router]);
  if (!ready || !user) return <p className="p-6 text-slate-500">Memuat…</p>;
  return (
    <div className="min-h-screen bg-slate-200 py-4 print:bg-white print:py-0">
      <style>{`@page { size: A4; margin: 0 } @media print { .doc-page:last-of-type { page-break-after: auto !important; break-after: auto !important } body { background: #fff !important } }`}</style>
      <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-2 px-2 print:hidden">
        <button className="btn-ghost" onClick={() => router.push(back)}>← Kembali</button>
        <span className="text-sm font-medium text-slate-600">{title}</span>
        <button className="btn" onClick={() => window.print()}>🖨 Cetak / Simpan PDF</button>
      </div>
      <p className="mx-auto mb-3 max-w-[210mm] px-2 text-xs text-slate-500 print:hidden">Di jendela cetak: pilih <b>Simpan sebagai PDF</b>, ukuran <b>A4</b>, margin <b>Tidak ada</b>, dan centang <b>Grafik latar belakang</b> agar kop surat ikut tercetak.</p>
      {children}
    </div>
  );
}

export const rupiah = (n: number | string | null | undefined) => `Rp. ${Math.round(Number(n ?? 0)).toLocaleString('id-ID')}`;
export const longDate = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }) : '');
