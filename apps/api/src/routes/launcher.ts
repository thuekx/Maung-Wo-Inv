import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import sharp from 'sharp';
import { z } from 'zod';
import { AppError } from '../db';
import { authenticate, requireRole } from '../auth';
import { featuresFor, type LauncherApp } from '../access';
import { getSetting, putSetting } from '../settings';
import { config } from '../config';
import { whoOf, writeAudit } from '../audit';
import { transact } from '../effects';
import { APP_ICON_KEYS } from '../appIcons';

/**
 * Beranda "satu pintu" (launcher): daftar aplikasi Maung yang boleh dibuka pengguna. Aplikasi lain berjalan di jalur satu domain
 * (mis. /crm) lewat Caddy (proxy/apps/*.caddy) dan memakai token login yang sama (docs/SUPER-APPS.md).
 * Teks beranda, tampilan ubin WO, dan ikon (bawaan atau unggahan sendiri) diatur Admin → Pengaturan → Aplikasi (Beranda).
 */
export const launcherRoutes = Router();

const ICONS = APP_ICON_KEYS;
/** Placeholder teks: {nama} = nama lengkap pengguna, {nama_depan} = kata pertama. */
export const HOME_DEFAULTS = { title: 'Selamat datang, {nama_depan}', subtitle: 'Pilih aplikasi yang ingin dibuka. Satu login berlaku untuk semuanya.', backLabel: 'Menu Utama', alwaysShow: false };
export const WO_DEFAULTS = { name: 'Work Order & Inventori', description: 'Work order, pelanggan, inventori, pengadaan', icon: 'clipboard-check', iconUrl: null as string | null };
/** Jalur milik aplikasi WO sendiri — tidak boleh dipakai aplikasi lain. */
export const RESERVED_PATHS = new Set(['api', 'uploads', 'login', 'reset-password', 'a', 'doc', 'qr-print', 'brand', '_next', 'apps', 'admin', 'work-orders', 'customers', 'inventory', 'subscriptions', 'purchase-requests', 'purchase-orders', 'master', 'my-stock', 'tim-saya', 'laporan', 'riwayat-gangguan', 'api-msradius', 'api-sistem', 'api-kanca', 'profile', 'notifications', 'health', 'favicon.ico', 'icon.svg']);

const ICON_URL = /^\/uploads\/app-icon-[a-z0-9-]+\.png$/;
type Home = typeof HOME_DEFAULTS;
type Wo = typeof WO_DEFAULTS;

async function getCfg() {
  const v = (await getSetting<{ apps?: LauncherApp[]; home?: Partial<Home>; wo?: Partial<Wo> }>('launcher')) ?? {};
  return { apps: Array.isArray(v.apps) ? v.apps : [], home: { ...HOME_DEFAULTS, ...(v.home ?? {}) } as Home, wo: { ...WO_DEFAULTS, ...(v.wo ?? {}) } as Wo };
}

launcherRoutes.get('/launcher', authenticate, async (req, res) => {
  const feats = new Set(await featuresFor(req.user!));
  const cfg = await getCfg();
  const extra = cfg.apps.filter((a) => a.enabled && feats.has(`app.${a.id}`)).map(({ id, name, description, icon, iconUrl, path: p }) => ({ id, name, description, icon, iconUrl: iconUrl ?? null, path: p }));
  res.json({ apps: [{ id: 'wo', ...cfg.wo, path: '/' }, ...extra], home: cfg.home });
});

launcherRoutes.get('/admin/launcher', authenticate, requireRole('ADMIN'), async (_req, res) => {
  const cfg = await getCfg();
  res.json({ ...cfg, reserved: [...RESERVED_PATHS].filter((p) => !p.includes('.')), defaults: { home: HOME_DEFAULTS, wo: WO_DEFAULTS } });
});

const iconField = z.enum(ICONS);
const iconUrl = z.string().regex(ICON_URL, 'Ikon sendiri tidak valid — unggah ulang').nullable().optional();
const appSchema = z.object({
  id: z.string().trim().regex(/^[a-z][a-z0-9-]{1,23}$/, 'ID: huruf kecil/angka/strip, 2–24 karakter, diawali huruf'),
  name: z.string().trim().min(2, 'Nama minimal 2 karakter').max(40),
  description: z.string().trim().max(120).default(''),
  icon: iconField,
  iconUrl,
  path: z.string().trim().regex(/^\/[a-z0-9][a-z0-9-]{0,30}$/, 'Jalur satu segmen, mis. /crm (huruf kecil/angka/strip)'),
  enabled: z.boolean(),
});
const homeSchema = z.object({
  title: z.string().trim().min(1, 'Judul wajib diisi').max(80),
  subtitle: z.string().trim().max(200),
  backLabel: z.string().trim().min(2).max(24),
  alwaysShow: z.boolean(),
});
const woSchema = z.object({ name: z.string().trim().min(2).max(40), description: z.string().trim().max(120), icon: iconField, iconUrl });

launcherRoutes.put('/admin/launcher', authenticate, requireRole('ADMIN'), async (req, res) => {
  const b = z.object({ apps: z.array(appSchema).max(30), home: homeSchema.optional(), wo: woSchema.optional() }).parse(req.body);
  const ids = new Set<string>(), paths = new Set<string>();
  for (const a of b.apps) {
    if (a.id === 'wo') throw new AppError(400, "ID 'wo' dipakai aplikasi bawaan", { id: "ID 'wo' dipakai aplikasi bawaan" });
    if (RESERVED_PATHS.has(a.path.slice(1))) throw new AppError(400, `Jalur ${a.path} dipakai halaman WO`, { path: `Jalur ${a.path} dipakai halaman WO` });
    if (ids.has(a.id)) throw new AppError(400, `ID ganda: ${a.id}`, { id: `ID ganda: ${a.id}` });
    if (paths.has(a.path)) throw new AppError(400, `Jalur ganda: ${a.path}`, { path: `Jalur ganda: ${a.path}` });
    ids.add(a.id); paths.add(a.path);
  }
  const old = await getCfg();
  const next = { apps: b.apps as LauncherApp[], home: b.home ?? old.home, wo: b.wo ?? old.wo };
  await putSetting('launcher', next, req.user!.id);
  cleanupIcons(next);
  await transact(async (fx) => { await writeAudit(fx, whoOf(req), { action: 'UPDATE', entity: 'aplikasi beranda', summary: `${whoOf(req).name} memperbarui beranda: ${[`WO "${next.wo.name}"`, ...next.apps.map((a) => `${a.name} ${a.path}${a.enabled ? '' : ' (nonaktif)'}`)].join(', ')}`.slice(0, 500) }); });
  res.json({ ...next });
});

/* ── ikon sendiri: PNG/JPEG/WebP → dinormalkan ke PNG 192 px (SVG sengaja ditolak: bisa memuat skrip bila dibuka langsung) ── */
const iconUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});
launcherRoutes.post('/admin/launcher/icon', authenticate, requireRole('ADMIN'), iconUpload.single('file'), async (req, res) => {
  if (!req.file) throw new AppError(400, 'Berkas harus gambar PNG, JPEG, atau WebP (maks. 2 MB)');
  let png: Buffer;
  try {
    png = await sharp(req.file.buffer, { failOn: 'error' }).rotate().resize(192, 192, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  } catch { throw new AppError(400, 'Gambar tidak dapat dibaca'); }
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const name = `app-icon-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`;
  fs.writeFileSync(path.join(config.uploadDir, name), png);
  res.status(201).json({ url: `/uploads/${name}` });
});

/** Hapus ikon unggahan yang tidak dipakai lagi (dan sudah lewat 10 menit, agar unggahan yang belum disimpan tidak ikut terhapus). */
function cleanupIcons(cfg: { apps: LauncherApp[]; wo: { iconUrl?: string | null } }) {
  try {
    const used = new Set([cfg.wo.iconUrl, ...cfg.apps.map((a) => a.iconUrl)].filter(Boolean).map((u) => path.basename(String(u))));
    for (const f of fs.readdirSync(config.uploadDir)) {
      if (!/^app-icon-[a-z0-9-]+\.png$/.test(f) || used.has(f)) continue;
      const p = path.join(config.uploadDir, f);
      if (Date.now() - fs.statSync(p).mtimeMs > 10 * 60_000) fs.unlinkSync(p);
    }
  } catch { /* pembersihan opsional */ }
}
