import { Router } from 'express';
import { z } from 'zod';
import { AppError, fieldError, prisma } from '../db';
import { authenticate, requireRole } from '../auth';
import { cronQueue } from '../queue';
import { getRadius, pullOne, radiusGet, RADIUS_DEFAULT_URL, saveRadius, syncRunning, testRadius } from '../radius';
import { whoOf, writeAudit } from '../audit';
import { transact } from '../effects';

/** Integrasi MSRadius (baca-saja): pengaturan token (Admin), uji koneksi, sinkron manual (MKT/Admin), tarik satu pelanggan. */
export const radiusRoutes = Router();
radiusRoutes.use(authenticate);

const view = async () => {
  const cfg = await getRadius();
  const runs = await prisma.syncRun.findMany({ orderBy: { startedAt: 'desc' }, take: 10 });
  return { baseUrl: cfg.baseUrl, defaultUrl: RADIUS_DEFAULT_URL, tokenSet: !!cfg.token, tokenHint: cfg.token ? `••••${cfg.token.slice(-4)}` : '', enabled: cfg.enabled, autoForm: cfg.autoForm, intervalMin: cfg.intervalMin, running: await syncRunning(), runs };
};

radiusRoutes.get('/admin/radius', requireRole('ADMIN'), async (_req, res) => res.json(await view()));

radiusRoutes.put('/admin/radius', requireRole('ADMIN'), async (req, res) => {
  const b = z.object({
    baseUrl: z.string().trim().url('URL tidak valid').max(200).regex(/^https?:\/\//, 'Harus diawali http:// atau https://'),
    token: z.string().trim().max(500).optional(),
    enabled: z.boolean(),
    intervalMin: z.coerce.number().int().min(5, 'Minimal 5 menit').max(1440, 'Maksimal 1440 menit'),
    autoForm: z.boolean().optional(),
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
  res.json({ configured: !!cfg.token, enabled: cfg.enabled, autoForm: cfg.autoForm, intervalMin: cfg.intervalMin, running: await syncRunning(), last });
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


/**
 * Katalog endpoint MSRadius (dari dokumen "Authentication API") + sampel nyata 1 item untuk dianalisis Admin.
 * Hanya GET; sampel diambil dari server (token tidak pernah dikirim ke browser) dan dibatasi satu panggilan per klik (batas MSRadius 10/menit).
 */
const CATALOG = [
  { key: 'users', path: 'masterdata/users/list', title: 'Daftar user (reseller / partner / mitra)', params: [], usedBy: 'Uji koneksi', note: 'data = { id_user: nama }' },
  { key: 'nas', path: 'masterdata/nas/list', title: 'Daftar NAS / router', params: [], usedBy: '— (belum dipakai)', note: 'data = { ip_router: nama NAS }' },
  { key: 'area', path: 'masterdata/area/list', title: 'Daftar area', params: [], usedBy: 'Master Area (sinkron)', note: 'data = { id_area: nama }' },
  { key: 'voucher-profile', path: 'datavoucher/profile', title: 'Profil voucher (hotspot / evoucher)', params: [], usedBy: '— (di luar lingkup)', note: 'Voucher hotspot' },
  { key: 'voucher-report', path: 'datavoucher/report', title: 'Laporan penjualan voucher', params: ['date_start', 'date_end'], usedBy: '— (di luar lingkup)', note: 'Rentang maks. 7 hari; contoh memakai 3 hari terakhir' },
  { key: 'billing-profile', path: 'databilling/profile', title: 'Profil / paket billing', params: [], usedBy: 'Master Paket (sinkron)', note: 'Harga modal & komisi tidak disimpan' },
  { key: 'billing-report', path: 'databilling/report', title: 'Transaksi billing per periode', params: ['date_start', 'date_end'], usedBy: '— (data keuangan, belum dipakai)', note: 'Rentang maks. 7 hari; contoh memakai 3 hari terakhir' },
  { key: 'billing-data', path: 'databilling/data', title: 'Data pelanggan billing', params: [], usedBy: 'Pelanggan (sinkron)', note: 'Semua pelanggan dalam satu panggilan (tanpa paginasi); sampel hanya 1 item' },
] as const;

radiusRoutes.get('/admin/radius/endpoints', requireRole('ADMIN'), async (_req, res) => {
  const cfg = await getRadius();
  res.json({ baseUrl: cfg.baseUrl, tokenSet: !!cfg.token, endpoints: CATALOG });
});

radiusRoutes.post('/admin/radius/endpoints/:key/sample', requireRole('ADMIN'), async (req, res) => {
  const ep = CATALOG.find((e) => e.key === String(req.params.key));
  if (!ep) throw new AppError(404, 'Endpoint tidak dikenal');
  const cfg = await getRadius();
  const day = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
  const params = ep.params.length ? { date_start: day(3), date_end: day(1) } : undefined;
  try {
    const r = await radiusGet<any>(cfg, ep.path, params);
    const d = r.data;
    const first = Array.isArray(d) ? d[0] : d && typeof d === 'object' ? (() => { const k = Object.keys(d)[0]; return k === undefined ? undefined : { [k]: d[k] }; })() : d;
    const size = Array.isArray(d) ? d.length : d && typeof d === 'object' ? Object.keys(d).length : 0;
    res.json({ path: ep.path, params: params ?? null, count: r.count ?? size, shape: Array.isArray(d) ? 'daftar (array)' : 'objek (kunci → nilai)', sample: first ?? null });
  } catch (e) { throw new AppError(502, (e as Error).message); }
});
