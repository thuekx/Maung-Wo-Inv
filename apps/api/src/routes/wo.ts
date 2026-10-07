import { Router } from 'express';
import { z } from 'zod';
import { AppError, prisma } from '../db';
import { authenticate } from '../auth';
import { transact } from '../effects';
import { allowedActions, applyAction, createWorkOrder } from '../engine';
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
    },
  });
  if (!wo) throw new AppError(404, 'WO tidak ditemukan');
  const u = req.user!;
  const st = workflows[wo.type].statuses[wo.status];
  res.json({
    ...wo,
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
