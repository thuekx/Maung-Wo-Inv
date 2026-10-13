import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { AppError, prisma } from '../db';
import { authenticate, requireRole } from '../auth';
import { config } from '../config';
import { whoOf, writeAudit } from '../audit';
import { transact } from '../effects';
import { BACKUP_DIR, createBackup, listBackups, pruneAuto, purgeData, readMeta, restoreBackup, runSeed, safeName, tarUploads, untarUploads } from '../backup';
import { crmDemoCounts, crmReconSummary, purgeCrmDemo } from '../demo-purge';

/** Admin → Data & Backup: backup, restore, purge, data demo. Hanya Admin ASLI (bukan yang sedang "bertindak sebagai"). */
export const dataRoutes = Router();
dataRoutes.use('/admin/data', authenticate, requireRole('ADMIN'), (req, _res, next) => { if (req.realUser) throw new AppError(403, 'Berhenti "bertindak sebagai" peran lain dulu untuk memakai menu ini'); next(); });

const audit = (req: Parameters<typeof whoOf>[0], summary: string) => transact(async (fx) => { await writeAudit(fx, whoOf(req), { action: 'UPDATE', entity: 'data', summary }); }).catch(() => {});

function dirStats(dir: string) {
  let files = 0, bytes = 0;
  const walk = (d: string) => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== '.cache') walk(p); } else { files++; try { bytes += fs.statSync(p).size; } catch { /* abaikan */ } } } };
  walk(dir);
  return { files, bytes };
}

dataRoutes.get('/admin/data/overview', async (_req, res) => {
  const [users, customers, wos, assets, items, warehouses, prs, subs] = await Promise.all([
    prisma.user.count(), prisma.customer.count(), prisma.workOrder.count(), prisma.asset.count(), prisma.item.count(), prisma.warehouse.count(), prisma.purchaseRequest.count(), prisma.subscription.count(),
  ]);
  let disk: { freeBytes: number; totalBytes: number } | null = null;
  try { const s = fs.statfsSync(fs.existsSync(BACKUP_DIR) ? BACKUP_DIR : '.'); disk = { freeBytes: Number(s.bavail) * Number(s.bsize), totalBytes: Number(s.blocks) * Number(s.bsize) }; } catch { /* tidak didukung */ }
  const auto = ((await prisma.setting.findUnique({ where: { key: 'backup' } }))?.value as { autoDaily?: boolean } | null)?.autoDaily !== false;
  res.json({ counts: { users, customers, workOrders: wos, assets, items, warehouses, purchaseRequests: prs, subscriptions: subs }, crmDemo: await crmDemoCounts(), crmRecon: await crmReconSummary(), uploads: dirStats(config.uploadDir), backups: await listBackups(), backupDir: BACKUP_DIR, disk, autoDaily: auto });
});

dataRoutes.put('/admin/data/auto', async (req, res) => {
  const { autoDaily } = z.object({ autoDaily: z.boolean() }).parse(req.body);
  const old = ((await prisma.setting.findUnique({ where: { key: 'backup' } }))?.value as object | null) ?? {};
  await prisma.setting.upsert({ where: { key: 'backup' }, create: { key: 'backup', value: { ...old, autoDaily } }, update: { value: { ...old, autoDaily } } });
  res.json({ autoDaily });
});

dataRoutes.post('/admin/data/backup', async (req, res) => {
  const { note } = z.object({ note: z.string().trim().max(120).optional() }).parse(req.body ?? {});
  const m = await createBackup({ kind: 'manual', note, by: req.user!.name });
  await audit(req, `Backup data dibuat: ${m.name}`);
  res.status(201).json(m);
});

dataRoutes.get('/admin/data/backups/:name/download', async (req, res) => {
  const name = String(req.params.name);
  if (!safeName(name) || !fs.existsSync(path.join(BACKUP_DIR, name))) throw new AppError(404, 'Backup tidak ditemukan');
  res.download(path.join(BACKUP_DIR, name), name);
});
dataRoutes.delete('/admin/data/backups/:name', async (req, res) => {
  const name = String(req.params.name);
  if (!safeName(name)) throw new AppError(400, 'Nama berkas tidak valid');
  fs.rmSync(path.join(BACKUP_DIR, name), { force: true });
  await audit(req, `Backup dihapus: ${name}`);
  res.json({ ok: true });
});

fs.mkdirSync(BACKUP_DIR, { recursive: true });
const up = multer({ storage: multer.diskStorage({ destination: BACKUP_DIR, filename: (_r, f, cb) => cb(null, `maung-upload-${Date.now()}-${f.originalname.replace(/[^A-Za-z0-9._-]/g, '_').replace(/\.json\.gz$/i, '')}.json.gz`) }), limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 1 } });
dataRoutes.post('/admin/data/backups/upload', up.single('file'), async (req, res) => {
  if (!req.file) throw new AppError(400, 'Pilih berkas backup (.json.gz)');
  const m = await readMeta(req.file.filename);
  if (!m?.valid) { fs.rmSync(req.file.path, { force: true }); throw new AppError(400, m?.error ?? 'Berkas bukan backup Maung yang valid'); }
  await audit(req, `Backup diunggah: ${req.file.filename}`);
  res.status(201).json(m);
});

dataRoutes.post('/admin/data/backups/:name/restore', async (req, res) => {
  const name = String(req.params.name);
  const b = z.object({ includeSettings: z.boolean().default(false), confirm: z.string() }).parse(req.body);
  if (b.confirm !== 'RESTORE') throw new AppError(400, 'Ketik RESTORE untuk konfirmasi');
  if (!safeName(name)) throw new AppError(400, 'Nama berkas tidak valid');
  try {
    const r = await restoreBackup(name, { includeSettings: b.includeSettings, keepAdminEmail: req.user!.email, by: req.user!.name });
    await audit(req, `Restore dari ${name}: ${r.rows} baris, ${r.tables} tabel`);
    res.json(r);
  } catch (e) { throw new AppError(400, `Restore gagal (data tidak diubah): ${(e as Error).message}`); }
});

dataRoutes.post('/admin/data/purge', async (req, res) => {
  const b = z.object({ scope: z.union([z.literal(1), z.literal(2), z.literal(3)]), deleteUsers: z.boolean().default(false), deleteFiles: z.boolean().default(true), reseed: z.boolean().default(false), backupFirst: z.boolean().default(true), confirm: z.string() }).parse(req.body);
  if (b.confirm !== 'HAPUS DATA') throw new AppError(400, 'Ketik HAPUS DATA untuk konfirmasi');
  let pre: string | null = null;
  if (b.backupFirst) pre = (await createBackup({ kind: 'pre-purge', note: `sebelum purge cakupan ${b.scope}`, by: req.user!.name })).name;
  try {
    const r = await purgeData({ scope: b.scope, deleteUsers: b.deleteUsers, deleteFiles: b.deleteFiles, keepAdminEmail: req.user!.email });
    await prisma.setting.deleteMany({ where: { key: 'demoSeed' } });
    let seeded: { ok: boolean; output: string } | null = null;
    if (b.reseed && b.scope === 3) seeded = await runSeed('seed', { SEED_USERS: '0' });
    await audit(req, `Purge data cakupan ${b.scope}${b.deleteUsers ? ' + akun non-admin' : ''}${pre ? ` (backup: ${pre})` : ''}`);
    res.json({ ...r, backup: pre, seeded });
  } catch (e) { throw new AppError(400, `Purge gagal (data tidak diubah): ${(e as Error).message}`); }
});

/** Hapus TERARAH data uji sambung CRM (order/pelanggan/PR/penawaran bertanda demo); data sungguhan tidak disentuh. */
dataRoutes.post('/admin/data/purge-crm-demo', async (req, res) => {
  const b = z.object({ backupFirst: z.boolean().default(true), confirm: z.string() }).parse(req.body);
  if (b.confirm !== 'HAPUS UJI SAMBUNG') throw new AppError(400, 'Ketik HAPUS UJI SAMBUNG untuk konfirmasi');
  let pre: string | null = null;
  if (b.backupFirst) pre = (await createBackup({ kind: 'pre-purge', note: 'sebelum hapus data uji sambung CRM', by: req.user!.name })).name;
  try {
    const r = await purgeCrmDemo();
    await audit(req, `Hapus data uji sambung CRM: ${r.quotations} penawaran, ${r.orders} order, ${r.customers} pelanggan, ${r.purchaseRequests} PR${pre ? ` (backup: ${pre})` : ''}`);
    res.json({ ...r, backup: pre });
  } catch (e) { throw new AppError(400, `Gagal (data tidak diubah): ${(e as Error).message}`); }
});

/** Muat data demo (akun & data uji). Akun yang sudah ada — termasuk Admin Anda — tidak diubah. */
dataRoutes.post('/admin/data/demo', async (req, res) => {
  const { confirm } = z.object({ confirm: z.string() }).parse(req.body);
  if (confirm !== 'MUAT DEMO') throw new AppError(400, 'Ketik MUAT DEMO untuk konfirmasi');
  const pre = await createBackup({ kind: 'pre-restore', note: 'sebelum memuat data demo', by: req.user!.name });
  await prisma.setting.deleteMany({ where: { key: 'demoSeed' } }); // penanda "demo sudah dibuat" — Admin sengaja memuat ulang
  const a = await runSeed('seed');
  if (!a.ok) throw new AppError(500, `Seed master gagal: ${a.output.slice(-300)}`);
  const b = await runSeed('seed-demo');
  if (!b.ok) throw new AppError(500, `Seed demo gagal: ${b.output.slice(-300)}`);
  await audit(req, 'Data demo dimuat');
  res.json({ ok: true, backup: pre.name, log: b.output.slice(-800) });
});

/* ── foto / berkas unggahan ── */
dataRoutes.get('/admin/data/uploads.tar.gz', async (_req, res) => {
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="maung-foto-${new Date().toISOString().slice(0, 10)}.tar.gz"`);
  const p = tarUploads();
  p.stdout!.pipe(res);
  p.on('error', () => res.destroy());
});
const upTar = multer({ storage: multer.diskStorage({ destination: BACKUP_DIR, filename: (_r, _f, cb) => cb(null, `upload-foto-${Date.now()}.tar.gz.tmp`) }), limits: { fileSize: 8 * 1024 * 1024 * 1024, files: 1 } });
dataRoutes.post('/admin/data/uploads/restore', upTar.single('file'), async (req, res) => {
  if (!req.file) throw new AppError(400, 'Pilih berkas foto (.tar.gz)');
  try { const n = await untarUploads(req.file.path); await audit(req, `Foto dipulihkan: ${n} berkas`); res.json({ files: n }); }
  catch (e) { throw new AppError(400, (e as Error).message); }
  finally { fs.rmSync(req.file.path, { force: true }); }
});

export { pruneAuto };
