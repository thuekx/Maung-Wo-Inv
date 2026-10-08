'use client';
import { useEffect, useState } from 'react';
import { API, api, fileUrl, getToken } from './api';

/* ── branding publik (nama PT, logo, kebijakan GPS) ── */
export interface Branding { companyName: string; logoUrl: string | null; requireGps: boolean }
let brandingP: Promise<Branding> | null = null;
let brandingAt = 0;
export const loadBranding = (force = false) => {
  if (force || !brandingP || Date.now() - brandingAt > 60_000) {
    brandingAt = Date.now();
    brandingP = api<Branding>('/branding').catch(() => ({ companyName: 'PT L1V', logoUrl: null, requireGps: true }));
    if (force) brandingP.then((b) => window.dispatchEvent(new CustomEvent('branding-changed', { detail: b })));
  }
  return brandingP;
};
export function useBranding() {
  const [b, setB] = useState<Branding>({ companyName: 'PT L1V', logoUrl: null, requireGps: true });
  useEffect(() => {
    loadBranding().then(setB);
    const on = (e: Event) => setB((e as CustomEvent<Branding>).detail);
    window.addEventListener('branding-changed', on);
    return () => window.removeEventListener('branding-changed', on);
  }, []);
  return b;
}

/* ── GPS ── */
export interface Fix { lat: number; lng: number; accuracy: number }
export function getFix(timeoutMs = 15_000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return reject(new Error('Perangkat tidak mendukung GPS'));
    if (!window.isSecureContext) return reject(new Error('GPS hanya aktif di HTTPS. Buka aplikasi lewat alamat https:// (mode Caddy), atau minta Admin menonaktifkan kewajiban GPS untuk pengujian.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1 ? 'Izin lokasi ditolak — izinkan lokasi untuk situs ini di browser' : 'Lokasi tidak tersedia — pastikan GPS aktif dan coba lagi')),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

async function toBitmap(src: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try { return await createImageBitmap(src, { imageOrientation: 'from-image' }); } catch { /* fallback */ }
  const url = URL.createObjectURL(src);
  try {
    return await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Gambar tidak dapat dibaca')); i.src = url; });
  } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
}

/** Tempel banner (logo PT, nama PT, label WO, koordinat GPS, waktu) langsung ke piksel foto lalu simpan sebagai JPEG. */
export async function stampPhoto(file: File, o: { company: string; logoUrl?: string | null; fix?: Fix | null; label?: string }): Promise<Blob> {
  const img = await toBitmap(file);
  const iw = 'naturalWidth' in img ? img.naturalWidth : img.width, ih = 'naturalHeight' in img ? img.naturalHeight : img.height;
  const k = Math.min(1, 1600 / Math.max(iw, ih));
  const W = Math.round(iw * k), H = Math.round(ih * k);
  const fs = Math.max(13, Math.round(W / 40)), pad = Math.round(fs * 0.7), bh = Math.round(fs * 4.9);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0, W, H);
  g.fillStyle = 'rgba(0,0,0,.62)';
  g.fillRect(0, H - bh, W, bh);

  let x = pad;
  if (o.logoUrl) {
    try {
      const blob = await (await fetch(fileUrl(o.logoUrl))).blob();
      const logo = await toBitmap(blob);
      const lw = 'naturalWidth' in logo ? logo.naturalWidth : logo.width, lh = 'naturalHeight' in logo ? logo.naturalHeight : logo.height;
      const s = Math.min((bh - pad * 2) / lh, (bh * 1.6) / lw);
      g.fillStyle = 'rgba(255,255,255,.92)';
      g.fillRect(x - 4, H - bh + pad - 4, lw * s + 8, lh * s + 8);
      g.drawImage(logo, x, H - bh + pad, lw * s, lh * s);
      x += lw * s + pad + 8;
    } catch { /* logo gagal dimuat → lanjut tanpa logo */ }
  }
  g.fillStyle = '#fff';
  g.textBaseline = 'top';
  const lines: [string, string, string][] = [
    [`bold ${fs}px sans-serif`, '#ffffff', o.company],
    [`${Math.round(fs * 0.85)}px sans-serif`, '#e2e8f0', o.label ?? ''],
    [`${Math.round(fs * 0.85)}px sans-serif`, o.fix ? '#86efac' : '#fca5a5', o.fix ? `GPS ${o.fix.lat.toFixed(6)}, ${o.fix.lng.toFixed(6)}  (±${Math.round(o.fix.accuracy)} m)` : 'GPS tidak tersedia'],
    [`${Math.round(fs * 0.8)}px sans-serif`, '#cbd5e1', new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'medium' })],
  ];
  let y = H - bh + pad * 0.9;
  for (const [font, color, text] of lines) {
    if (!text) continue;
    g.font = font; g.fillStyle = color;
    g.fillText(text, x, y, W - x - pad);
    y += fs * 1.1;
  }
  if ('close' in img) img.close();
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Gagal memproses foto'))), 'image/jpeg', 0.85));
}

/**
 * Unggah foto: ambil GPS → tempel logo/koordinat → kirim beserta metadata GPS.
 * `strict` (teknisi FOC saat kebijakan GPS aktif): gagal GPS = foto ditolak.
 */
export async function uploadPhoto(file: File, ctx: { woId?: string; label?: string; kind?: 'REPORT' | 'PROGRESS'; strict?: boolean; onStep?: (s: string) => void } = {}): Promise<string> {
  const branding = await loadBranding();
  ctx.onStep?.('Mengambil lokasi GPS…');
  let fix: Fix | null = null;
  try { fix = await getFix(); } catch (e) { if (ctx.strict && branding.requireGps) throw e; }
  ctx.onStep?.('Menempel logo & koordinat…');
  const blob = await stampPhoto(file, { company: branding.companyName, logoUrl: branding.logoUrl, fix, label: ctx.label });
  ctx.onStep?.('Mengunggah…');
  const fd = new FormData();
  fd.append('file', blob, 'foto.jpg');
  if (fix) { fd.append('lat', String(fix.lat)); fd.append('lng', String(fix.lng)); fd.append('accuracy', String(fix.accuracy)); }
  if (ctx.woId) fd.append('woId', ctx.woId);
  fd.append('kind', ctx.kind ?? 'REPORT');
  const res = await fetch(`${API}/api/uploads`, { method: 'POST', headers: { authorization: `Bearer ${getToken()}` }, body: fd });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Upload gagal');
  return json.url as string;
}
