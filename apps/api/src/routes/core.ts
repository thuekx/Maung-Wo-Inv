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

export const core = Router();

/* ── auth ── */
core.post(
  '/auth/login',
  rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }),
  async (req, res) => {
    const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const u = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!u || !u.active || !(await bcrypt.compare(password, u.passwordHash))) throw new AppError(401, 'Email atau password salah');
    res.json({ token: signToken(u), user: publicUser(u) });
  },
);

core.use(authenticate);

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
  const q = req.query.q ? String(req.query.q) : '';
  const status = req.query.status ? String(req.query.status).split(',') : undefined;
  const rows = await prisma.customer.findMany({
    where: {
      ...(status ? { status: { in: status as any } } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }, { ip: { contains: q } }] } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json(rows);
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
  const user = req.user!;
  const open = await prisma.workOrder.findMany({
    where: { closedAt: null },
    select: { id: true, number: true, type: true, status: true, title: true, assigneeId: true, createdAt: true, scheduledAt: true },
    orderBy: { createdAt: 'asc' },
    take: 1000,
  });
  const withMeta = open.map((w) => ({ ...w, statusLabel: workflows[w.type].statuses[w.status]?.label ?? w.status, owner: workflows[w.type].statuses[w.status]?.owner }));
  const mine = withMeta.filter((w) => (user.role === 'ADMIN' ? true : w.owner === user.role && (w.owner !== 'FOC' || !w.assigneeId || w.assigneeId === user.id)));
  const byType: Record<string, number> = {};
  for (const w of open) byType[w.type] = (byType[w.type] ?? 0) + 1;

  // stok: HABIS (0), MENIPIS (< minimum), AMAN — gudang non-mobile
  const items = await prisma.item.findMany({ where: { minStock: { gt: 0 } }, orderBy: { name: 'asc' } });
  const stock = [];
  for (const it of items) {
    const total = it.tracked
      ? await prisma.asset.count({ where: { itemId: it.id, status: { in: ['IN_STOCK', 'REFURBISHED'] }, warehouse: { kind: { not: 'MOBILE' } } } })
      : ((await prisma.stockLevel.aggregate({ _sum: { qty: true }, where: { itemId: it.id, warehouse: { kind: { not: 'MOBILE' } } } }))._sum.qty ?? 0);
    stock.push({ id: it.id, name: it.name, unit: it.unit, total, minStock: it.minStock, level: total <= 0 ? 'OUT' : total < it.minStock ? 'LOW' : 'OK' });
  }
  const lowStock = stock.filter((s) => s.level !== 'OK').sort((a, b) => a.total / a.minStock - b.total / b.minStock);
  const stockSummary = { out: stock.filter((s) => s.level === 'OUT').length, low: stock.filter((s) => s.level === 'LOW').length, ok: stock.filter((s) => s.level === 'OK').length };

  // progres WO 30 hari terakhir: selesai (closed non-batal) vs belum
  const DAY = 86400_000;
  const since = new Date(Date.now() - 30 * DAY);
  const recent = await prisma.workOrder.findMany({
    where: { OR: [{ createdAt: { gte: since } }, { closedAt: { gte: since } }] },
    select: { type: true, status: true, createdAt: true, closedAt: true },
  });
  const isDone = (w: { status: string; closedAt: Date | null }) => !!w.closedAt && w.status !== 'CANCELLED' && w.status !== 'REJECTED';
  const created30 = recent.filter((w) => w.createdAt >= since);
  const progress = {
    created: created30.length,
    done: created30.filter(isDone).length,
    cancelled: created30.filter((w) => !!w.closedAt && !isDone(w)).length,
    open: created30.filter((w) => !w.closedAt).length,
    pct: created30.length ? Math.round((created30.filter(isDone).length / created30.length) * 100) : 0,
  };
  const byTypeProgress: Record<string, { open: number; done: number }> = {};
  for (const t of Object.keys(workflows)) byTypeProgress[t] = { open: 0, done: 0 };
  for (const w of created30) byTypeProgress[w.type][w.closedAt ? 'done' : 'open']++;
  for (const w of open.filter((x) => x.createdAt < since)) byTypeProgress[w.type].open++;
  const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const trend = Array.from({ length: 14 }, (_, i) => {
    const day = dayKey(new Date(Date.now() - (13 - i) * DAY));
    return { day, created: recent.filter((w) => dayKey(w.createdAt) === day).length, done: recent.filter((w) => w.closedAt && isDone(w) && dayKey(w.closedAt) === day).length };
  });
  const overdue7 = withMeta.filter((w) => Date.now() - w.createdAt.getTime() > 7 * DAY);
  const byOwner: Record<string, number> = {};
  for (const w of overdue7) if (w.owner) byOwner[w.owner] = (byOwner[w.owner] ?? 0) + 1;
  const overdue = { total: overdue7.length, byOwner, items: overdue7.slice(0, 8).map((w) => ({ id: w.id, number: w.number, type: w.type, title: w.title, statusLabel: w.statusLabel, owner: w.owner, ageDays: Math.floor((Date.now() - w.createdAt.getTime()) / DAY) })) };

  const maintenanceDue = await prisma.asset.findMany({
    where: { item: { category: 'GA' }, nextMaintenanceAt: { lte: new Date(Date.now() + 14 * 86400_000) } },
    include: { item: true },
    orderBy: { nextMaintenanceAt: 'asc' },
    take: 20,
  });
  const pendingQc = await prisma.asset.count({ where: { status: 'RETURNED_PENDING_QC' } });
  const customers = await prisma.customer.groupBy({ by: ['status'], _count: true });
  res.json({ mine: mine.slice(0, 50), mineTotal: mine.length, openTotal: open.length, byType, byTypeProgress, progress, trend, overdue, lowStock, stockSummary, maintenanceDue, pendingQc, customers });
});

/* ── log (admin) ── */
core.get('/admin/notifications', requireRole('ADMIN'), async (_req, res) => {
  res.json(await prisma.notification.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }));
});
core.get('/admin/outbound', requireRole('ADMIN'), async (_req, res) => {
  res.json(await prisma.outboundEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }));
});
