import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { AppError, prisma } from '../db';
import { authenticate, publicUser, requireRole, signToken } from '../auth';
import { config } from '../config';
import { connection } from '../queue';
import { workflows } from '../workflows';
import { getBranding, getTelegram } from '../settings';
import { auditedUpdate, changes, whoOf, writeAudit } from '../audit';
import { transact } from '../effects';
import { buildDashboard } from '../dashboard';
import { countIf, pageParams, sendPage } from '../paging';

export const core = Router();

/* ── auth ── */
core.post(
  '/auth/login',
  rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }),
  async (req, res) => {
    const { email, password } = z.object({ email: z.string().trim().min(1).max(120), password: z.string().min(1) }).parse(req.body);
    // masuk dengan email lengkap ATAU username (bagian sebelum @) bila hanya satu akun yang cocok
    const id = email.toLowerCase();
    const u = id.includes('@')
      ? await prisma.user.findUnique({ where: { email: id } })
      : await (async () => { const m = await prisma.user.findMany({ where: { email: { startsWith: `${id}@` }, active: true }, take: 2 }); return m.length === 1 ? m[0] : null; })();
    if (!u || !u.active || !(await bcrypt.compare(password, u.passwordHash))) throw new AppError(401, 'Email atau password salah');
    res.json({ token: signToken(u), user: publicUser(u) });
  },
);

core.use(authenticate);

/** Pencarian global (kotak cari di header): pelanggan, WO, aset — masing-masing 5 teratas, memakai indeks trigram. */
core.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return void res.json({ customers: [], workOrders: [], assets: [] });
  const like = { contains: q, mode: 'insensitive' as const };
  const [customers, workOrders, assets] = await Promise.all([
    prisma.customer.findMany({ where: { OR: [{ name: like }, { code: like }, { phone: { contains: q } }, { ip: { contains: q } }] }, select: { id: true, code: true, name: true, status: true }, orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.workOrder.findMany({ where: { OR: [{ number: like }, { title: like }] }, select: { id: true, number: true, title: true, status: true, type: true }, orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.asset.findMany({ where: { OR: [{ serialNumber: like }, { assetCode: like }] }, select: { id: true, serialNumber: true, assetCode: true, status: true, item: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 5 }),
  ]);
  res.json({ customers, workOrders, assets });
});

core.get('/auth/me', (req, res) => res.json(publicUser(req.user!)));

core.post('/auth/telegram-code', async (req, res) => {
  const code = crypto.randomBytes(4).toString('hex').toUpperCase();
  await connection.setex(`tg:${code}`, 600, req.user!.id);
  const { botUsername } = await getTelegram();
  res.json({ code, expiresInSec: 600, command: `/link ${code}`, botUsername });
});

core.post('/auth/change-password', async (req, res) => {
  const { current, next } = z.object({ current: z.string(), next: z.string().min(8) }).parse(req.body);
  if (!(await bcrypt.compare(current, req.user!.passwordHash))) throw new AppError(400, 'Password lama salah');
  await prisma.user.update({ where: { id: req.user!.id }, data: { passwordHash: await bcrypt.hash(next, 10), mustChangePassword: false } });
  res.json({ ok: true });
});

/* ── users ── */
core.get('/users/lookup', async (req, res) => {
  const role = req.query.role ? String(req.query.role) : undefined;
  const users = await prisma.user.findMany({
    where: { active: true, email: { not: 'system@l1v.local' }, ...(role ? { role: role as any } : {}) },
    select: { id: true, name: true, role: true },
    orderBy: { name: 'asc' },
  });
  res.json(users);
});

const userBody = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  role: z.enum(['ADMIN', 'MKT', 'NOC', 'FOC', 'GA', 'FIN']),
  password: z.string().min(8),
  telegramChatId: z.string().optional().nullable(),
});

core.get('/users', requireRole('ADMIN'), async (_req, res) => {
  res.json(await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, active: true, telegramChatId: true, mustChangePassword: true }, orderBy: { name: 'asc' } }));
});
core.post('/users', requireRole('ADMIN'), async (req, res) => {
  const { password, ...b } = userBody.parse(req.body);
  const who = whoOf(req);
  const hash = await bcrypt.hash(password, 10);
  const u = await transact(async (fx) => {
    const row = await fx.tx.user.create({ data: { ...b, email: b.email.toLowerCase(), passwordHash: hash } });
    await writeAudit(fx, who, { action: 'CREATE', entity: 'user', entityId: row.id, summary: `${who.name} membuat user ${row.email} (${row.role})` });
    return row;
  });
  res.status(201).json(publicUser(u));
});
core.patch('/users/:id', requireRole('ADMIN'), async (req, res) => {
  const id = String(req.params.id);
  const b = userBody.partial().extend({ active: z.boolean().optional() }).parse(req.body);
  const { password, ...rest } = b;
  const cur = await prisma.user.findUnique({ where: { id } });
  if (!cur) throw new AppError(404, 'User tidak ditemukan');
  if (id === req.user!.id && (rest.active === false || (rest.role && rest.role !== cur.role))) throw new AppError(400, 'Tidak bisa menonaktifkan / mengubah peran akun sendiri');
  const data = { ...rest, ...(rest.email ? { email: rest.email.toLowerCase() } : {}) };
  const ch = changes(cur, data);
  const u = await auditedUpdate(whoOf(req), 'user', id, cur.email, ch, async (fx) =>
    fx.tx.user.update({ where: { id }, data: { ...data, ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) } }),
  );
  res.json(publicUser(u));
});

/* ── customers ── */
core.get('/customers', async (req, res) => {
  const q = req.query.q ? String(req.query.q).trim() : '';
  const status = req.query.status ? String(req.query.status).split(',') : undefined;
  const packageName = req.query.packageName ? String(req.query.packageName) : undefined;
  const pp = pageParams(req, {
    sorts: { code: (d) => ({ code: d }), name: (d) => ({ name: d }), phone: (d) => ({ phone: d }), packageName: (d) => ({ packageName: d }), status: (d) => ({ status: d }), ip: (d) => ({ ip: d }), createdAt: (d) => ({ createdAt: d }) },
    defaultSort: { key: 'createdAt', dir: 'desc' },
    legacyLimit: 100,
  });
  const where = {
    ...(status ? { status: { in: status as any } } : {}),
    ...(packageName ? { packageName } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { code: { contains: q, mode: 'insensitive' as const } }, { phone: { contains: q } }, { ip: { contains: q } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.customer.findMany({ where, orderBy: pp.orderBy, skip: pp.skip, take: pp.take }),
    countIf(pp, () => prisma.customer.count({ where })),
  ]);
  sendPage(res, pp, rows, total);
});

core.get('/customers/:id', async (req, res, next) => {
  if (!/^[a-z0-9]{20,32}$/.test(String(req.params.id))) return next(); // mis. /customers/export.xlsx ditangani router lain
  const c = await prisma.customer.findUnique({
    where: { id: String(req.params.id) },
    include: {
      warehouse: true,
      assets: { include: { item: true } },
      workOrders: { orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, number: true, type: true, status: true, title: true, createdAt: true } },
    },
  });
  if (!c) throw new AppError(404, 'Pelanggan tidak ditemukan');
  res.json(c);
});

/* ── upload foto (laporan lapangan) ── */
fs.mkdirSync(config.uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});
// angka opsional dari multipart: string kosong dianggap tidak ada
const optNum = (min: number, max: number) => z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().min(min).max(max).optional());
const uploadMeta = z.object({ lat: optNum(-90, 90), lng: optNum(-180, 180), accuracy: optNum(0, 100000), woId: z.string().optional(), kind: z.enum(['REPORT', 'PROGRESS']).default('REPORT') });

core.post('/uploads', upload.single('file'), async (req, res) => {
  if (!req.file) throw new AppError(400, 'File harus JPG/PNG/WEBP ≤ 8MB');
  const m = uploadMeta.parse(req.body ?? {});
  const u = req.user!;
  // foto teknisi wajib bertanda GPS (kebijakan dapat dimatikan Admin, mis. staging tanpa HTTPS)
  if (u.role === 'FOC' && (m.lat == null || m.lng == null) && (await getBranding()).requireGps) {
    fs.unlink(req.file.path, () => {});
    throw new AppError(400, 'Foto teknisi wajib memiliki lokasi GPS — aktifkan izin lokasi di browser (butuh HTTPS)');
  }
  const url = `/uploads/${req.file.filename}`;
  await prisma.attachment.create({ data: { url, mime: req.file.mimetype, uploadedBy: u.id, woId: m.woId, kind: m.kind, lat: m.lat, lng: m.lng, accuracy: m.accuracy, takenAt: new Date() } });
  res.status(201).json({ url, lat: m.lat ?? null, lng: m.lng ?? null });
});

/* ── dashboard ── */
core.get('/dashboard', async (req, res) => {
  res.json(await buildDashboard(req.user!));
});

/* ── log (admin) ── */
core.get('/admin/notifications', requireRole('ADMIN'), async (req, res) => {
  const q = req.query.q ? String(req.query.q).trim() : '';
  const status = req.query.status ? String(req.query.status) : undefined;
  const pp = pageParams(req, { sorts: { createdAt: (d) => ({ createdAt: d }), status: (d) => ({ status: d }), channel: (d) => ({ channel: d }) }, defaultSort: { key: 'createdAt', dir: 'desc' }, legacyLimit: 100 });
  const where = { ...(status ? { status } : {}), ...(q ? { OR: [{ subject: { contains: q, mode: 'insensitive' as const } }, { target: { contains: q, mode: 'insensitive' as const } }] } : {}) };
  const [rows, total] = await Promise.all([prisma.notification.findMany({ where, orderBy: pp.orderBy, skip: pp.skip, take: pp.take }), countIf(pp, () => prisma.notification.count({ where }))]);
  sendPage(res, pp, rows, total);
});
core.get('/admin/outbound', requireRole('ADMIN'), async (_req, res) => {
  res.json(await prisma.outboundEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }));
});
