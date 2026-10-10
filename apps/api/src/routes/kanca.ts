import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../db';
import { authenticate, requireRole } from '../auth';
import { getSetting, getWhatsapp, putSetting } from '../settings';
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
  const config = { provider: c.provider, active: c.provider === 'kanca', enabled: c.enabled, baseUrl: c.baseUrl, workspaceId: c.workspaceId, templateId: c.templateId, channelId: c.channelId, varMode: c.varMode, tokenSet: !!c.token, tokenHint: hint(c.token) };
  const ready = c.provider === 'kanca' && !!c.token && !!c.workspaceId;
  if (!ready) return res.json({ config, ready, catalog: CATALOG, parts: null });
  const [info, wallet, templates, messages] = await Promise.all([part(c, '/info'), part(c, '/wallet'), part(c, '/templates'), part(c, '/messages?limit=20')]);
  res.json({ config, ready, catalog: CATALOG, parts: { info, wallet, templates, messages }, fetchedAt: new Date() });
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
  const { templateId } = z.object({ templateId: z.string().trim().max(60) }).parse(req.body);
  const old = (await getSetting<any>('whatsapp')) ?? {};
  await putSetting('whatsapp', { ...old, templateId }, req.user!.id);
  res.json({ ok: true, templateId });
});
