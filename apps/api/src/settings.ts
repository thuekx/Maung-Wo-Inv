import crypto from 'crypto';
import { prisma } from './db';
import { config } from './config';

/**
 * Pengaturan yang dikelola Admin dari UI, disimpan di tabel Setting.
 * Nilai di DB menimpa environment (.env) bila ada; kosong → pakai .env.
 * Rahasia (password SMTP, token bot) disimpan terenkripsi AES-256-GCM (kunci diturunkan dari JWT_SECRET).
 * Catatan: mengganti JWT_SECRET membuat rahasia tersimpan tidak terbaca — isi ulang dari menu Admin → Pengaturan.
 */

const key = () => crypto.createHash('sha256').update(`l1v-settings:${config.jwtSecret}`).digest();

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `enc:${Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64')}`;
}

export function decryptSecret(v: string | undefined | null): string {
  if (!v) return '';
  if (!v.startsWith('enc:')) return v;
  try {
    const raw = Buffer.from(v.slice(4), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return '';
  }
}

const cache = new Map<string, { at: number; value: any }>();
const TTL = 10_000; // proses api & worker terpisah → perubahan terlihat ≤ 10 detik

export async function getSetting<T = Record<string, any>>(k: string): Promise<T | null> {
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const row = await prisma.setting.findUnique({ where: { key: k } });
  const value = (row?.value as T) ?? null;
  cache.set(k, { at: Date.now(), value });
  return value;
}

export async function putSetting(k: string, value: unknown, userId?: string) {
  await prisma.setting.upsert({ where: { key: k }, create: { key: k, value: value as any, updatedBy: userId }, update: { value: value as any, updatedBy: userId } });
  cache.delete(k);
}

/* ── SMTP ── */
export interface SmtpCfg { host: string; port: number; secure: boolean; user: string; pass: string; from: string; enabled: boolean; source: 'db' | 'env' | 'none' }
export async function getSmtp(): Promise<SmtpCfg> {
  const s = await getSetting<any>('smtp');
  if (s?.host) return { host: s.host, port: Number(s.port ?? 587), secure: !!s.secure, user: s.user ?? '', pass: decryptSecret(s.pass), from: s.from || config.smtp.from, enabled: s.enabled !== false, source: 'db' };
  if (config.smtp.host) return { host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465, user: config.smtp.user ?? '', pass: config.smtp.pass ?? '', from: config.smtp.from, enabled: true, source: 'env' };
  return { host: '', port: 587, secure: false, user: '', pass: '', from: config.smtp.from, enabled: false, source: 'none' };
}

/* ── Telegram ── */
// peran PROC sudah digabung ke GA: chat grup lama PROC dipakai bila GA belum diisi
const mergeLegacyRoles = (r: Record<string, string>) => { const { PROC, ...rest } = r; return PROC && !rest.GA ? { ...rest, GA: PROC } : rest; };
export interface TelegramCfg { token: string; webhookSecret: string; roleChats: Record<string, string>; botUsername: string; source: 'db' | 'env' | 'none' }
export async function getTelegram(): Promise<TelegramCfg> {
  const s = await getSetting<any>('telegram');
  const token = decryptSecret(s?.token) || config.telegram.token || '';
  const envSecret = config.telegram.webhookSecret !== 'change-me' ? config.telegram.webhookSecret : '';
  return {
    token,
    webhookSecret: s?.webhookSecret || envSecret,
    roleChats: mergeLegacyRoles({ ...config.telegram.roleChats, ...(s?.roleChats ?? {}) }),
    botUsername: s?.botUsername ?? '',
    source: decryptSecret(s?.token) ? 'db' : config.telegram.token ? 'env' : 'none',
  };
}

/* ── Branding & kebijakan aplikasi ── */
export const APP_NAME_DEFAULT = 'MAUNG | SuperApps';
export const BRAND_DEFAULTS = {
  companyName: 'MAUNG by LIV',
  tagline: 'Gerak Cepat, Kerja Tepat.',
  subtitle: 'Marketing • Asset • Unified Network & Governance',
  loginText: 'Satu Ekosistem.\nDampak Lebih Besar\nuntuk Jawa Barat dan Indonesia.',
  colors: { primary: '#0B1F3B', accent: '#F59E0B', charts: ['#2F5D9E', '#F59E0B', '#14B8A6', '#8B5CF6', '#F43F5E', '#0EA5E9'] },
};
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Nilai kosong/tidak valid jatuh ke bawaan panduan brand MAUNG by LIV. */
export async function getBranding() {
  const b = (await getSetting<any>('branding')) ?? {};
  const a = (await getSetting<any>('app')) ?? {};
  const c = b.colors ?? {};
  return {
    companyName: (b.companyName as string) || BRAND_DEFAULTS.companyName,
    appName: (b.appName as string) || APP_NAME_DEFAULT, // nama aplikasi di email & notifikasi
    tagline: typeof b.tagline === 'string' ? b.tagline : BRAND_DEFAULTS.tagline,
    subtitle: typeof b.subtitle === 'string' ? b.subtitle : BRAND_DEFAULTS.subtitle,
    loginText: typeof b.loginText === 'string' ? b.loginText : BRAND_DEFAULTS.loginText,
    logoUrl: (b.logoUrl as string) || null, // horizontal: untuk latar gelap (sidebar, banner foto)
    logoStackedUrl: (b.logoStackedUrl as string) || null, // tegak: untuk latar terang (kartu login)
    logoMarkUrl: (b.logoMarkUrl as string) || null, // ikon ringkas (tanpa teks): top bar
    loginBgUrl: (b.loginBgUrl as string) || null,
    formLogoUrl: (b.formLogoUrl as string) || null, // logo merek di Formulir Berlangganan (bawaan: Sunmori)
    mgrSignUrl: (b.mgrSignUrl as string) || null, // tanda tangan Manager Marketing (opsional)
    kopUrl: (b.kopUrl as string) || null, // kop surat A4 (gambar latar penuh) untuk dokumen PR/BA/laporan
    gpsLogoUrl: (b.gpsLogoUrl as string) || null, // logo perusahaan untuk banner foto GPS (terpisah dari logo aplikasi)
    colors: {
      primary: HEX.test(c.primary) ? c.primary : BRAND_DEFAULTS.colors.primary,
      accent: HEX.test(c.accent) ? c.accent : BRAND_DEFAULTS.colors.accent,
      charts: Array.isArray(c.charts) && c.charts.length === 6 && c.charts.every((x: string) => HEX.test(x)) ? c.charts : BRAND_DEFAULTS.colors.charts,
    },
    requireGps: a.requireGps !== false,
    optimizeImages: a.optimizeImages !== false, // tampilkan gambar terkompresi (rollback: matikan di Admin)
  };
}

/* ── Keamanan: batas sesi diam (menit) ── */
export async function getSessionMinutes(): Promise<number> {
  const s = (await getSetting<any>('security')) ?? {};
  const m = Number(s.sessionMinutes);
  return Number.isFinite(m) && m >= 5 && m <= 720 ? Math.round(m) : 30;
}

/* ── URL aplikasi (tautan di email/notifikasi) ──
 * Bisa diatur Admin (Admin → Tampilan); kosong → pakai WEB_URL dari .env. Disegarkan berkala agar API & worker selalu sinkron. */
let runtimeWebUrl = config.webUrl;
export const webUrl = () => runtimeWebUrl;
export async function refreshWebUrl() {
  try { runtimeWebUrl = (((await getSetting<any>('app'))?.publicUrl as string) || '').replace(/\/+$/, '') || config.webUrl; } catch { /* DB belum siap: pakai nilai lama */ }
}
export function startWebUrlSync() { void refreshWebUrl(); setInterval(() => void refreshWebUrl(), 10_000).unref(); }

/* ── Pengaturan dokumen (nomor surat, kota, PPN) ── */
export interface DocsCfg { codePrefix: string; city: string; taxPct: number; seqStart: number; minVendors: number; signRequesterTitle: string; signKnow: string; signKnowTitle: string; signApprove: string; signApproveTitle: string }
export const DOCS_DEFAULTS: DocsCfg = { codePrefix: 'L1V/PNJ-{ALIAS}', city: 'Bandung', taxPct: 11, seqStart: 1, minVendors: 2, signRequesterTitle: '', signKnow: '', signKnowTitle: '', signApprove: '', signApproveTitle: '' };
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
export async function getDocs(): Promise<DocsCfg> {
  const d = (await getSetting<any>('docs')) ?? {};
  return {
    codePrefix: typeof d.codePrefix === 'string' && d.codePrefix.trim() ? d.codePrefix.trim() : DOCS_DEFAULTS.codePrefix,
    city: typeof d.city === 'string' && d.city.trim() ? d.city.trim() : DOCS_DEFAULTS.city,
    taxPct: Number.isFinite(Number(d.taxPct)) && d.taxPct !== '' && d.taxPct != null ? Number(d.taxPct) : DOCS_DEFAULTS.taxPct,
    seqStart: Number.isInteger(Number(d.seqStart)) && Number(d.seqStart) >= 1 ? Number(d.seqStart) : DOCS_DEFAULTS.seqStart,
    minVendors: Number.isInteger(Number(d.minVendors)) && Number(d.minVendors) >= 1 ? Number(d.minVendors) : DOCS_DEFAULTS.minVendors,
    // penandatangan bawaan PR (dapat diubah GA/Procurement saat menerbitkan)
    signRequesterTitle: str(d.signRequesterTitle), signKnow: str(d.signKnow), signKnowTitle: str(d.signKnowTitle), signApprove: str(d.signApprove), signApproveTitle: str(d.signApproveTitle),
  };
}

/* ── Formulir Berlangganan (nomor registrasi, rekening, penandatangan bawaan) ── */
export interface SubFormCfg { regSeqStart: number; regPrefix: string; city: string; managerName: string; bankName: string; accName: string; accNo: string; footer: string; defaultPayment: 'CASH' | 'TRANSFER' | 'DEBIT'; ppnNote: string; /** true = Marketing boleh mengisi/mengubah nomor Reg. (masa migrasi); false = selalu otomatis */ regEditable: boolean }
export const SUBFORM_DEFAULTS: SubFormCfg = {
  regSeqStart: 1, regPrefix: 'SM', city: 'Bandung', managerName: 'M Gugi Granada',
  bankName: 'BANK BCA KCP Buahbatu BANDUNG', accName: 'Lintas Satu Visi PT', accNo: '7753555511',
  footer: 'Jl. Magenta Raya No. 26\nBandung, 40173, Indonesia, Tlp : 022-21000234\nWeb : www.sunmori.net Mail : info@liv.co.id',
  defaultPayment: 'TRANSFER', ppnNote: 'Include PPN 11%', regEditable: true,
};
export async function getSubForm(): Promise<SubFormCfg> {
  const d = (await getSetting<any>('subform')) ?? {};
  const out: any = { ...SUBFORM_DEFAULTS };
  for (const k of Object.keys(SUBFORM_DEFAULTS) as (keyof SubFormCfg)[]) if (k !== 'regEditable' && typeof d[k] === 'string' && d[k].trim()) out[k] = d[k].trim();
  out.regSeqStart = Number.isInteger(Number(d.regSeqStart)) && Number(d.regSeqStart) >= 1 ? Number(d.regSeqStart) : 1;
  if (!['CASH', 'TRANSFER', 'DEBIT'].includes(out.defaultPayment)) out.defaultPayment = 'TRANSFER';
  out.regEditable = d.regEditable === undefined ? true : d.regEditable === true;
  return out as SubFormCfg;
}
/** Awalan nomor registrasi: awalan + 3 digit tahun (2026 → 026, 2027 → 027). */
export const regYear3 = (d: Date) => String(d.getFullYear() % 1000).padStart(3, '0');

/* ── Order Jasa/Produk (SERVICE_ORDER): template Berita Acara & garansi — dapat diubah Admin ── */
export interface ServiceOrderCfg { baTitle: string; baIntro: string; warrantyText: string; baFooter: string }
export const SERVICE_ORDER_DEFAULTS: ServiceOrderCfg = {
  baTitle: 'Berita Acara Serah Terima Pekerjaan / Barang',
  baIntro: 'Yth. {nama},\n\nPekerjaan/pengadaan sesuai penawaran {penawaran} telah selesai dilaksanakan dan diserahterimakan.',
  warrantyText: 'Garansi barang mengikuti ketentuan pabrikan/distributor selama 12 (dua belas) bulan sejak tanggal serah terima, tidak berlaku untuk kerusakan akibat kelalaian pengguna, bencana alam, atau perubahan oleh pihak lain. Garansi jasa pemasangan 30 (tiga puluh) hari.',
  baFooter: 'Dokumen ini sah sebagai bukti serah terima. Terima kasih atas kepercayaan Anda.',
};
export async function getServiceOrderCfg(): Promise<ServiceOrderCfg> {
  const d = (await getSetting<any>('serviceorder')) ?? {};
  const out: any = { ...SERVICE_ORDER_DEFAULTS };
  for (const k of Object.keys(SERVICE_ORDER_DEFAULTS) as (keyof ServiceOrderCfg)[]) if (typeof d[k] === 'string' && d[k].trim()) out[k] = d[k].trim();
  return out as ServiceOrderCfg;
}

/** Nama aplikasi untuk email/notifikasi (Admin → Tampilan & brand → Nama aplikasi). */
export const getAppName = async () => (((await getSetting<any>('branding')) ?? {}).appName as string) || APP_NAME_DEFAULT;

/* ── WhatsApp (gateway pihak ketiga; berbayar per pesan → ada sakelar ON/OFF) ── */
export interface WhatsappCfg { enabled: boolean; provider: 'fonnte' | 'custom' | 'kanca'; baseUrl: string; token: string; headerName: string; bodyTemplate: string; source: 'db' | 'none'; /** Kanca: slug workspace, UUID template notifikasi, UUID channel (opsional), jumlah variabel template (1 = ringkasan, 2 = judul + isi) */ workspaceId: string; templateId: string; channelId: string; varMode: '1' | '2'; webhookSecret: string }
export const WA_FONNTE_URL = 'https://api.fonnte.com';
export const WA_KANCA_URL = 'https://kanca.space'; // sesuai URL yang tampil di dashboard Kanca (Integrasi → Inbound URL); dokumen API menyebut api.kanca.space
export const WA_CUSTOM_BODY = '{"to":{{to}},"message":{{message}}}';
export async function getWhatsapp(): Promise<WhatsappCfg> {
  const s = (await getSetting<any>('whatsapp')) ?? {};
  const provider: WhatsappCfg['provider'] = s.provider === 'custom' ? 'custom' : s.provider === 'kanca' ? 'kanca' : 'fonnte';
  return {
    enabled: s.enabled === true, // bawaan MATI: ada biaya per pesan
    provider,
    baseUrl: (typeof s.baseUrl === 'string' && s.baseUrl.trim() ? s.baseUrl.trim() : provider === 'fonnte' ? WA_FONNTE_URL : provider === 'kanca' ? WA_KANCA_URL : '').replace(/\/+$/, ''),
    token: decryptSecret(s.token),
    headerName: typeof s.headerName === 'string' && s.headerName.trim() ? s.headerName.trim() : 'Authorization',
    bodyTemplate: typeof s.bodyTemplate === 'string' && s.bodyTemplate.trim() ? s.bodyTemplate : WA_CUSTOM_BODY,
    workspaceId: typeof s.workspaceId === 'string' ? s.workspaceId.trim() : '',
    templateId: typeof s.templateId === 'string' ? s.templateId.trim() : '',
    channelId: typeof s.channelId === 'string' ? s.channelId.trim() : '',
    varMode: s.varMode === '2' ? '2' : '1',
    webhookSecret: decryptSecret(s.webhookSecret),
    source: s.token ? 'db' : 'none',
  };
}

/* ── Informasi aset publik (halaman yang dibuka saat label QR dipindai) ── */
export interface AssetInfoCfg { intro: string; footer: string; contacts: { email: string; whatsapp: string; telegram: string; facebook: string; instagram: string } }
export const ASSET_INFO_DEFAULTS: AssetInfoCfg = {
  intro: '{KODE} adalah {BARANG}{MERK} milik {PERUSAHAAN}{LOKASI}.',
  footer: 'Menemukan aset ini di tempat yang tidak semestinya? Hubungi bagian GA {PERUSAHAAN}.',
  contacts: { email: '', whatsapp: '', telegram: '', facebook: '', instagram: '' },
};
export async function getAssetInfo(): Promise<AssetInfoCfg> {
  const d = (await getSetting<any>('assetInfo')) ?? {};
  const c = d.contacts ?? {};
  const t = (v: unknown, def: string) => (typeof v === 'string' ? v.trim() : def);
  return {
    intro: t(d.intro, ASSET_INFO_DEFAULTS.intro) || ASSET_INFO_DEFAULTS.intro,
    footer: typeof d.footer === 'string' ? d.footer.trim() : ASSET_INFO_DEFAULTS.footer,
    contacts: { email: t(c.email, ''), whatsapp: t(c.whatsapp, ''), telegram: t(c.telegram, ''), facebook: t(c.facebook, ''), instagram: t(c.instagram, '') },
  };
}
