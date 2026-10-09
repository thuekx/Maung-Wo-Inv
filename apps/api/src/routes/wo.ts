import { Router } from 'express';
import { z } from 'zod';
import { AppError, prisma } from '../db';
import { actorOf, authenticate } from '../auth';
import { transact } from '../effects';
import { mineWhere } from '../dashboard';
import { countIf, pageParams, sendPage } from '../paging';
import { Prisma } from '../orm';
import { allowedActions, applyAction, bindPhotos, createWorkOrder } from '../engine';
import { config } from '../config';
import { auditedDelete, auditedUpdate, changes, whoOf } from '../audit';
import { requireRole } from '../auth';
import { workflowMeta, workflows } from '../workflows';

export const woRoutes = Router();
woRoutes.use(authenticate);

woRoutes.get('/work-orders/meta', (_req, res) => res.json(workflowMeta()));

woRoutes.get('/work-orders', async (req, res) => {
  const q = z
    .object({ type: z.string().optional(), status: z.string().optional(), scope: z.enum(['open', 'closed', 'all', 'mine', 'created']).default('open'), q: z.string().optional(), customerId: z.string().optional(), olderThanDays: z.coerce.number().int().min(1).optional() })
    .parse(req.query);
  const me = req.user!;
  const pp = pageParams(req, {
    sorts: { number: (d) => ({ number: d }), type: (d) => ({ type: d }), status: (d) => ({ status: d }), title: (d) => ({ title: d }), createdAt: (d) => ({ createdAt: d }), updatedAt: (d) => ({ updatedAt: d }), scheduledAt: (d) => ({ scheduledAt: d }) },
    defaultSort: { key: 'createdAt', dir: 'desc' },
    legacyLimit: 200,
  });
  const term = q.q?.trim();
  // nama pelanggan dicari lewat indeks trigram pelanggan, lalu customerId IN (...) — bukan join per baris WO
  const custIds = term ? (await prisma.customer.findMany({ where: { name: { contains: term, mode: 'insensitive' } }, select: { id: true }, take: 500 })).map((c) => c.id) : [];
  const where: Prisma.WorkOrderWhereInput = {
    AND: [
      q.scope === 'mine' ? mineWhere(me) : q.scope === 'created' ? { createdById: me.id } : q.scope === 'open' ? { closedAt: null } : q.scope === 'closed' ? { closedAt: { not: null } } : {},
      ...(q.type ? [{ type: q.type as any }] : []),
      ...(q.status ? [{ status: q.status }] : []),
      ...(q.customerId ? [{ customerId: q.customerId }] : []),
      ...(q.olderThanDays ? [{ createdAt: { lt: new Date(Date.now() - q.olderThanDays * 86400_000) } }] : []),
      ...(term ? [{ OR: [{ number: { contains: term, mode: 'insensitive' as const } }, { title: { contains: term, mode: 'insensitive' as const } }, ...(custIds.length ? [{ customerId: { in: custIds } }] : [])] }] : []),
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.workOrder.findMany({ where, include: { customer: { select: { id: true, name: true, code: true } }, assignee: { select: { name: true } } }, orderBy: pp.orderBy, skip: pp.skip, take: pp.take }),
    countIf(pp, () => prisma.workOrder.count({ where })),
  ]);
  const out = rows.map((w) => {
    const st = workflows[w.type].statuses[w.status];
    return { ...w, statusLabel: st?.label ?? (w.status === 'CANCELLED' ? 'Dibatalkan' : w.status), owner: st?.owner ?? null };
  });
  sendPage(res, pp, out, total);
});

woRoutes.post('/work-orders', async (req, res) => {
  const { type, input } = z.object({ type: z.enum(['NEW_INSTALL', 'TROUBLE', 'SUSPEND', 'UNSUSPEND', 'TERMINATE', 'STOCK_REQUEST', 'STOCK_RETURN']), input: z.record(z.any()) }).parse(req.body);
  const u = req.user!;
  const created = await transact((fx) => createWorkOrder(fx, { type, actor: actorOf(req), input }));
  res.status(201).json(created);
});

woRoutes.get('/work-orders/:id', async (req, res) => {
  const wo = await prisma.workOrder.findUnique({
    where: { id: String(req.params.id) },
    include: {
      customer: { include: { warehouse: true } },
      createdBy: { select: { name: true, role: true } },
      assignee: { select: { id: true, name: true } },
      parent: { select: { id: true, number: true, title: true, type: true } },
      children: { select: { id: true, number: true, title: true, type: true, status: true } },
      events: { orderBy: { createdAt: 'asc' } },
      purchase: { include: { lines: { include: { item: true } } } },
      attachments: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!wo) throw new AppError(404, 'WO tidak ditemukan');
  const u = req.user!;
  const st = workflows[wo.type].statuses[wo.status];
  const uploaders = await prisma.user.findMany({ where: { id: { in: [...new Set(wo.attachments.map((a) => a.uploadedBy))] } }, select: { id: true, name: true } });
  const attachments = wo.attachments.map((a) => ({ ...a, uploaderName: uploaders.find((x) => x.id === a.uploadedBy)?.name ?? '-' }));
  const canProgress = !st?.final && wo.status !== 'CANCELLED' && st?.owner === 'FOC' && !!wo.assigneeId && (u.role === 'ADMIN' || wo.assigneeId === u.id);
  res.json({
    ...wo,
    attachments,
    canProgress,
    statusLabel: st?.label ?? (wo.status === 'CANCELLED' ? 'Dibatalkan' : wo.status),
    owner: st?.owner ?? null,
    final: wo.status === 'CANCELLED' || !!st?.final,
    allowed: allowedActions(wo, actorOf(req)),
  });
});

woRoutes.post('/work-orders/:id/actions/:key', async (req, res) => {
  const u = req.user!;
  await transact((fx) => applyAction(fx, String(req.params.id), String(req.params.key), actorOf(req), req.body ?? {}));
  res.json({ ok: true });
});

// aset yang menunggu QC dari WO ini (form QC di WO Terminate)
woRoutes.get('/work-orders/:id/qc-assets', async (req, res) => {
  res.json(await prisma.asset.findMany({ where: { woId: String(req.params.id), status: 'RETURNED_PENDING_QC' }, include: { item: true } }));
});

/** Update progres lapangan oleh teknisi yang ditugaskan: foto bertanda GPS + catatan, tanpa pindah tahap. */
woRoutes.post('/work-orders/:id/progress', async (req, res) => {
  const b = z.object({ note: z.string().trim().max(500).optional(), photos: z.array(z.string().min(1)).min(1, 'Minimal 1 foto progres').max(10) }).parse(req.body);
  const u = req.user!;
  await transact(async (fx) => {
    const wo = await fx.tx.workOrder.findUnique({ where: { id: String(req.params.id) }, include: { customer: true } });
    if (!wo) throw new AppError(404, 'WO tidak ditemukan');
    const st = workflows[wo.type].statuses[wo.status];
    if (wo.closedAt || st?.owner !== 'FOC' || !wo.assigneeId) throw new AppError(409, 'Progres lapangan hanya untuk WO yang sedang dikerjakan teknisi');
    if (u.role !== 'ADMIN' && wo.assigneeId !== u.id) throw new AppError(403, 'Hanya teknisi yang ditugaskan');
    await bindPhotos(fx.tx, wo.id, actorOf(req), b.photos, 'PROGRESS', b.note);
    await fx.tx.woEvent.create({ data: { woId: wo.id, action: 'progress', fromStatus: wo.status, toStatus: wo.status, actorId: u.id, actorName: u.name, note: b.note, payload: { photos: b.photos } } });
    await fx.notify({
      roles: ['NOC'],
      userIds: [wo.createdById],
      woId: wo.id,
      subject: `[${wo.number}] Update progres lapangan`,
      body: `${u.name} mengirim ${b.photos.length} foto progres (GPS) untuk ${wo.title}.${b.note ? `\nCatatan: ${b.note}` : ''}\n${config.webUrl}/work-orders/${wo.id}`,
    });
  });
  res.json({ ok: true });
});

/** Edit ringan WO terbuka (judul & catatan) oleh pembuatnya atau Admin. Perubahan tahap tetap lewat aksi workflow. */
woRoutes.patch('/work-orders/:id', async (req, res) => {
  const id = String(req.params.id);
  const b = z.object({ title: z.string().trim().min(3).max(150), notes: z.string().trim().max(1000) }).partial().parse(req.body);
  const wo = await prisma.workOrder.findUnique({ where: { id } });
  if (!wo) throw new AppError(404, 'WO tidak ditemukan');
  const u = req.user!;
  if (wo.closedAt) throw new AppError(409, 'WO sudah selesai/dibatalkan');
  if (u.role !== 'ADMIN' && wo.createdById !== u.id) throw new AppError(403, 'Hanya pembuat WO / Admin yang dapat mengubah');
  const patch: Record<string, unknown> = { ...(b.title ? { title: b.title } : {}) };
  const data = { ...(wo.data as object), ...(b.notes !== undefined ? { notes: b.notes } : {}) };
  const ch = changes({ title: wo.title, notes: (wo.data as any)?.notes ?? null }, { title: b.title, notes: b.notes });
  await auditedUpdate(whoOf(req), 'WO', id, wo.number, ch, (fx) => fx.tx.workOrder.update({ where: { id }, data: { ...patch, ...(b.notes !== undefined ? { data } : {}) } as any }));
  res.json({ ok: true });
});

/** Hapus WO (khusus Admin; notifikasi/audit tercatat). Pelanggan/stok TIDAK dikembalikan otomatis. */
woRoutes.delete('/work-orders/:id', requireRole('ADMIN'), async (req, res) => {
  const id = String(req.params.id);
  const wo = await prisma.workOrder.findUnique({ where: { id }, include: { children: { select: { number: true } }, purchase: { select: { number: true } } } });
  if (!wo) throw new AppError(404, 'WO tidak ditemukan');
  if (wo.children.length || wo.purchase.length) throw new AppError(409, `WO punya turunan (${[...wo.children, ...wo.purchase].map((x) => x.number).join(', ')}) — hapus/batalkan turunannya dulu`);
  await auditedDelete(whoOf(req), 'WO', id, `${wo.number} ${wo.title}`, { id, number: wo.number, type: wo.type, status: wo.status, title: wo.title }, async (fx) => {
    await fx.tx.attachment.deleteMany({ where: { woId: id } });
    await fx.tx.workOrder.delete({ where: { id } });
  });
  res.json({ ok: true });
});
