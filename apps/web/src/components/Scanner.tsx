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

let audio: AudioContext | null = null;
/** Umpan balik singkat saat scan: bunyi tinggi + getar = masuk; bunyi rendah = ditolak (mis. SN ganda). */
export function scanFeedback(ok: boolean) {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator(); const g = audio.createGain();
    o.frequency.value = ok ? 1800 : 400; g.gain.value = 0.15;
    o.connect(g); g.connect(audio.destination);
    o.start(); o.stop(audio.currentTime + (ok ? 0.08 : 0.25));
  } catch { /* browser tanpa audio: abaikan */ }
  try { navigator.vibrate?.(ok ? 60 : [80, 60, 80]); } catch { /* abaikan */ }
}


async function loadLib() {
  const m = await import('html5-qrcode');
  const F = m.Html5QrcodeSupportedFormats;
  const formats = [F.QR_CODE, F.CODE_128, F.CODE_39, F.CODE_93, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.ITF, F.CODABAR, F.DATA_MATRIX, F.PDF_417, F.AZTEC].filter((x) => x !== undefined);
  return { Html5Qrcode: m.Html5Qrcode, formats };
}

/** Perkecil foto (maks. `max` px) agar pembacaan lebih cepat; barcode 1D kecil butuh resolusi tinggi (2560 px). */
async function shrink(file: File, max = 2560): Promise<File> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
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
  const camRef = useRef<any>(null);
  const [zoom, setZoom] = useState<{ min: number; max: number; step: number; value: number } | null>(null);
  const [torchOk, setTorchOk] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const scanRef = useRef(onScan);
  scanRef.current = onScan;
  const last = useRef({ t: '', at: 0 });
  /** Kamera membaca berkali-kali per detik: kode yang sama dalam 2,5 detik dianggap satu kali scan. */
  const liveScan = (txt: string) => {
    const now = Date.now();
    if (txt === last.current.t && now - last.current.at < 2500) { last.current.at = now; return; }
    last.current = { t: txt, at: now };
    scanRef.current(txt);
  };
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
        // Barcode 1D kecil: resolusi tinggi + fokus kontinu + kotak baca lebar-pendek; zoom & senter bila didukung perangkat
        await sc.start(
          { facingMode: 'environment' },
          {
            fps: 15,
            qrbox: (w: number, h: number) => ({ width: Math.floor(Math.min(w * 0.92, 520)), height: Math.floor(Math.min(h * 0.45, 190)) }),
            videoConstraints: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 }, advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] } as MediaTrackConstraints,
          },
          (txt) => liveScan(txt),
          () => {},
        );
        camRef.current = sc;
        try {
          const caps = sc.getRunningTrackCameraCapabilities();
          const z = caps.zoomFeature();
          if (z.isSupported()) setZoom({ min: z.min(), max: z.max(), step: z.step() || 0.1, value: Math.min(z.max(), Math.max(z.min(), 2)) }); // mulai 2× — membantu barcode kecil
          if (z.isSupported()) await z.apply(Math.min(z.max(), Math.max(z.min(), 2)));
          setTorchOk(caps.torchFeature().isSupported());
        } catch { /* perangkat tidak mendukung kontrol kamera: abaikan */ }
      } catch (e) {
        setLive(false);
        const n = (e as Error)?.name ?? '';
        setMsg(n === 'NotAllowedError' || /permission/i.test(String(e)) ? 'Izin kamera ditolak — izinkan kamera untuk situs ini di pengaturan browser, atau pakai "Foto barcode".' : `Kamera tidak dapat dibuka (${(e as Error)?.message ?? e}). Pakai "Foto barcode".`);
      }
    })();
    return () => { cancelled = true; stop?.(); camRef.current = null; setZoom(null); setTorchOk(false); setTorchOn(false); };
  }, [live, id]);

  const changeZoom = async (v: number) => { setZoom((z) => (z ? { ...z, value: v } : z)); try { await camRef.current?.getRunningTrackCameraCapabilities().zoomFeature().apply(v); } catch { /* abaikan */ } };
  const toggleTorch = async () => { try { const t = camRef.current?.getRunningTrackCameraCapabilities().torchFeature(); await t.apply(!torchOn); setTorchOn(!torchOn); } catch { /* abaikan */ } };
  /** Ketuk pratinjau = minta fokus ulang (ponsel yang mendukung). */
  const refocus = async () => { try { await camRef.current?.applyVideoConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }); } catch { /* abaikan */ } };

  const onFile = async (f?: File) => {
    if (!f) return;
    setBusy(true); setMsg('');
    try {
      const { Html5Qrcode, formats } = await loadLib();
      const sc = new Html5Qrcode(fileId, { formatsToSupport: formats, useBarCodeDetectorIfSupported: true, verbose: false });
      let txt: string;
      try { txt = await sc.scanFile(await shrink(f, 2560), false); }
      catch { try { txt = await sc.scanFile(f, false); } catch { txt = await sc.scanFile(await shrink(f, 1280), false); } } // coba resolusi asli, lalu lebih kecil
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
      {live && <div id={id} onClick={refocus} className="mt-2 w-full max-w-sm basis-full overflow-hidden rounded-lg border" />}
      {live && (zoom || torchOk) && (
        <div className="flex w-full max-w-sm basis-full items-center gap-3 text-xs text-slate-600">
          {zoom && <label className="flex flex-1 items-center gap-2">Zoom<input type="range" className="flex-1" min={zoom.min} max={zoom.max} step={zoom.step} value={zoom.value} onChange={(e) => changeZoom(Number(e.target.value))} /><span className="w-8 text-right">{zoom.value.toFixed(1)}×</span></label>}
          {torchOk && <button type="button" className="btn-ghost !px-2 !py-1 !text-xs" onClick={toggleTorch}>{torchOn ? '🔦 Matikan' : '🔦 Senter'}</button>}
        </div>
      )}
      {live && <p className="basis-full text-xs text-slate-500">Kamera tetap terbuka: arahkan ke barcode berikutnya, setiap SN langsung masuk ke daftar (bunyi &quot;bip&quot;). Barcode kecil: jauhkan ±15–20 cm, luruskan sejajar kotak, naikkan <b>zoom</b>, nyalakan <b>senter</b> bila gelap, ketuk layar untuk fokus ulang. Tak juga terbaca? Pakai <b>🖼 Foto</b> (memakai kamera bawaan ponsel yang autofokus).</p>}
      {!secure && <p className="basis-full text-xs text-slate-500">Kamera langsung butuh HTTPS; di sini kamera ponsel dibuka lewat <b>Foto barcode</b>. Scanner barcode eksternal (USB/Bluetooth): klik kolom SN lalu scan.</p>}
      {msg && <p className="basis-full text-xs font-medium text-red-600" role="alert">{msg}</p>}
    </>
  );
}
