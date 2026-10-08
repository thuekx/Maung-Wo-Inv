'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useBranding } from '@/lib/photo';

/** Cetak massal label QR aset pada lembar A4 (dibuka dari Inventori → Aset). Ukuran dalam mm agar presisi saat dicetak 100%. */
const PRESETS: Record<string, { label: string; cols: number; rows: number; w: number; h: number; mt: number; ml: number }> = {
  '3x8': { label: '3 × 8 — 70 × 37 mm (24 per lembar)', cols: 3, rows: 8, w: 70, h: 37, mt: 0.5, ml: 0 },
  '3x7': { label: '3 × 7 — 63,5 × 38,1 mm (21 per lembar, label standar)', cols: 3, rows: 7, w: 63.5, h: 38.1, mt: 15.15, ml: 9.75 },
  '4x10': { label: '4 × 10 — 52,5 × 29,7 mm (40 per lembar)', cols: 4, rows: 10, w: 52.5, h: 29.7, mt: 0, ml: 0 },
  '5x13': { label: '5 × 13 — 38 × 21,2 mm (65 per lembar, kecil)', cols: 5, rows: 13, w: 38, h: 21.2, mt: 10.7, ml: 10 },
  '2x4': { label: '2 × 4 — 99 × 67 mm (8 per lembar, besar)', cols: 2, rows: 4, w: 99, h: 67, mt: 14.5, ml: 6 },
};

export default function QrPrint() {
  const { user, ready } = useAuth();
  const router = useRouter();
  const brand = useBranding();
  const [assets, setAssets] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  const [preset, setPreset] = useState('3x8');
  const [copies, setCopies] = useState(1);
  const [skip, setSkip] = useState(0);
  const [guides, setGuides] = useState(true);
  const [opt, setOpt] = useState({ item: true, brand: true, code: true, company: true });

  useEffect(() => { document.body.classList.add('free-print'); return () => document.body.classList.remove('free-print'); }, []);
  useEffect(() => { if (ready && !user) router.replace('/login'); }, [ready, user, router]);
  useEffect(() => {
    if (!user) return;
    let ids: string[] = [];
    try { ids = JSON.parse(sessionStorage.getItem('qr_print_ids') ?? '[]'); } catch { /* kosong */ }
    if (!ids.length) { setAssets([]); return; }
    // ID dikirim per kelompok 300 (batas panjang URL), lalu diurutkan sesuai pilihan
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 300) chunks.push(ids.slice(i, i + 300));
    Promise.all(chunks.map((c) => api<any[]>(`/assets?ids=${c.join(',')}&limit=300`)))
      .then((parts) => { const m = new Map(parts.flat().map((a) => [a.id, a])); setAssets(ids.map((id) => m.get(id)).filter(Boolean)); })
      .catch((e) => setErr(e.message));
  }, [user]);

  const P = PRESETS[preset];
  const perPage = P.cols * P.rows;
  const cells = useMemo(() => {
    const list: (any | null)[] = Array(Math.max(0, Math.min(skip, perPage - 1))).fill(null);
    for (const a of assets ?? []) for (let i = 0; i < copies; i++) list.push(a);
    const pages: (any | null)[][] = [];
    for (let i = 0; i < list.length; i += perPage) pages.push(list.slice(i, i + perPage));
    return pages;
  }, [assets, copies, skip, perPage]);

  if (!ready || !user) return <p className="p-6 text-slate-500">Memuat…</p>;
  const qrMm = Math.min(P.h - 5, P.w * 0.46);
  const small = P.h < 25;

  return (
    <div className="min-h-screen bg-slate-200 print:bg-white">
      <style>{`@page { size: A4; margin: 0 } @media print { .no-print { display: none !important } .sheet { box-shadow: none !important; margin: 0 !important } body { background: #fff !important } }`}</style>
      <div className="no-print sticky top-0 z-10 space-y-3 border-b bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <b>Cetak label QR</b>
          <span className="text-sm text-slate-500">{assets?.length ?? '…'} aset × {copies} salinan = {(assets?.length ?? 0) * copies} label · {cells.length} lembar A4</span>
          <button className="btn ml-auto" onClick={() => window.print()} disabled={!assets?.length}>🖨 Cetak</button>
          <button className="btn-ghost" onClick={() => window.close()}>Tutup</button>
        </div>
        <div className="flex flex-wrap items-end gap-4 text-sm">
          <label>Ukuran label<select className="input mt-1 w-80" value={preset} onChange={(e) => setPreset(e.target.value)}>{Object.entries(PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
          <label>Salinan per aset<input className="input mt-1 w-24" type="number" min={1} max={20} value={copies} onChange={(e) => setCopies(Math.max(1, Number(e.target.value) || 1))} /></label>
          <label>Mulai dari label ke-<input className="input mt-1 w-24" type="number" min={1} max={perPage} value={skip + 1} onChange={(e) => setSkip(Math.max(0, (Number(e.target.value) || 1) - 1))} /></label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} /> Garis potong</label>
          {(['item', 'brand', 'code', 'company'] as const).map((k) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={opt[k]} onChange={(e) => setOpt({ ...opt, [k]: e.target.checked })} /> {{ item: 'Nama item', brand: 'Merk/tipe', code: 'Kode aset', company: 'Nama PT' }[k]}</label>)}
        </div>
        <p className="text-xs text-slate-500">Saat dialog cetak: ukuran kertas <b>A4</b>, skala <b>100% / Actual size</b>, margin <b>None</b>. “Mulai dari label ke-N” untuk melanjutkan lembar stiker yang sebagian sudah terpakai.</p>
      </div>
      {err && <p className="no-print p-4 text-red-600">{err}</p>}
      {assets && !assets.length && !err && <p className="no-print p-6 text-slate-600">Belum ada aset dipilih. Kembali ke Inventori → Aset & SN, centang aset, lalu klik “Cetak QR”.</p>}
      <div className="flex flex-col items-center gap-6 py-6 print:block print:gap-0 print:py-0">
        {cells.map((page, pi) => (
          <div key={pi} className="sheet relative bg-white shadow-lg" style={{ width: '210mm', height: '297mm', breakAfter: pi < cells.length - 1 ? 'page' : 'auto', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: `${P.mt}mm`, left: `${P.ml}mm`, display: 'grid', gridTemplateColumns: `repeat(${P.cols}, ${P.w}mm)`, gridAutoRows: `${P.h}mm` }}>
              {Array.from({ length: perPage }, (_, i) => page[i] ?? null).map((a, i) => (
                <div key={i} style={{ width: `${P.w}mm`, height: `${P.h}mm`, boxSizing: 'border-box', border: guides ? '0.2mm dashed #94a3b8' : 'none', padding: '1.5mm', display: 'flex', alignItems: 'center', gap: '1.5mm', overflow: 'hidden', color: '#000' }}>
                  {a && <>
                    <QRCodeSVG value={a.serialNumber} size={256} style={{ width: `${qrMm}mm`, height: `${qrMm}mm`, flex: 'none' }} />
                    <div style={{ minWidth: 0, lineHeight: 1.15, fontSize: small ? '6pt' : '8pt' }}>
                      <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: small ? '7pt' : '9.5pt', wordBreak: 'break-all' }}>{a.serialNumber}</div>
                      {opt.item && <div style={{ fontWeight: 600 }}>{a.item.name}</div>}
                      {opt.brand && (a.brand || a.model) && <div>{[a.brand?.name, a.model?.name].filter(Boolean).join(' ')}</div>}
                      {opt.code && a.assetCode && a.assetCode !== a.serialNumber && <div>{a.assetCode}</div>}
                      {opt.company && <div style={{ marginTop: '0.8mm', color: '#475569', fontSize: small ? '5pt' : '6.5pt' }}>{brand.companyName}</div>}
                    </div>
                  </>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
