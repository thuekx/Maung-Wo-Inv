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
export interface SmtpCfg { host: string; port: number; secure: boolean; user: string; pass: string; from: string; source: 'db' | 'env' | 'none' }
export async function getSmtp(): Promise<SmtpCfg> {
  const s = await getSetting<any>('smtp');
  if (s?.host) return { host: s.host, port: Number(s.port ?? 587), secure: !!s.secure, user: s.user ?? '', pass: decryptSecret(s.pass), from: s.from || config.smtp.from, source: 'db' };
  if (config.smtp.host) return { host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465, user: config.smtp.user ?? '', pass: config.smtp.pass ?? '', from: config.smtp.from, source: 'env' };
  return { host: '', port: 587, secure: false, user: '', pass: '', from: config.smtp.from, source: 'none' };
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
export async function getBranding() {
  const b = (await getSetting<any>('branding')) ?? {};
  const a = (await getSetting<any>('app')) ?? {};
  return { companyName: (b.companyName as string) || 'PT L1V', logoUrl: (b.logoUrl as string) || null, requireGps: a.requireGps !== false };
}
