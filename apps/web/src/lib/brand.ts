'use client';
import { useEffect, useState } from 'react';
import { api, setOptimizeImages } from './api';
import { colorScale, cssVars, TINT } from './brandColors';

export interface Branding {
  companyName: string; tagline: string; subtitle: string; loginText: string;
  logoUrl: string | null; logoStackedUrl: string | null; logoMarkUrl: string | null; loginBgUrl: string | null; gpsLogoUrl: string | null; kopUrl: string | null; formLogoUrl: string | null; mgrSignUrl: string | null;
  colors: { primary: string; accent: string; charts: string[] };
  requireGps: boolean;
  optimizeImages: boolean;
}

/** Bawaan = panduan MAUNG by LIV (sama dengan server); dipakai sebelum /branding selesai dimuat. */
/** Logo bawaan (dibundel di web); dipakai selama Admin belum mengunggah logo sendiri (atau setelah "Hapus"). */
export const DEFAULT_LOGOS = { logoUrl: '/brand/logo-horizontal.webp', logoStackedUrl: '/brand/logo-stacked.webp', logoMarkUrl: '/brand/logo-mark.webp' } as const;

export const DEFAULT_BRAND: Branding = {
  companyName: 'MAUNG by LIV', tagline: 'Gerak Cepat, Kerja Tepat.', subtitle: 'Marketing • Asset • Unified Network & Governance',
  loginText: 'Satu Ekosistem.\nDampak Lebih Besar\nuntuk Jawa Barat dan Indonesia.',
  logoUrl: '/brand/logo-horizontal.webp', logoStackedUrl: '/brand/logo-stacked.webp', logoMarkUrl: '/brand/logo-mark.webp', loginBgUrl: null, gpsLogoUrl: null, kopUrl: null, formLogoUrl: null, mgrSignUrl: null,
  colors: { primary: '#0B1F3B', accent: '#F59E0B', charts: ['#2F5D9E', '#F59E0B', '#14B8A6', '#8B5CF6', '#F43F5E', '#0EA5E9'] },
  requireGps: true,
  optimizeImages: true,
};

const CACHE = 'maung_brand';

/** Pasang warna brand ke :root (Tailwind membaca variabel ini). */
export function applyBrand(b: Pick<Branding, 'colors'>) {
  const vars = cssVars(b.colors.primary, b.colors.accent);
  for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
  try { localStorage.setItem(CACHE, JSON.stringify({ p: b.colors.primary, a: b.colors.accent })); } catch { /* ignore */ }
}

/** Skrip inline di <head>: warna brand terakhir dipasang sebelum render pertama (tanpa kedip). */
export const BRAND_INIT_SCRIPT = `(function(){try{var c=JSON.parse(localStorage.getItem('${CACHE}')||'null');if(!c)return;var T=${JSON.stringify(TINT)};function rgb(h){return[1,3,5].map(function(i){return parseInt(h.slice(i,i+2),16)})}function mix(a,b,t){return a.map(function(x,i){return Math.round(x+(b[i]-x)*t)})}var s=document.documentElement.style;[['brand',c.p],['accent',c.a]].forEach(function(p){var k=p[0],b=rgb(p[1]),t=T[k];[50,100,200,300,400,500,600,700,800,900,950].forEach(function(n){var v=t.tints[n]!==undefined?mix(b,[255,255,255],t.tints[n]):t.shades[n]!==undefined?mix(b,[0,0,0],t.shades[n]):b;s.setProperty('--'+k+'-'+n,v.join(' '))})});s.setProperty('--brand-hex',c.p);s.setProperty('--accent-hex',c.a)}catch(e){}})()`;

let promise: Promise<Branding> | null = null;
let at = 0;
export const loadBranding = (force = false): Promise<Branding> => {
  if (force || !promise || Date.now() - at > 60_000) {
    at = Date.now();
    promise = api<Branding>('/branding').then((b) => ({ ...DEFAULT_BRAND, ...b, logoUrl: b.logoUrl || DEFAULT_LOGOS.logoUrl, logoStackedUrl: b.logoStackedUrl || DEFAULT_LOGOS.logoStackedUrl, logoMarkUrl: b.logoMarkUrl || DEFAULT_LOGOS.logoMarkUrl, colors: { ...DEFAULT_BRAND.colors, ...(b.colors ?? {}) } })).catch(() => DEFAULT_BRAND);
    promise.then((b) => { applyBrand(b); setOptimizeImages(b.optimizeImages !== false); if (force) window.dispatchEvent(new CustomEvent('branding-changed', { detail: b })); });
  }
  return promise;
};

export function useBranding() {
  const [b, setB] = useState<Branding>(DEFAULT_BRAND);
  useEffect(() => {
    loadBranding().then(setB);
    const on = (e: Event) => setB((e as CustomEvent<Branding>).detail);
    window.addEventListener('branding-changed', on);
    return () => window.removeEventListener('branding-changed', on);
  }, []);
  return b;
}

export { colorScale };
