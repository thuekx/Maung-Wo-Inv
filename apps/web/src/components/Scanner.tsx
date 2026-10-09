'use client';
import { useEffect, useId, useRef, useState } from 'react';

/** Hasil pindai bisa berupa SN polos (barcode) atau tautan label QR ".../a/SN" → ambil SN-nya saja. */
export function parseScan(raw: string): string {
  const t = raw.trim();
  try {
    const u = new URL(t);
    const m = /\/a\/([^/?#]+)/.exec(u.pathname);
    if (m) return decodeURIComponent(m[1]).trim().toUpperCase();
    const q = u.searchParams.get('sn');
    if (q) return q.trim().toUpperCase();
  } catch { /* bukan URL: SN polos */ }
  return t.toUpperCase();
}


async function loadLib() {
  const m = await import('html5-qrcode');
  const F = m.Html5QrcodeSupportedFormats;
  const formats = [F.QR_CODE, F.CODE_128, F.CODE_39, F.CODE_93, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.ITF, F.CODABAR, F.DATA_MATRIX, F.PDF_417, F.AZTEC].filter((x) => x !== undefined);
  return { Html5Qrcode: m.Html5Qrcode, formats };
}

/** Perkecil foto (maks. 1600 px) agar pembacaan barcode dari foto kamera ponsel lebih cepat & andal. */
async function shrink(file: File): Promise<File> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); // latar putih (PNG transparan → JPEG tidak menjadi hitam)
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', 0.92));
    return new File([blob], 'scan.jpg', { type: 'image/jpeg' });
  } catch { return file; }
}

/**
 * Tombol pindai barcode/QR.
 * - Kamera langsung: hanya di halaman HTTPS (aturan browser untuk akses kamera; di HTTP tombol ini tidak bisa membuka kamera).
 * - "Foto barcode": membuka kamera ponsel lewat input file (berfungsi juga di HTTP), lalu barcode dibaca dari foto.
 * - Scanner barcode eksternal (USB/Bluetooth) bekerja sebagai keyboard: cukup klik kolom isian lalu scan.
 */
export function ScanButtons({ onScan }: { onScan: (text: string) => void }) {
  const [live, setLive] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const scanRef = useRef(onScan);
  scanRef.current = onScan;
  const id = `qr-live-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const fileId = `${id}-file`;
  const [secure, setSecure] = useState(false); // dihitung setelah mount (hindari beda render server/klien)
  useEffect(() => { setSecure(window.isSecureContext && !!navigator.mediaDevices?.getUserMedia); }, []);

  useEffect(() => {
    if (!live) return;
    let stop: (() => Promise<void>) | undefined;
    let cancelled = false;
    (async () => {
      const { Html5Qrcode, formats } = await loadLib();
      if (cancelled) return;
      const sc = new Html5Qrcode(id, { formatsToSupport: formats, useBarCodeDetectorIfSupported: true, verbose: false });
      stop = async () => { try { await sc.stop(); sc.clear(); } catch { /* sudah berhenti */ } };
      try {
        await sc.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 280, height: 180 } }, (txt) => scanRef.current(txt), () => {});
      } catch (e) {
        setLive(false);
        const n = (e as Error)?.name ?? '';
        setMsg(n === 'NotAllowedError' || /permission/i.test(String(e)) ? 'Izin kamera ditolak — izinkan kamera untuk situs ini di pengaturan browser, atau pakai "Foto barcode".' : `Kamera tidak dapat dibuka (${(e as Error)?.message ?? e}). Pakai "Foto barcode".`);
      }
    })();
    return () => { cancelled = true; stop?.(); };
  }, [live, id]);

  const onFile = async (f?: File) => {
    if (!f) return;
    setBusy(true); setMsg('');
    try {
      const { Html5Qrcode, formats } = await loadLib();
      const sc = new Html5Qrcode(fileId, { formatsToSupport: formats, useBarCodeDetectorIfSupported: true, verbose: false });
      const txt = await sc.scanFile(await shrink(f), false);
      try { sc.clear(); } catch { /* abaikan */ }
      scanRef.current(txt);
    } catch (e) { console.warn('scanFile gagal:', e); setMsg('Barcode/QR tidak terbaca dari foto. Dekatkan kamera, pastikan terang & fokus, lalu coba lagi — atau ketik SN manual.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      {secure && <button type="button" className="btn-ghost" onClick={() => { setMsg(''); setLive(!live); }}>{live ? 'Tutup kamera' : '📷 Scan'}</button>}
      <label className={`btn-ghost cursor-pointer ${busy ? 'opacity-60' : ''}`}>{busy ? 'Membaca…' : secure ? '🖼 Foto' : '📷 Foto barcode'}
        <input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      <div id={fileId} className="hidden" />
      {live && <div id={id} className="mt-2 w-full max-w-sm basis-full overflow-hidden rounded-lg border" />}
      {!secure && <p className="basis-full text-xs text-slate-500">Kamera langsung butuh HTTPS; di sini kamera ponsel dibuka lewat <b>Foto barcode</b>. Scanner barcode eksternal (USB/Bluetooth): klik kolom SN lalu scan.</p>}
      {msg && <p className="basis-full text-xs font-medium text-red-600" role="alert">{msg}</p>}
    </>
  );
}
