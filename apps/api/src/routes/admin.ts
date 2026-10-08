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
import { encryptSecret, getBranding, getSetting, getSmtp, getTelegram, putSetting } from '../settings';
import { sendTelegram, telegramApi } from '../senders';

/** Pengaturan yang dikelola Admin: SMTP, Telegram, logo/branding, kebijakan GPS. Dipasang SETELAH authenticate. */
export const adminRoutes = Router();
adminRoutes.use('/admin/settings', requireRole('ADMIN'));

const ROLES = ['ADMIN', 'MKT', 'NOC', 'FOC', 'GA', 'FIN'] as const;
const hint = (s: string) => (s ? `••••${s.slice(-4)}` : '');

async function overview() {
  const [smtp, tg, branding] = await Promise.all([getSmtp(), getTelegram(), getBranding()]);
  return {
    smtp: { host: smtp.host, port: smtp.port, secure: smtp.secure, user: smtp.user, from: smtp.from, hasPass: !!smtp.pass, source: smtp.source },
    telegram: { hasToken: !!tg.token, tokenHint: hint(tg.token), botUsername: tg.botUsername, roleChats: tg.roleChats, hasWebhookSecret: !!tg.webhookSecret, source: tg.source },
    branding,
    webUrl: config.webUrl,
  };
}

adminRoutes.get('/admin/settings', async (_req, res) => res.json(await overview()));

/* ── SMTP ── */
adminRoutes.put('/admin/settings/smtp', async (req, res) => {
  const b = z
    .object({ host: z.string().trim(), port: z.coerce.number().int().min(1).max(65535).default(587), secure: z.boolean().default(false), user: z.string().trim().default(''), pass: z.string().optional(), from: z.string().trim().default('') })
    .parse(req.body);
  const old = (await getSetting<any>('smtp')) ?? {};
  // host kosong = hapus pengaturan DB (kembali ke .env / dry-run)
  if (!b.host) await putSetting('smtp', {}, req.user!.id);
  else await putSetting('smtp', { host: b.host, port: b.port, secure: b.secure, user: b.user, from: b.from, pass: b.pass === undefined ? old.pass : b.pass ? encryptSecret(b.pass) : '' }, req.user!.id);
  res.json(await overview());
});

adminRoutes.post('/admin/settings/smtp/test', async (req, res) => {
  const { to } = z.object({ to: z.string().email() }).parse(req.body);
  const c = await getSmtp();
  if (!c.host) throw new AppError(400, 'SMTP belum diatur (host kosong)');
  const t = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure || c.port === 465, auth: c.user ? { user: c.user, pass: c.pass } : undefined, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000 });
  try {
    await t.verify();
    await t.sendMail({ from: c.from, to, subject: 'Tes email L1V WO', text: `Email uji dari L1V WO.\nDikirim ${new Date().toLocaleString('id-ID')} oleh ${req.user!.name}.\nJika Anda menerima ini, pengaturan SMTP sudah benar.` });
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
    await sendTelegram(chatId, `✅ Tes L1V WO — pesan ini dikirim oleh ${req.user!.name}. Notifikasi akan masuk ke chat ini.`);
  } catch (e) {
    throw new AppError(400, `Gagal kirim: ${(e as Error).message}`);
  }
  res.json({ ok: true });
});

/* ── Branding / logo ── */
fs.mkdirSync(config.uploadDir, { recursive: true });
const logoUpload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, file, cb) => cb(null, `logo-${Date.now()}${path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});

adminRoutes.put('/admin/settings/branding', async (req, res) => {
  const { companyName } = z.object({ companyName: z.string().trim().min(2).max(80) }).parse(req.body);
  const old = (await getSetting<any>('branding')) ?? {};
  await putSetting('branding', { ...old, companyName }, req.user!.id);
  res.json(await overview());
});

adminRoutes.post('/admin/settings/branding/logo', logoUpload.single('file'), async (req, res) => {
  if (!req.file) throw new AppError(400, 'Logo harus PNG/JPG/WEBP ≤ 2MB');
  const url = `/uploads/${req.file.filename}`;
  const old = (await getSetting<any>('branding')) ?? {};
  await putSetting('branding', { ...old, logoUrl: url }, req.user!.id);
  await prisma.attachment.create({ data: { url, mime: req.file.mimetype, uploadedBy: req.user!.id, kind: 'LOGO' } });
  res.status(201).json(await overview());
});

adminRoutes.delete('/admin/settings/branding/logo', async (req, res) => {
  const old = (await getSetting<any>('branding')) ?? {};
  await putSetting('branding', { ...old, logoUrl: null }, req.user!.id);
  res.json(await overview());
});

/* ── Kebijakan aplikasi ── */
adminRoutes.put('/admin/settings/app', async (req, res) => {
  const { requireGps } = z.object({ requireGps: z.boolean() }).parse(req.body);
  const old = (await getSetting<any>('app')) ?? {};
  await putSetting('app', { ...old, requireGps }, req.user!.id);
  res.json(await overview());
});
