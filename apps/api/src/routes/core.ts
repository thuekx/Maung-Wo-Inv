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
  res.json({ code, expiresInSec: 600, command: `/link ${code}` });
});

core.post('/auth/change-password', async (req, res) => {
  const { current, next } = z.object({ current: z.string(), next: z.string().min(8) }).parse(req.body);
  if (!(await bcrypt.compare(current, req.user!.passwordHash))) throw new AppError(400, 'Password lama salah');
  await prisma.user.update({ where: { id: req.user!.id }, data: { passwordHash: await bcrypt.hash(next, 10) } });
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
  role: z.enum(['ADMIN', 'MKT', 'NOC', 'FOC', 'PROC', 'GA', 'FIN']),
  password: z.string().min(8),
  telegramChatId: z.string().optional().nullable(),
});

core.get('/users', requireRole('ADMIN'), async (_req, res) => {
  res.json(await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, active: true, telegramChatId: true }, orderBy: { name: 'asc' } }));
});
core.post('/users', requireRole('ADMIN'), async (req, res) => {
  const { password, ...b } = userBody.parse(req.body);
  const u = await prisma.user.create({ data: { ...b, email: b.email.toLowerCase(), passwordHash: await bcrypt.hash(password, 10) } });
  res.status(201).json(publicUser(u));
});
core.patch('/users/:id', requireRole('ADMIN'), async (req, res) => {
  const b = userBody.partial().extend({ active: z.boolean().optional() }).parse(req.body);
  const { password, ...rest } = b;
  const u = await prisma.user.update({ where: { id: String(req.params.id) }, data: { ...rest, ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) } });
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

core.get('/customers/:id', async (req, res) => {
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

core.patch('/customers/:id', requireRole('MKT', 'NOC'), async (req, res) => {
  const b = z.object({ name: z.string().min(2), phone: z.string().min(6), email: z.string().email().nullable(), address: z.string().min(5) }).partial().parse(req.body);
  res.json(await prisma.customer.update({ where: { id: String(req.params.id) }, data: b }));
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
core.post('/uploads', upload.single('file'), async (req, res) => {
  if (!req.file) throw new AppError(400, 'File harus JPG/PNG/WEBP ≤ 8MB');
  const url = `/uploads/${req.file.filename}`;
  await prisma.attachment.create({ data: { url, mime: req.file.mimetype, uploadedBy: req.user!.id } });
  res.status(201).json({ url });
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

  const items = await prisma.item.findMany({ where: { minStock: { gt: 0 } } });
  const lowStock = [];
  for (const it of items) {
    const total = it.tracked
      ? await prisma.asset.count({ where: { itemId: it.id, status: { in: ['IN_STOCK', 'REFURBISHED'] }, warehouse: { kind: { not: 'MOBILE' } } } })
      : ((await prisma.stockLevel.aggregate({ _sum: { qty: true }, where: { itemId: it.id, warehouse: { kind: { not: 'MOBILE' } } } }))._sum.qty ?? 0);
    if (total < it.minStock) lowStock.push({ id: it.id, name: it.name, unit: it.unit, total, minStock: it.minStock });
  }
  const maintenanceDue = await prisma.asset.findMany({
    where: { item: { category: 'GA' }, nextMaintenanceAt: { lte: new Date(Date.now() + 14 * 86400_000) } },
    include: { item: true },
    orderBy: { nextMaintenanceAt: 'asc' },
    take: 20,
  });
  const pendingQc = await prisma.asset.count({ where: { status: 'RETURNED_PENDING_QC' } });
  const customers = await prisma.customer.groupBy({ by: ['status'], _count: true });
  res.json({ mine: mine.slice(0, 50), mineTotal: mine.length, openTotal: open.length, byType, lowStock, maintenanceDue, pendingQc, customers });
});

/* ── log (admin) ── */
core.get('/admin/notifications', requireRole('ADMIN'), async (_req, res) => {
  res.json(await prisma.notification.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }));
});
core.get('/admin/outbound', requireRole('ADMIN'), async (_req, res) => {
  res.json(await prisma.outboundEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }));
});
