import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../db';
import { authenticate, requireRole } from '../auth';
import crypto from 'crypto';
import { prisma } from '../db';
import { decryptSecret, encryptSecret, getSetting, getWhatsapp, putSetting, webUrl } from '../settings';
import { ingestKancaEvent, syncKancaDelivery, verifyKancaSignature } from '../kanca';
import { kancaCall } from '../senders';

/** Halaman "API Kanca" (khusus Admin, hanya baca): ringkasan akun Kanca — workspace, channel, saldo, template, riwayat pesan. */
export const kancaRoutes = Router();
kancaRoutes.use('/admin/kanca', authenticate, requireRole('ADMIN'));

/** Katalog endpoint Kanca (dari dokumentasi resmi) — `safe` = boleh dipanggil dari halaman ini (tidak mengirim pesan / tidak berbiaya). */
const CATALOG = [
  { method: 'GET', path: '/info', title: 'Info workspace & channel', safe: true, note: 'Workspace + daftar channel (waba/fb/ig) yang terhubung.' },
  { method: 'GET', path: '/wallet', title: 'Saldo wallet', safe: true, note: 'balanceIdr = saldo Rupiah; ledger wallet adalah sumber kebenaran tagihan.' },
  { method: 'GET', path: '/templates', title: 'Daftar template WABA', safe: true, note: 'Pakai field id (UUID) sebagai templateId. Hanya wabaStatus=APPROVED yang boleh dikirim di luar jendela 24 jam.' },
  { method: 'GET', path: '/templates/{templateId}', title: 'Detail template', safe: true, note: 'Detail satu template (UUID).' },
  { method: 'GET', path: '/messages?limit=50', title: 'Pesan terkirim terbaru', safe: true, note: 'Isi + nomor + status + deliveryStatus (sent/delivered/read/failed). Param: limit (maks 50), since (ISO), status, phone, ids (maks 100 messageId).' },
  { method: 'GET', path: '/broadcasts/{broadcastId|name}', title: 'Status satu broadcast', safe: true, note: 'Total/terkirim/gagal/pending + penerima. Segmen boleh broadcastId (UUID) atau name. Param: status, phone, limit (maks 1000), offset.' },
  { method: 'GET', path: '/broadcasts?ids=a,b,c', title: 'Status banyak broadcast', safe: true, note: 'Maks 100 token (UUID atau name). notFound berisi token yang tidak cocok.' },
  { method: 'POST', path: '/broadcasts', title: 'Kirim template / broadcast', safe: false, note: 'BERBIAYA. Body: name, templateId, recipients[{phoneNumber, variables{"1":…}}], opsional channelId, scheduledAt, headerMediaUrl, bodyText. Langsung antri. Batas 60 broadcast/jam. Header Idempotency-Key opsional (jendela 5 menit).' },
  { method: 'POST', path: '/send', title: 'Kirim teks bebas', safe: false, note: 'BERBIAYA. Body: channel (waba), to, text, opsional channelId. Hanya dalam jendela 24 jam sejak pesan terakhir pelanggan.' },
] as const;

const hint = (k: string) => (k ? `••••${k.slice(-4)}` : '');
type Part = { ok: boolean; httpStatus?: number; data?: unknown; error?: string };
async function part(c: Awaited<ReturnType<typeof getWhatsapp>>, path: string): Promise<Part> {
  try {
    const r = await kancaCall(c, 'GET', path);
    if (r.status >= 300) return { ok: false, httpStatus: r.status, error: `${r.json?.error?.code ?? 'ERROR'}: ${r.json?.error?.message ?? (typeof r.json === 'string' ? r.json : '')}` };
    return { ok: true, httpStatus: r.status, data: r.json };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

kancaRoutes.get('/admin/kanca/overview', async (_req, res) => {
  const c = await getWhatsapp();
  const config = { webhookSecretSet: !!c.webhookSecret, provider: c.provider, active: c.provider === 'kanca', enabled: c.enabled, baseUrl: c.baseUrl, workspaceId: c.workspaceId, templateId: c.templateId, channelId: c.channelId, varMode: c.varMode, tokenSet: !!c.token, tokenHint: hint(c.token) };
  const ready = c.provider === 'kanca' && !!c.token && !!c.workspaceId;
  const registry = await prisma.waTemplate.findMany({ orderBy: { name: 'asc' } });
  const events = await prisma.kancaEvent.findMany({ orderBy: { receivedAt: 'desc' }, take: 30, select: { id: true, event: true, receivedAt: true, payload: true } });
  const webhook = { url: `${webUrl()}/api/integrations/kanca/webhook`, secretSet: !!c.webhookSecret, total: await prisma.kancaEvent.count(), events };
  if (!ready) return res.json({ config, ready, catalog: CATALOG, parts: null, registry, webhook });
  const [info, wallet, templates, messages] = await Promise.all([part(c, '/info'), part(c, '/wallet'), part(c, '/templates'), part(c, '/messages?limit=20')]);
  res.json({ config, ready, catalog: CATALOG, parts: { info, wallet, templates, messages }, registry, webhook, fetchedAt: new Date() });
});

/** Status satu broadcast / pesan (hanya baca) — pencarian by broadcastId atau name. */
kancaRoutes.get('/admin/kanca/broadcast/:id', async (req, res) => {
  const c = await getWhatsapp();
  if (c.provider !== 'kanca' || !c.token) throw new AppError(400, 'Penyedia WhatsApp belum diatur ke Kanca');
  const q = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
  const p = await part(c, `/broadcasts/${encodeURIComponent(String(req.params.id))}?limit=${q.limit}`);
  if (!p.ok) throw new AppError(p.httpStatus === 404 ? 404 : 502, p.error ?? 'Gagal');
  res.json(p.data);
});

/** Pilih template notifikasi dari daftar template Kanca (hanya mengubah templateId). */
kancaRoutes.put('/admin/kanca/template', async (req, res) => {
  const { templateId, varMode } = z.object({ templateId: z.string().trim().max(60), varMode: z.enum(['1', '2']).optional() }).parse(req.body);
  const old = (await getSetting<any>('whatsapp')) ?? {};
  await putSetting('whatsapp', { ...old, templateId, ...(varMode ? { varMode } : {}) }, req.user!.id);
  res.json({ ok: true, templateId });
});

/* ── Pencatatan template WhatsApp (registry) ── */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tplBody = z.object({
  templateId: z.string().trim().regex(UUID, 'templateId harus berupa UUID (salin dari tombol copy di dashboard Kanca → Templates)'),
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().max(30).optional().nullable(),
  status: z.string().trim().max(30).optional().nullable(),
  body: z.string().trim().max(1500).optional().nullable(),
  varCount: z.coerce.number().int().min(0).max(10).default(1),
  purpose: z.string().trim().max(200).optional().nullable(),
});
kancaRoutes.post('/admin/kanca/templates', async (req, res) => {
  const b = tplBody.parse(req.body);
  if (await prisma.waTemplate.findUnique({ where: { templateId: b.templateId.toLowerCase() } })) throw new AppError(409, 'Template dengan UUID ini sudah tercatat');
  res.status(201).json(await prisma.waTemplate.create({ data: { ...b, templateId: b.templateId.toLowerCase(), source: 'manual' } }));
});
kancaRoutes.patch('/admin/kanca/templates/:id', async (req, res) => {
  const b = tplBody.partial().parse(req.body);
  res.json(await prisma.waTemplate.update({ where: { id: String(req.params.id) }, data: { ...b, ...(b.templateId ? { templateId: b.templateId.toLowerCase() } : {}) } }));
});
kancaRoutes.delete('/admin/kanca/templates/:id', async (req, res) => {
  await prisma.waTemplate.delete({ where: { id: String(req.params.id) } });
  res.json({ ok: true });
});
/** Sinkron daftar template dari Kanca (GET /templates) ke pencatatan; baris manual yang UUID-nya cocok ikut diperbarui. */
kancaRoutes.post('/admin/kanca/templates/sync', async (_req, res) => {
  const c = await getWhatsapp();
  const p = await part(c, '/templates');
  if (!p.ok) throw new AppError(502, `Kanca tidak mengizinkan membaca template (${p.error ?? 'galat'}). Catat template secara manual dengan UUID dari tombol copy di dashboard Kanca.`);
  const list = Array.isArray(p.data) ? p.data : Array.isArray((p.data as any)?.data) ? (p.data as any).data : Array.isArray((p.data as any)?.templates) ? (p.data as any).templates : [];
  let n = 0;
  for (const t of list as any[]) {
    const id = String(t?.id ?? '').toLowerCase();
    if (!UUID.test(id)) continue;
    const body = t.body ?? t.bodyText ?? t.content ?? t.components?.find?.((x: any) => x.type === 'BODY')?.text ?? null;
    const varCount = body ? new Set([...String(body).matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => m[1])).size : 1;
    const data = { name: String(t.name ?? id), category: t.category ?? null, status: t.wabaStatus ?? t.status ?? null, body: body ? String(body) : null, ...(body ? { varCount } : {}) };
    await prisma.waTemplate.upsert({ where: { templateId: id }, update: data, create: { ...data, templateId: id, source: 'kanca' } });
    n++;
  }
  res.json({ synced: n });
});

/* ── Webhook Kanca → Maung ── */
/** Admin membuat/mengganti secret HMAC webhook. Secret hanya ditampilkan SEKALI di respons ini. */
kancaRoutes.post('/admin/kanca/webhook-secret', async (req, res) => {
  const secret = crypto.randomBytes(24).toString('hex');
  const old = (await getSetting<any>('whatsapp')) ?? {};
  await putSetting('whatsapp', { ...old, webhookSecret: encryptSecret(secret) }, req.user!.id);
  res.json({ secret, url: `${webUrl()}/api/integrations/kanca/webhook` });
});
kancaRoutes.post('/admin/kanca/sync-delivery', async (_req, res) => res.json({ updated: await syncKancaDelivery() }));

/** Penerima webhook: daftarkan URL ini di Kanca → Integrasi → Tambah Webhook (isi secret yang sama). Selalu balas cepat 200. */
export const kancaWebhook = Router();
kancaWebhook.post('/integrations/kanca/webhook', async (req, res) => {
  const c = await getWhatsapp();
  const raw: Buffer | undefined = (req as any).rawBody;
  if (!c.webhookSecret) throw new AppError(403, 'Secret webhook belum dibuat di Admin → API Kanca');
  if (!raw || !verifyKancaSignature(c.webhookSecret, raw, String(req.headers['x-kanca-signature'] ?? ''))) throw new AppError(401, 'Tanda tangan tidak valid');
  const event = String(req.headers['x-kanca-event'] ?? req.body?.event ?? 'unknown').slice(0, 60);
  const r = await ingestKancaEvent(event, req.headers['x-kanca-delivery-id'] ? String(req.headers['x-kanca-delivery-id']) : null, req.body);
  res.json({ ok: true, ...r });
});
