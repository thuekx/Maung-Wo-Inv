import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { AppError, prisma } from '../db';
import { requireRole } from '../auth';
import { config } from '../config';
import { encryptSecret, getAppName, getBranding, getSetting, getSmtp, getTelegram, putSetting } from '../settings';
import { fromHeader, sendTelegram, telegramApi } from '../senders';

/** Pengaturan yang dikelola Admin: SMTP, Telegram, logo/branding, kebijakan GPS. Dipasang SETELAH authenticate. */
export const adminRoutes = Router();
adminRoutes.use('/admin/settings', requireRole('ADMIN'));

const ROLES = ['ADMIN', 'MKT', 'NOC', 'FOC', 'GA', 'FIN'] as const;
const hint = (s: string) => (s ? `••••${s.slice(-4)}` : '');

async function overview() {
  const [smtp, tg, branding] = await Promise.all([getSmtp(), getTelegram(), getBranding()]);
  return {
    smtp: { host: smtp.host, port: smtp.port, secure: smtp.secure, user: smtp.user, from: smtp.from, enabled: smtp.enabled, hasPass: !!smtp.pass, source: smtp.source },
    telegram: { hasToken: !!tg.token, tokenHint: hint(tg.token), botUsername: tg.botUsername, roleChats: tg.roleChats, hasWebhookSecret: !!tg.webhookSecret, source: tg.source },
    branding,
    webUrl: config.webUrl,
  };
}

adminRoutes.get('/admin/settings', async (_req, res) => res.json(await overview()));

/* ── SMTP ── */
adminRoutes.put('/admin/settings/smtp', async (req, res) => {
  const b = z
    .object({ host: z.string().trim(), port: z.coerce.number().int().min(1).max(65535).default(587), secure: z.boolean().default(false), user: z.string().trim().default(''), pass: z.string().optional(), from: z.string().trim().default(''), enabled: z.boolean().optional() })
    .parse(req.body);
  const old = (await getSetting<any>('smtp')) ?? {};
  // host kosong = hapus pengaturan DB (kembali ke .env / dry-run)
  if (!b.host) await putSetting('smtp', {}, req.user!.id);
  else await putSetting('smtp', { host: b.host, port: b.port, secure: b.secure, user: b.user, from: b.from, enabled: b.enabled ?? old.enabled !== false, pass: b.pass === undefined ? old.pass : b.pass ? encryptSecret(b.pass) : '' }, req.user!.id);
  res.json(await overview());
});

/** Sakelar cepat: matikan/nyalakan pengiriman email tanpa mengubah pengaturan SMTP lain. */
adminRoutes.put('/admin/settings/smtp/enabled', async (req, res) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
  const old = (await getSetting<any>('smtp')) ?? {};
  if (!old.host) throw new AppError(400, 'SMTP belum diatur (isi host dulu)');
  await putSetting('smtp', { ...old, enabled }, req.user!.id);
  res.json(await overview());
});

adminRoutes.post('/admin/settings/smtp/test', async (req, res) => {
  const { to } = z.object({ to: z.string().email() }).parse(req.body);
  const c = await getSmtp();
  if (!c.host) throw new AppError(400, 'SMTP belum diatur (host kosong)');
  const t = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure || c.port === 465, auth: c.user ? { user: c.user, pass: c.pass } : undefined, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000 });
  try {
    await t.verify();
    const app = await getAppName();
    await t.sendMail({ from: fromHeader(c.from, app), to, subject: `Tes email ${app}`, text: `Email uji dari ${app}.\nDikirim ${new Date().toLocaleString('id-ID')} oleh ${req.user!.name}.\nJika Anda menerima ini, pengaturan SMTP sudah benar.` });
  } catch (e) {
    throw new AppError(400, `Gagal: ${(e as Error).message}`);
  }
  res.json({ ok: true });
});

/* ── Telegram ── */
adminRoutes.put('/admin/settings/telegram', async (req, res) => {
  const b = z.object({ token: z.string().trim().optional(), roleChats: z.record(z.string().trim()).default({}) }).parse(req.body);
  const old = (await getSetting<any>('telegram')) ?? {};
  const roleChats: Record<string, string> = {};
  for (const r of ROLES) if (b.roleChats[r]) roleChats[r] = b.roleChats[r];
  const token = b.token === undefined ? old.token : b.token ? encryptSecret(b.token) : '';
  await putSetting('telegram', { ...old, token, roleChats, botUsername: b.token ? '' : old.botUsername }, req.user!.id);
  res.json(await overview());
});

adminRoutes.post('/admin/settings/telegram/check', async (req, res) => {
  const tg = await getTelegram();
  if (!tg.token) throw new AppError(400, 'Token bot belum diisi');
  try {
    const me = await telegramApi<{ username: string; first_name: string }>(tg.token, 'getMe');
    const info = await telegramApi<{ url: string; pending_update_count: number; last_error_message?: string }>(tg.token, 'getWebhookInfo');
    const old = (await getSetting<any>('telegram')) ?? {};
    await putSetting('telegram', { ...old, botUsername: me.username }, req.user!.id);
    res.json({ ok: true, bot: { username: me.username, name: me.first_name }, webhook: { url: info.url ? info.url.replace(/\/webhook\/.*/, '/webhook/•••') : '', pending: info.pending_update_count, lastError: info.last_error_message ?? null } });
  } catch (e) {
    throw new AppError(400, `Token tidak valid / Telegram tidak terjangkau: ${(e as Error).message}`);
  }
});

adminRoutes.post('/admin/settings/telegram/webhook', async (req, res) => {
  const { baseUrl } = z.object({ baseUrl: z.string().url() }).parse(req.body);
  if (!baseUrl.startsWith('https://')) throw new AppError(400, 'Telegram mewajibkan HTTPS publik untuk webhook (pakai mode Caddy/domain)');
  const tg = await getTelegram();
  if (!tg.token) throw new AppError(400, 'Token bot belum diisi');
  const old = (await getSetting<any>('telegram')) ?? {};
  const secret = tg.webhookSecret || crypto.randomBytes(16).toString('hex');
  await putSetting('telegram', { ...old, webhookSecret: secret }, req.user!.id);
  try {
    await telegramApi(tg.token, 'setWebhook', { url: `${baseUrl.replace(/\/$/, '')}/api/telegram/webhook/${secret}`, allowed_updates: ['message'] });
  } catch (e) {
    throw new AppError(400, `Gagal set webhook: ${(e as Error).message}`);
  }
  res.json({ ok: true });
});

adminRoutes.post('/admin/settings/telegram/delete-webhook', async (_req, res) => {
  const tg = await getTelegram();
  if (!tg.token) throw new AppError(400, 'Token bot belum diisi');
  await telegramApi(tg.token, 'deleteWebhook').catch((e) => { throw new AppError(400, (e as Error).message); });
  res.json({ ok: true });
});

adminRoutes.post('/admin/settings/telegram/test', async (req, res) => {
  const { chatId } = z.object({ chatId: z.string().min(1) }).parse(req.body);
  const tg = await getTelegram();
  if (!tg.token) throw new AppError(400, 'Token bot belum diisi');
  try {
    await sendTelegram(chatId, `✅ Tes ${await getAppName()} — pesan ini dikirim oleh ${req.user!.name}. Notifikasi akan masuk ke chat ini.`);
  } catch (e) {
    throw new AppError(400, `Gagal kirim: ${(e as Error).message}`);
  }
  res.json({ ok: true });
});

/* ── Branding / logo ── */
fs.mkdirSync(config.uploadDir, { recursive: true });
const VARIANTS = { horizontal: { key: 'logoUrl', max: 2 }, stacked: { key: 'logoStackedUrl', max: 2 }, mark: { key: 'logoMarkUrl', max: 1 }, loginbg: { key: 'loginBgUrl', max: 6 }, gps: { key: 'gpsLogoUrl', max: 2 }, kop: { key: 'kopUrl', max: 3 }, formlogo: { key: 'formLogoUrl', max: 2 }, mgrsign: { key: 'mgrSignUrl', max: 1 } } as const;
const brandUpload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (req, file, cb) => cb(null, `brand-${String(req.query.variant ?? 'horizontal')}-${Date.now()}${path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')}`),
  }),
  limits: { fileSize: 6 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});
/**
 * Hapus file brand yang tidak lagi dipakai: semua Attachment berjenis LOGO yang URL-nya bukan salah satu logo/latar aktif,
 * beserta file di storage. Dipanggil setelah unggah/ganti/hapus, jadi sisa file lama (juga dari versi sebelumnya) ikut terbereskan.
 */
async function sweepBrandFiles() {
  const b = (await getSetting<any>('branding')) ?? {};
  const live = new Set([b.logoUrl, b.logoStackedUrl, b.logoMarkUrl, b.loginBgUrl, b.gpsLogoUrl, b.kopUrl, b.formLogoUrl, b.mgrSignUrl].filter(Boolean) as string[]);
  const stale = await prisma.attachment.findMany({ where: { kind: 'LOGO', url: { notIn: [...live] } }, select: { id: true, url: true } });
  for (const a of stale) {
    const file = path.join(config.uploadDir, path.basename(a.url)); // basename: cegah path traversal
    await fs.promises.unlink(file).catch((e) => { if (e?.code !== 'ENOENT') console.error('hapus file brand gagal:', file, e); });
  }
  if (stale.length) await prisma.attachment.deleteMany({ where: { id: { in: stale.map((a) => a.id) } } });
  return stale.length;
}

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Warna harus berformat #RRGGBB');

adminRoutes.put('/admin/settings/branding', async (req, res) => {
  const b = z
    .object({
      companyName: z.string().trim().min(2).max(80),
      tagline: z.string().trim().max(120),
      subtitle: z.string().trim().max(160),
      loginText: z.string().max(400),
      appName: z.string().trim().min(2).max(60),
      colors: z.object({ primary: hex, accent: hex, charts: z.array(hex).length(6) }),
    })
    .partial()
    .parse(req.body);
  const old = (await getSetting<any>('branding')) ?? {};
  await putSetting('branding', { ...old, ...b }, req.user!.id);
  res.json(await overview());
});

/** Kembalikan semua teks & warna ke bawaan panduan brand (logo tidak dihapus). */
adminRoutes.post('/admin/settings/branding/reset', async (req, res) => {
  const old = (await getSetting<any>('branding')) ?? {};
  await putSetting('branding', { logoUrl: old.logoUrl, logoStackedUrl: old.logoStackedUrl, logoMarkUrl: old.logoMarkUrl, loginBgUrl: old.loginBgUrl, gpsLogoUrl: old.gpsLogoUrl, kopUrl: old.kopUrl, formLogoUrl: old.formLogoUrl, mgrSignUrl: old.mgrSignUrl }, req.user!.id);
  res.json(await overview());
});

adminRoutes.post('/admin/settings/branding/logo', brandUpload.single('file'), async (req, res) => {
  const variant = z.enum(['horizontal', 'stacked', 'mark', 'loginbg', 'gps', 'kop', 'formlogo', 'mgrsign']).default('horizontal').parse(req.query.variant);
  const v = VARIANTS[variant];
  if (!req.file) throw new AppError(400, 'File harus PNG/JPG/WEBP');
  if (req.file.size > v.max * 1024 * 1024) { fs.unlink(req.file.path, () => {}); throw new AppError(400, `Maksimal ${v.max} MB`); }
  const url = `/uploads/${req.file.filename}`;
  const old = (await getSetting<any>('branding')) ?? {};
  await putSetting('branding', { ...old, [v.key]: url }, req.user!.id);
  await prisma.attachment.create({ data: { url, mime: req.file.mimetype, uploadedBy: req.user!.id, kind: 'LOGO' } });
  await sweepBrandFiles(); // file lama varian yang sama ikut dihapus
  res.status(201).json(await overview());
});

adminRoutes.delete('/admin/settings/branding/logo', async (req, res) => {
  const variant = z.enum(['horizontal', 'stacked', 'mark', 'loginbg', 'gps', 'kop', 'formlogo', 'mgrsign']).default('horizontal').parse(req.query.variant);
  const old = (await getSetting<any>('branding')) ?? {};
  await putSetting('branding', { ...old, [VARIANTS[variant].key]: null }, req.user!.id);
  await sweepBrandFiles();
  res.json(await overview());
});

/* ── Kebijakan aplikasi ── */
adminRoutes.put('/admin/settings/app', async (req, res) => {
  const { requireGps } = z.object({ requireGps: z.boolean() }).parse(req.body);
  const old = (await getSetting<any>('app')) ?? {};
  await putSetting('app', { ...old, requireGps }, req.user!.id);
  res.json(await overview());
});
