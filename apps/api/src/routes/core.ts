import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { AppError, fieldError, prisma } from '../db';
import { authenticate, publicUser, requireRole, signToken } from '../auth';
import { config } from '../config';
import { connection, requeueNotification } from '../queue';
import { workflows } from '../workflows';
import { getBranding, getSessionMinutes, getTelegram } from '../settings';
import { auditedUpdate, changes, whoOf, writeAudit } from '../audit';
import { transact } from '../effects';
import { buildDashboard, mineWhere } from '../dashboard';
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
    res.json({ token: signToken(u, await getSessionMinutes()), user: publicUser(u), sessionMinutes: await getSessionMinutes() });
  },
);

core.use(authenticate);

/** Pencarian global (kotak cari di header): pelanggan, WO, aset — masing-masing 5 teratas, memakai indeks trigram. */
core.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return void res.json({ customers: [], workOrders: [], assets: [] });
  const like = { contains: q, mode: 'insensitive' as const };
  const role = req.user!.role;
  const seeCust = ['ADMIN', 'MKT', 'NOC', 'FIN', 'GA'].includes(role), seeAssets = ['ADMIN', 'GA'].includes(role); // sama dengan hak menu
  const [customers, workOrders, assets] = await Promise.all([
    !seeCust ? Promise.resolve([]) : prisma.customer.findMany({ where: { archivedAt: null, OR: [{ name: like }, { code: like }, { phone: { contains: q } }, { ip: { contains: q } }] }, select: { id: true, code: true, name: true, status: true }, orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.workOrder.findMany({ where: { OR: [{ number: like }, { title: like }] }, select: { id: true, number: true, title: true, status: true, type: true }, orderBy: { createdAt: 'desc' }, take: 5 }),
    !seeAssets ? Promise.resolve([]) : prisma.asset.findMany({ where: { OR: [{ serialNumber: like }, { assetCode: like }] }, select: { id: true, serialNumber: true, assetCode: true, status: true, item: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 5 }),
  ]);
  res.json({ customers, workOrders, assets });
});

/** Introspeksi token untuk aplikasi lain (super apps / Sales Tracking): kirim `Authorization: Bearer <token>` → identitas & peran. 401 bila token tidak valid/kedaluwarsa. */
core.get('/auth/introspect', (req, res) => {
  const u = req.realUser ?? req.user!;
  const tok = String(req.headers.authorization ?? '').slice(7);
  const exp = (jwt.decode(tok) as { exp?: number } | null)?.exp ?? null;
  res.json({ active: true, sub: u.id, name: u.name, email: u.email, role: u.role, subRole: u.subRole, exp });
});

core.get('/auth/me', async (req, res) => res.json({ ...publicUser(req.realUser ?? req.user!), acting: req.realUser ? { role: req.user!.role, subRole: req.user!.subRole } : null, sessionMinutes: await getSessionMinutes() }));

/** Perpanjang sesi (dipanggil klien selama pengguna aktif). Token yang sudah kedaluwarsa tidak bisa diperpanjang. */
core.post('/auth/refresh', async (req, res) => {
  const m = await getSessionMinutes();
  res.json({ token: signToken(req.realUser ?? req.user!, m), sessionMinutes: m });
});

/** Profil sendiri: nama & email (Admin yang bertindak sebagai peran lain mengubah akun aslinya). */
core.patch('/auth/me', async (req, res) => {
  const me = req.realUser ?? req.user!;
  const b = z.object({ name: z.string().trim().min(2, 'Nama minimal 2 karakter').max(80), email: z.string().trim().toLowerCase().email('Format email tidak valid').max(120) }).partial().parse(req.body);
  if (b.email && b.email !== me.email && (await prisma.user.findUnique({ where: { email: b.email } }))) throw fieldError('email', 'Email sudah dipakai akun lain', 409);
  const u = await prisma.user.update({ where: { id: me.id }, data: b });
  res.json(publicUser(u));
});

const avatarUpload = multer({
  storage: multer.diskStorage({ destination: config.uploadDir, filename: (req, file, cb) => cb(null, `avatar-${(req.realUser ?? req.user!).id}-${Date.now()}${path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')}`) }),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});
const dropAvatarFile = (url?: string | null) => { if (url?.startsWith('/uploads/avatar-')) fs.unlink(path.join(config.uploadDir, path.basename(url)), () => {}); };
core.post('/auth/me/avatar', avatarUpload.single('file'), async (req, res) => {
  const me = req.realUser ?? req.user!;
  if (!req.file) throw new AppError(400, 'Foto harus JPG/PNG/WEBP ≤ 2 MB');
  const u = await prisma.user.update({ where: { id: me.id }, data: { avatarUrl: `/uploads/${req.file.filename}` } });
  dropAvatarFile(me.avatarUrl);
  res.status(201).json(publicUser(u));
});
core.delete('/auth/me/avatar', async (req, res) => {
  const me = req.realUser ?? req.user!;
  const u = await prisma.user.update({ where: { id: me.id }, data: { avatarUrl: null } });
  dropAvatarFile(me.avatarUrl);
  res.json(publicUser(u));
});

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
  const me = req.user!;
  // ?assignable=1: calon tim pelaksana — supervisor FOC tidak dapat menugaskan Manager
  const hideManagers = req.query.assignable === '1' && me.role !== 'ADMIN' && me.subRole === 'SUPERVISOR';
  const users = await prisma.user.findMany({
    where: { active: true, email: { not: 'system@l1v.local' }, ...(role ? { role: role as any } : {}), ...(hideManagers ? { subRole: { not: 'MANAGER' as const } } : {}) },
    select: { id: true, name: true, role: true, subRole: true },
    orderBy: { name: 'asc' },
  });
  res.json(users);
});

const userBody = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  role: z.enum(['ADMIN', 'MKT', 'NOC', 'FOC', 'GA', 'FIN']),
  subRole: z.enum(['MANAGER', 'SUPERVISOR', 'STAFF']).default('STAFF'),
  password: z.string().min(8),
  telegramChatId: z.string().optional().nullable(),
});

core.get('/users', requireRole('ADMIN'), async (_req, res) => {
  res.json(await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, subRole: true, active: true, telegramChatId: true, mustChangePassword: true }, orderBy: { name: 'asc' } }));
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
core.get('/customers', requireRole('MKT', 'NOC', 'FIN', 'GA'), async (req, res) => {
  const q = req.query.q ? String(req.query.q).trim() : '';
  const status = req.query.status ? String(req.query.status).split(',') : undefined;
  const packageName = req.query.packageName ? String(req.query.packageName) : undefined;
  const archivedView = req.query.archived === '1' && req.user!.role === 'ADMIN'; // Admin dapat melihat arsip
  const pp = pageParams(req, {
    sorts: { code: (d) => ({ code: d }), name: (d) => ({ name: d }), phone: (d) => ({ phone: d }), packageName: (d) => ({ packageName: d }), status: (d) => ({ status: d }), ip: (d) => ({ ip: d }), createdAt: (d) => ({ createdAt: d }) },
    defaultSort: { key: 'createdAt', dir: 'desc' },
    legacyLimit: 100,
  });
  const where = {
    archivedAt: archivedView ? { not: null } : null,
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
  if (!['ADMIN', 'MKT', 'NOC', 'FIN', 'GA'].includes(req.user!.role)) throw new AppError(403, 'Akses khusus: MKT, NOC, FIN, GA');
  const c = await prisma.customer.findUnique({
    where: { id: String(req.params.id) },
    include: {
      warehouse: true,
      area: true,
      assets: { include: { item: true } },
      workOrders: { orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, number: true, type: true, status: true, title: true, createdAt: true } },
    },
  });
  if (!c) throw new AppError(404, 'Pelanggan tidak ditemukan');
  res.json(c);
});

/** Riwayat perubahan data pelanggan dari sinkron MSRadius (nilai lama → baru). */
core.get('/customers/:id/changes', async (req, res) => {
  if (!['ADMIN', 'MKT', 'NOC', 'FIN', 'GA'].includes(req.user!.role)) throw new AppError(403, 'Akses khusus: MKT, NOC, FIN, GA');
  res.json(await prisma.customerChange.findMany({ where: { customerId: String(req.params.id) }, orderBy: { createdAt: 'desc' }, take: 200 }));
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
  // woId TIDAK diikat saat unggah: foto baru terikat ke WO hanya saat laporan benar-benar dikirim (bindPhotos). Foto yang tak jadi dikirim tidak muncul di WO.
  await prisma.attachment.create({ data: { url, mime: req.file.mimetype, uploadedBy: u.id, kind: m.kind, lat: m.lat, lng: m.lng, accuracy: m.accuracy, takenAt: new Date() } });
  res.status(201).json({ url, lat: m.lat ?? null, lng: m.lng ?? null });
});

/* ── kotak masuk notifikasi (lonceng) ── */
core.get('/inbox/summary', async (req, res) => {
  const userId = req.user!.id;
  const where = mineWhere(req.user!);
  const [items, unread, taskTotal, taskRows] = await Promise.all([
    prisma.inbox.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 8 }),
    prisma.inbox.count({ where: { userId, readAt: null } }),
    prisma.workOrder.count({ where }),
    prisma.workOrder.findMany({ where, select: { id: true, number: true, type: true, status: true, title: true }, orderBy: { createdAt: 'asc' }, take: 5 }),
  ]);
  // "Butuh tindakan": WO yang menunggu divisi/orang ini (sama dengan tab "WO saya")
  const tasks = { total: taskTotal, items: taskRows.map((w) => ({ ...w, statusLabel: (workflows as any)[w.type]?.statuses[w.status]?.label ?? w.status })) };
  res.json({ items, unread, tasks });
});
core.get('/inbox', async (req, res) => {
  const userId = req.user!.id;
  const unreadOnly = req.query.unread === '1';
  const q = req.query.q ? String(req.query.q).trim() : '';
  const pp = pageParams(req, { sorts: { createdAt: (d) => ({ createdAt: d }) }, defaultSort: { key: 'createdAt', dir: 'desc' }, legacyLimit: 50 });
  const where = { userId, ...(unreadOnly ? { readAt: null } : {}), ...(q ? { OR: [{ subject: { contains: q, mode: 'insensitive' as const } }, { body: { contains: q, mode: 'insensitive' as const } }] } : {}) };
  const [rows, total] = await Promise.all([prisma.inbox.findMany({ where, orderBy: pp.orderBy, skip: pp.skip, take: pp.take }), countIf(pp, () => prisma.inbox.count({ where }))]);
  sendPage(res, pp, rows, total);
});
core.post('/inbox/read', async (req, res) => {
  const b = z.object({ ids: z.array(z.string()).max(200).optional(), all: z.boolean().optional() }).parse(req.body ?? {});
  const where = { userId: req.user!.id, readAt: null, ...(b.all ? {} : { id: { in: b.ids ?? [] } }) };
  const r = await prisma.inbox.updateMany({ where, data: { readAt: new Date() } });
  res.json({ updated: r.count });
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
core.post('/admin/notifications/:id/resend', requireRole('ADMIN'), async (req, res) => {
  const n = await prisma.notification.findUnique({ where: { id: String(req.params.id) } });
  if (!n) throw new AppError(404, 'Notifikasi tidak ditemukan');
  if (n.status === 'SENT') throw new AppError(400, 'Notifikasi sudah terkirim');
  await prisma.notification.update({ where: { id: n.id }, data: { status: 'PENDING', error: null } });
  await requeueNotification(n.id);
  res.json({ ok: true });
});
core.post('/admin/notifications/resend-all', requireRole('ADMIN'), async (_req, res) => {
  const rows = await prisma.notification.findMany({ where: { status: { in: ['NOT_SENT', 'FAILED'] } }, select: { id: true }, take: 500 });
  await prisma.notification.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: 'PENDING', error: null } });
  for (const r of rows) await requeueNotification(r.id);
  res.json({ queued: rows.length });
});
core.get('/admin/outbound', requireRole('ADMIN'), async (_req, res) => {
  res.json(await prisma.outboundEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }));
});
