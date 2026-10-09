import { Router } from 'express';
import { z } from 'zod';
import { AppError, fieldError, prisma } from '../db';
import { authenticate, requireRole } from '../auth';
import { cronQueue } from '../queue';
import { getRadius, pullOne, RADIUS_DEFAULT_URL, saveRadius, syncRunning, testRadius } from '../radius';
import { whoOf, writeAudit } from '../audit';
import { transact } from '../effects';

/** Integrasi MSRadius (baca-saja): pengaturan token (Admin), uji koneksi, sinkron manual (MKT/Admin), tarik satu pelanggan. */
export const radiusRoutes = Router();
radiusRoutes.use(authenticate);

const view = async () => {
  const cfg = await getRadius();
  const runs = await prisma.syncRun.findMany({ orderBy: { startedAt: 'desc' }, take: 10 });
  return { baseUrl: cfg.baseUrl, defaultUrl: RADIUS_DEFAULT_URL, tokenSet: !!cfg.token, tokenHint: cfg.token ? `••••${cfg.token.slice(-4)}` : '', enabled: cfg.enabled, intervalMin: cfg.intervalMin, prettyName: cfg.prettyName, running: await syncRunning(), runs };
};

radiusRoutes.get('/admin/radius', requireRole('ADMIN'), async (_req, res) => res.json(await view()));

radiusRoutes.put('/admin/radius', requireRole('ADMIN'), async (req, res) => {
  const b = z.object({
    baseUrl: z.string().trim().url('URL tidak valid').max(200).regex(/^https?:\/\//, 'Harus diawali http:// atau https://'),
    token: z.string().trim().max(500).optional(),
    enabled: z.boolean(),
    intervalMin: z.coerce.number().int().min(5, 'Minimal 5 menit').max(1440, 'Maksimal 1440 menit'),
    prettyName: z.boolean(),
  }).parse(req.body);
  const who = whoOf(req);
  await saveRadius(b, req.user!.id);
  await transact(async (fx) => writeAudit(fx, who, { action: 'UPDATE', entity: 'pengaturan', summary: `${who.name} mengubah pengaturan MSRadius (otomatis ${b.enabled ? `tiap ${b.intervalMin} menit` : 'mati'}${b.token ? ', token diganti' : ''})` }));
  res.json(await view());
});

radiusRoutes.post('/admin/radius/test', requireRole('ADMIN'), async (_req, res) => {
  try { res.json(await testRadius()); } catch (e) { throw new AppError(502, (e as Error).message); }
});

/** Mulai sinkron manual (dikerjakan worker; UI memantau lewat /radius/status). */
radiusRoutes.post('/radius/sync', requireRole('MKT'), async (req, res) => {
  const cfg = await getRadius();
  if (!cfg.token) throw new AppError(400, 'Token MSRadius belum diisi — minta Admin mengisinya di Pengaturan → MSRadius');
  if (await syncRunning()) throw new AppError(409, 'Sinkron sedang berjalan');
  await cronQueue.add('radius-sync-now', { userId: req.user!.id }, { removeOnComplete: 20, removeOnFail: 20 });
  res.status(202).json({ queued: true });
});

radiusRoutes.get('/radius/status', requireRole('MKT', 'NOC', 'FIN', 'GA'), async (_req, res) => {
  const cfg = await getRadius();
  const last = await prisma.syncRun.findFirst({ orderBy: { startedAt: 'desc' } });
  res.json({ configured: !!cfg.token, enabled: cfg.enabled, intervalMin: cfg.intervalMin, running: await syncRunning(), last });
});

/** Tarik data satu pelanggan dari MSRadius berdasarkan kode (mis. pelanggan manual yang akunnya baru dibuat di MSRadius). */
radiusRoutes.post('/customers/:id/radius-pull', requireRole('MKT'), async (req, res) => {
  const c = await prisma.customer.findUnique({ where: { id: String(req.params.id) } });
  if (!c) throw new AppError(404, 'Pelanggan tidak ditemukan');
  const cfg = await getRadius();
  if (!cfg.token) throw new AppError(400, 'Token MSRadius belum diisi — minta Admin mengisinya di Pengaturan → MSRadius');
  let stats;
  try { stats = await pullOne(c.code); } catch (e) { throw new AppError(502, (e as Error).message); }
  if (!stats) throw fieldError('code', `Kode ${c.code} belum ada di MSRadius — pastikan akun sudah dibuat di MSRadius dengan kode yang sama`, 404);
  res.json({ ok: true, ...stats, customer: await prisma.customer.findUnique({ where: { id: c.id } }) });
});
