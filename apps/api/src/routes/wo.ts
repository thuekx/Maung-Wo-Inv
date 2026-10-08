import { Router } from 'express';
import { z } from 'zod';
import { AppError, prisma } from '../db';
import { authenticate } from '../auth';
import { transact } from '../effects';
import { allowedActions, applyAction, bindPhotos, createWorkOrder } from '../engine';
import { config } from '../config';
import { workflowMeta, workflows } from '../workflows';

export const woRoutes = Router();
woRoutes.use(authenticate);

woRoutes.get('/work-orders/meta', (_req, res) => res.json(workflowMeta()));

woRoutes.get('/work-orders', async (req, res) => {
  const q = z
    .object({ type: z.string().optional(), status: z.string().optional(), scope: z.enum(['open', 'closed', 'all', 'mine']).default('open'), q: z.string().optional(), customerId: z.string().optional() })
    .parse(req.query);
  const rows = await prisma.workOrder.findMany({
    where: {
      ...(q.type ? { type: q.type as any } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.scope === 'open' || q.scope === 'mine' ? { closedAt: null } : q.scope === 'closed' ? { closedAt: { not: null } } : {}),
      ...(q.q ? { OR: [{ number: { contains: q.q, mode: 'insensitive' } }, { title: { contains: q.q, mode: 'insensitive' } }, { customer: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    },
    include: { customer: { select: { id: true, name: true, code: true } }, assignee: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const me = req.user!;
  const out = rows
    .map((w) => {
      const st = workflows[w.type].statuses[w.status];
      return { ...w, statusLabel: st?.label ?? (w.status === 'CANCELLED' ? 'Dibatalkan' : w.status), owner: st?.owner ?? null };
    })
    .filter((w) => q.scope !== 'mine' || me.role === 'ADMIN' || w.owner === me.role || w.assigneeId === me.id);
  res.json(out);
});

woRoutes.post('/work-orders', async (req, res) => {
  const { type, input } = z.object({ type: z.enum(['NEW_INSTALL', 'TROUBLE', 'SUSPEND', 'UNSUSPEND', 'TERMINATE', 'STOCK_REQUEST']), input: z.record(z.any()) }).parse(req.body);
  const u = req.user!;
  const created = await transact((fx) => createWorkOrder(fx, { type, actor: { id: u.id, name: u.name, role: u.role }, input }));
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
    allowed: allowedActions(wo, { id: u.id, name: u.name, role: u.role }),
  });
});

woRoutes.post('/work-orders/:id/actions/:key', async (req, res) => {
  const u = req.user!;
  await transact((fx) => applyAction(fx, String(req.params.id), String(req.params.key), { id: u.id, name: u.name, role: u.role }, req.body ?? {}));
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
    await bindPhotos(fx.tx, wo.id, { id: u.id, name: u.name, role: u.role }, b.photos, 'PROGRESS', b.note);
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
