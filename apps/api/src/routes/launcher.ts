import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../db';
import { authenticate, requireRole } from '../auth';
import { featuresFor, getLauncherApps, type LauncherApp } from '../access';
import { putSetting } from '../settings';
import { whoOf, writeAudit } from '../audit';
import { transact } from '../effects';

/**
 * Beranda "satu pintu" (launcher): daftar aplikasi Maung yang boleh dibuka pengguna. Aplikasi lain berjalan di jalur satu domain
 * (mis. /crm) lewat Caddy (proxy/apps/*.caddy) dan memakai token login yang sama (docs/SUPER-APPS.md).
 */
export const launcherRoutes = Router();

const WO_APP = { id: 'wo', name: 'Work Order & Inventori', description: 'Work order, pelanggan, inventori, pengadaan', icon: 'clipboard', path: '/' };
const ICONS = ['users', 'clipboard', 'dashboard', 'box', 'receipt', 'layers', 'trend', 'pin', 'camera', 'qr', 'inbox', 'clock'] as const;
/** Jalur milik aplikasi WO sendiri — tidak boleh dipakai aplikasi lain. */
export const RESERVED_PATHS = new Set(['api', 'uploads', 'login', 'reset-password', 'a', 'doc', 'qr-print', 'brand', '_next', 'apps', 'admin', 'work-orders', 'customers', 'inventory', 'subscriptions', 'purchase-requests', 'purchase-orders', 'master', 'my-stock', 'tim-saya', 'laporan', 'riwayat-gangguan', 'api-msradius', 'api-sistem', 'api-kanca', 'profile', 'notifications', 'health', 'favicon.ico', 'icon.svg']);

launcherRoutes.get('/launcher', authenticate, async (req, res) => {
  const feats = new Set(await featuresFor(req.user!));
  const extra = (await getLauncherApps()).filter((a) => a.enabled && feats.has(`app.${a.id}`)).map(({ id, name, description, icon, path }) => ({ id, name, description, icon, path }));
  res.json({ apps: [WO_APP, ...extra] });
});

launcherRoutes.get('/admin/launcher', authenticate, requireRole('ADMIN'), async (_req, res) => {
  res.json({ apps: await getLauncherApps(), icons: ICONS, reserved: [...RESERVED_PATHS].filter((p) => !p.includes('.')) });
});

const appSchema = z.object({
  id: z.string().trim().regex(/^[a-z][a-z0-9-]{1,23}$/, 'ID: huruf kecil/angka/strip, 2–24 karakter, diawali huruf'),
  name: z.string().trim().min(2, 'Nama minimal 2 karakter').max(40),
  description: z.string().trim().max(120).default(''),
  icon: z.enum(ICONS),
  path: z.string().trim().regex(/^\/[a-z0-9][a-z0-9-]{0,30}$/, 'Jalur satu segmen, mis. /crm (huruf kecil/angka/strip)'),
  enabled: z.boolean(),
});

launcherRoutes.put('/admin/launcher', authenticate, requireRole('ADMIN'), async (req, res) => {
  const { apps } = z.object({ apps: z.array(appSchema).max(30) }).parse(req.body);
  const ids = new Set<string>(), paths = new Set<string>();
  for (const a of apps) {
    if (a.id === 'wo') throw new AppError(400, "ID 'wo' dipakai aplikasi bawaan", { id: "ID 'wo' dipakai aplikasi bawaan" });
    if (RESERVED_PATHS.has(a.path.slice(1))) throw new AppError(400, `Jalur ${a.path} dipakai halaman WO`, { path: `Jalur ${a.path} dipakai halaman WO` });
    if (ids.has(a.id)) throw new AppError(400, `ID ganda: ${a.id}`, { id: `ID ganda: ${a.id}` });
    if (paths.has(a.path)) throw new AppError(400, `Jalur ganda: ${a.path}`, { path: `Jalur ganda: ${a.path}` });
    ids.add(a.id); paths.add(a.path);
  }
  await putSetting('launcher', { apps: apps as LauncherApp[] }, req.user!.id);
  await transact(async (fx) => { await writeAudit(fx, whoOf(req), { action: 'UPDATE', entity: 'aplikasi beranda', summary: `${whoOf(req).name} memperbarui daftar aplikasi beranda (${apps.length}): ${apps.map((a) => `${a.name} ${a.path}${a.enabled ? '' : ' (nonaktif)'}`).join(', ')}`.slice(0, 500) }); });
  res.json({ apps });
});
