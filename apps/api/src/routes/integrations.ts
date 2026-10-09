import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { AppError, prisma } from '../db';
import { config } from '../config';
import { connection } from '../queue';
import { transact } from '../effects';
import { createWorkOrder, systemActor } from '../engine';
import { sendTelegram } from '../senders';
import { getAppName, getBranding, getTelegram } from '../settings';

export const integrationRoutes = Router();

const safeEq = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Pintu masuk dari aplikasi Billing/Finance eksisting.
 * Header: x-api-key. Body: { event: 'suspend'|'unsuspend'|'terminate', customerCode, reason?, invoiceRef? }
 * Idempoten: jika sudah ada WO terbuka yang sama, dijawab 200 {duplicate:true}.
 */
integrationRoutes.post('/integrations/billing/events', async (req, res) => {
  const key = String(req.headers['x-api-key'] ?? '');
  if (!safeEq(key, config.billing.apiKey)) throw new AppError(401, 'API key tidak valid');
  const b = z.object({ event: z.enum(['suspend', 'unsuspend', 'terminate']), customerCode: z.string().min(1), reason: z.string().optional(), invoiceRef: z.string().optional() }).parse(req.body);

  const customer = await prisma.customer.findUnique({ where: { code: b.customerCode } });
  if (!customer) throw new AppError(404, `Pelanggan ${b.customerCode} tidak ditemukan`);

  const map = {
    suspend: { type: 'SUSPEND', reason: 'Tunggakan pembayaran' },
    unsuspend: { type: 'UNSUSPEND', reason: undefined },
    terminate: { type: 'TERMINATE', reason: 'Bad debt (tunggakan kronis)' },
  } as const;
  const m = map[b.event];

  try {
    const wo = await transact(async (fx) =>
      createWorkOrder(fx, {
        type: m.type,
        actor: await systemActor(fx.tx),
        system: true,
        source: 'BILLING',
        input: { customerId: customer.id, reason: m.reason, note: b.reason ?? 'Dikirim otomatis oleh sistem billing', ref: b.invoiceRef },
      }),
    );
    res.status(201).json({ duplicate: false, ...wo });
  } catch (e) {
    if (e instanceof AppError && e.status === 409) return void res.json({ duplicate: true, message: e.message });
    throw e;
  }
});

// Billing dapat polling status layanan pelanggan
integrationRoutes.get('/integrations/billing/customers/:code', async (req, res) => {
  if (!safeEq(String(req.headers['x-api-key'] ?? ''), config.billing.apiKey)) throw new AppError(401, 'API key tidak valid');
  const c = await prisma.customer.findUnique({ where: { code: String(req.params.code) }, select: { code: true, name: true, status: true, activatedAt: true, packageName: true } });
  if (!c) throw new AppError(404, 'Pelanggan tidak ditemukan');
  res.json(c);
});

/** Webhook bot Telegram: user mengirim "/link KODE" (kode dibuat dari halaman Profil). */
/** Info publik untuk halaman login & watermark foto (nama PT, logo, kebijakan GPS). */
integrationRoutes.get('/branding', async (_req, res) => res.json(await getBranding()));

integrationRoutes.post('/telegram/webhook/:secret', async (req, res) => {
  const { webhookSecret, botUsername } = await getTelegram();
  if (!webhookSecret || !safeEq(String(req.params.secret), webhookSecret)) throw new AppError(404, 'Not found');
  const msg = req.body?.message;
  const text: string = msg?.text ?? '';
  const chatId = msg?.chat?.id ? String(msg.chat.id) : undefined;
  if (chatId && text.startsWith('/link')) {
    const code = text.split(/\s+/)[1]?.toUpperCase();
    const userId = code ? await connection.get(`tg:${code}`) : null;
    if (userId) {
      await prisma.user.update({ where: { id: userId }, data: { telegramChatId: chatId } });
      await connection.del(`tg:${code}`);
      await sendTelegram(chatId, `✅ Akun ${await getAppName()} berhasil terhubung. Notifikasi WO akan dikirim ke chat ini.`).catch(() => {});
    } else {
      await sendTelegram(chatId, '❌ Kode tidak valid / kedaluwarsa. Buat kode baru di halaman Profil.').catch(() => {});
    }
  } else if (chatId && text.startsWith('/id')) {
    // berguna untuk grup divisi: kirim /id di grup, salin angkanya ke Admin → Pengaturan → Telegram
    await sendTelegram(chatId, `Chat ID: ${chatId}`).catch(() => {});
  } else if (chatId && text.startsWith('/start')) {
    await sendTelegram(chatId, `Selamat datang di ${await getAppName()} Bot${botUsername ? ` (@${botUsername})` : ''}.\nHubungkan akun: buka halaman Profil di aplikasi, buat kode, lalu kirim: /link KODE\nPerintah lain: /id (tampilkan chat id)\n(chat id ini: ${chatId})`).catch(() => {});
  }
  res.json({ ok: true });
});
