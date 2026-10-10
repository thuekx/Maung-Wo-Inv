import { Router } from 'express';
import { z } from 'zod';
import { AppError, prisma } from '../db';
import { actorOf, authenticate } from '../auth';
import { isPrivateIPv4 } from '../network';
import { transact } from '../effects';
import { mineWhere } from '../dashboard';
import { countIf, pageParams, sendPage } from '../paging';
import { Prisma } from '../orm';
import { allowedActions, applyAction, bindPhotos, createWorkOrder } from '../engine';
import { webUrl } from '../settings';
import { auditedDelete, auditedUpdate, changes, whoOf } from '../audit';
import { requireRole } from '../auth';
import { workflowMeta, workflows } from '../workflows';
import { aliasForArea, baNumber, reportNumber } from '../docnum';
import { inTeam, isLead } from '../wf-types';
import { resolveRefs } from '../refs';

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
  const { type, input } = z.object({ type: z.enum(['NEW_INSTALL', 'TROUBLE', 'SUSPEND', 'UNSUSPEND', 'TERMINATE', 'STOCK_REQUEST', 'STOCK_RETURN', 'MAINTENANCE']), input: z.record(z.any()) }).parse(req.body);
  const u = req.user!;
  const subId = type === 'NEW_INSTALL' && typeof input.subscriptionId === 'string' ? input.subscriptionId : null;
  const created = await transact(async (fx) => {
    const r = await createWorkOrder(fx, { type, actor: actorOf(req), input });
    if (subId) {
      // tautkan Formulir Berlangganan ke WO & pelanggan yang baru dibuat
      const wo = await fx.tx.workOrder.findUnique({ where: { id: r.id }, select: { customerId: true } });
      await fx.tx.subscription.updateMany({ where: { id: subId, woId: null }, data: { woId: r.id, customerId: wo?.customerId ?? null } });
    }
    return r;
  });
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
  const canProgress = !st?.final && wo.status !== 'CANCELLED' && st?.owner === 'FOC' && !!wo.assigneeId && (u.role === 'ADMIN' || !!req.realUser || inTeam(wo, u.id) || (u.role === 'FOC' && isLead(actorOf(req))));
  // isian awal form aksi: NOC melihat IP dari MSRadius (bila ada) & data jaringan yang sudah tercatat
  const c = wo.customer;
  const radIp = c?.radiusIp ?? '';
  // data teknis dari validasi FOC (kolom pelanggan; cadangan: catatan validasi di data WO) agar tim FOC tidak mengisi ulang
  const val = ((wo.data as any)?.validation ?? {}) as { odp?: string; port?: string; pop?: string };
  const tech = c ? { odp: c.odp || val.odp || '', port: c.port || val.port || '', pop: c.pop || val.pop || '', lat: c.lat ?? '', lng: c.lng ?? '' } : {};
  const prefill = c
    ? {
        validate: { odp: c.odp ?? '', port: c.port ?? '', pop: c.pop ?? '' },
        service_active: { vlan: c.vlan ?? '', ip: c.ip ?? (isPrivateIPv4(radIp) ? radIp : ''), publicIp: c.publicIp ?? (radIp && !isPrivateIPv4(radIp) ? radIp : '') },
        submit_report: tech,
        send_ba: { sendEmail: !!c.email, recipientEmail: c.email ?? '', sendWhatsapp: false, recipientPhone: c.phone ?? '', sendTelegram: false },
      }
    : {};
  // nomor dokumen (BA / laporan) memakai singkatan area; area maintenance mandiri ada di data WO
  const areaId = c?.areaId ?? ((wo.data as any)?.areaId as string | undefined) ?? null;
  const alias = await aliasForArea(prisma, areaId);
  const kind = wo.type === 'NEW_INSTALL' ? 'INS' : wo.type === 'TROUBLE' || wo.type === 'MAINTENANCE' ? 'TBS' : null;
  const docs = { areaAlias: alias, baNumber: wo.type === 'NEW_INSTALL' ? baNumber(alias, wo.number) : null, reportNumber: kind && (wo.data as any)?.report ? reportNumber(kind, alias, wo.number) : null, reportKind: kind };
  // BA Digital hanya untuk Marketing (dan Admin): FOC/NOC dan lainnya tidak melihatnya
  const seeBa = u.role === 'ADMIN' || u.role === 'MKT';
  const woData = seeBa ? wo.data : (({ ba: _ba, ...rest }) => rest)((wo.data ?? {}) as Record<string, unknown>);
  res.json({
    prefill,
    refs: await resolveRefs(woData),
    ...wo,
    data: woData,
    docs,
    team: (await prisma.user.findMany({ where: { id: { in: wo.teamIds.length ? wo.teamIds : wo.assigneeId ? [wo.assigneeId] : [] } }, select: { id: true, name: true, subRole: true } })),
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

/** Cek stok untuk Permintaan Barang: ketersediaan tiap barang di gudang tujuan dan di gudang lain (dipakai GA saat review). */
woRoutes.get('/work-orders/:id/stock-check', requireRole('GA'), async (req, res) => {
  const wo = await prisma.workOrder.findUnique({ where: { id: String(req.params.id) } });
  if (!wo || wo.type !== 'STOCK_REQUEST') throw new AppError(404, 'Bukan Permintaan Barang');
  const d = wo.data as any;
  const lines = (d.lines ?? []) as { itemId: string; qty: number }[];
  const [items, whs, levels, assets] = await Promise.all([
    prisma.item.findMany({ where: { id: { in: lines.map((l) => l.itemId) } } }),
    prisma.warehouse.findMany({ where: { kind: { not: 'MOBILE' }, active: true }, select: { id: true, name: true } }),
    prisma.stockLevel.findMany({ where: { itemId: { in: lines.map((l) => l.itemId) }, warehouse: { kind: { not: 'MOBILE' } } } }),
    prisma.asset.groupBy({ by: ['itemId', 'warehouseId'], where: { itemId: { in: lines.map((l) => l.itemId) }, status: { in: ['IN_STOCK', 'REFURBISHED'] }, warehouse: { kind: { not: 'MOBILE' } } }, _count: { _all: true } }),
  ]);
  res.json({
    toWarehouse: whs.find((w) => w.id === d.toWarehouseId)?.name ?? null,
    lines: lines.map((l) => {
      const it = items.find((x) => x.id === l.itemId)!;
      const per = whs.map((w) => ({ warehouse: w.name, isDest: w.id === d.toWarehouseId, qty: it.tracked ? assets.find((a) => a.itemId === it.id && a.warehouseId === w.id)?._count._all ?? 0 : levels.find((s) => s.itemId === it.id && s.warehouseId === w.id)?.qty ?? 0 }));
      const dest = per.find((p) => p.isDest)?.qty ?? 0;
      return { item: it.name, unit: it.unit, requested: l.qty, atDestination: dest, enough: dest >= l.qty, others: per.filter((p) => !p.isDest && p.qty > 0) };
    }),
  });
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
    if (u.role !== 'ADMIN' && !inTeam(wo, u.id) && !(u.role === 'FOC' && isLead(actorOf(req)))) throw new AppError(403, 'Hanya tim yang ditugaskan (atau supervisor/manager FOC)');
    await bindPhotos(fx.tx, wo.id, actorOf(req), b.photos, 'PROGRESS', b.note);
    await fx.tx.woEvent.create({ data: { woId: wo.id, action: 'progress', fromStatus: wo.status, toStatus: wo.status, actorId: u.id, actorName: u.name, note: b.note, payload: { photos: b.photos } } });
    await fx.notify({
      roles: ['NOC'],
      userIds: [wo.createdById],
      woId: wo.id,
      subject: `[${wo.number}] Update progres lapangan`,
      body: `${u.name} mengirim ${b.photos.length} foto progres (GPS) untuk ${wo.title}.${b.note ? `\nCatatan: ${b.note}` : ''}\n${webUrl()}/work-orders/${wo.id}`,
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
