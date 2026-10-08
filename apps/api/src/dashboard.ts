import { Prisma, Role, User } from './orm';
import { prisma } from './db';
import { workflows } from './workflows';

const DAY = 86400_000;
const CLOSED_BAD = ['CANCELLED', 'REJECTED'];
const label = (type: keyof typeof workflows, status: string) => workflows[type].statuses[status]?.label ?? status;
const ownerOf = (type: keyof typeof workflows, status: string) => workflows[type].statuses[status]?.owner;

/** Pasangan (jenis WO, status) yang menunggu tindakan divisi `role` — dipetakan dari definisi workflow. */
export function statusPairsOwnedBy(role: Role) {
  const pairs: { type: keyof typeof workflows; statuses: string[] }[] = [];
  for (const [type, wf] of Object.entries(workflows)) {
    const statuses = Object.entries(wf.statuses).filter(([, s]) => s.owner === role && !s.final).map(([k]) => k);
    if (statuses.length) pairs.push({ type: type as keyof typeof workflows, statuses });
  }
  return pairs;
}

/**
 * Filter "tugas saya" yang dikerjakan di database (bukan di memori):
 * Admin = semua WO terbuka; divisi lain = WO pada status yang dimiliki divisinya; FOC = hanya yang ditugaskan padanya atau belum ditugaskan.
 */
export function mineWhere(user: Pick<User, 'id' | 'role'>): Prisma.WorkOrderWhereInput {
  if (user.role === 'ADMIN') return { closedAt: null };
  const pairs = statusPairsOwnedBy(user.role);
  const own = pairs.map((p) => ({ type: p.type, status: { in: p.statuses }, ...(user.role === 'FOC' ? { OR: [{ assigneeId: null }, { assigneeId: user.id }] } : {}) }));
  const OR: Prisma.WorkOrderWhereInput[] = [...own, ...(user.role === 'FOC' ? [{ assigneeId: user.id }] : [])];
  return { closedAt: null, ...(OR.length ? { OR } : { id: '__none__' }) };
}

/** Semua angka dashboard lewat agregasi SQL; waktu respons tidak bergantung pada jumlah WO/pelanggan/aset. */
export async function buildDashboard(user: Pick<User, 'id' | 'role'>) {
  const now = Date.now();
  const since30 = new Date(now - 30 * DAY);
  const since15 = new Date(now - 15 * DAY);
  const overdueBefore = new Date(now - 7 * DAY);
  const openSel = { id: true, number: true, type: true, status: true, title: true, assigneeId: true, createdAt: true, scheduledAt: true } as const;

  const [openByType, mineRows, mineTotal, overdueGroups, overdueItems, prog, trend, items, assetStock, qtyStock, maintenanceDue, pendingQc, customers] = await Promise.all([
    prisma.workOrder.groupBy({ by: ['type'], where: { closedAt: null }, _count: { _all: true } }),
    prisma.workOrder.findMany({ where: mineWhere(user), select: openSel, orderBy: { createdAt: 'asc' }, take: 50 }),
    prisma.workOrder.count({ where: mineWhere(user) }),
    prisma.workOrder.groupBy({ by: ['type', 'status'], where: { closedAt: null, createdAt: { lt: overdueBefore } }, _count: { _all: true } }),
    prisma.workOrder.findMany({ where: { closedAt: null, createdAt: { lt: overdueBefore } }, select: openSel, orderBy: { createdAt: 'asc' }, take: 8 }),
    prisma.$queryRaw<{ type: string; created: number; done: number; cancelled: number; open: number }[]>`
      SELECT type::text AS type, COUNT(*)::int AS created,
        COUNT(*) FILTER (WHERE "closedAt" IS NOT NULL AND status NOT IN ('CANCELLED','REJECTED'))::int AS done,
        COUNT(*) FILTER (WHERE "closedAt" IS NOT NULL AND status IN ('CANCELLED','REJECTED'))::int AS cancelled,
        COUNT(*) FILTER (WHERE "closedAt" IS NULL)::int AS open
      FROM "WorkOrder" WHERE "createdAt" >= ${since30} GROUP BY type`,
    prisma.$queryRaw<{ day: string; created: number; done: number }[]>`
      SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(c.n, 0)::int AS created, COALESCE(x.n, 0)::int AS done
      FROM generate_series((now() AT TIME ZONE 'Asia/Jakarta')::date - 13, (now() AT TIME ZONE 'Asia/Jakarta')::date, interval '1 day') AS d
      LEFT JOIN (SELECT (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta')::date AS day, COUNT(*) AS n FROM "WorkOrder" WHERE "createdAt" >= ${since15} GROUP BY 1) c ON c.day = d::date
      LEFT JOIN (SELECT (("closedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta')::date AS day, COUNT(*) AS n FROM "WorkOrder" WHERE "closedAt" >= ${since15} AND status NOT IN ('CANCELLED','REJECTED') GROUP BY 1) x ON x.day = d::date
      ORDER BY d`,
    prisma.item.findMany({ where: { minStock: { gt: 0 } }, orderBy: { name: 'asc' } }),
    prisma.asset.groupBy({ by: ['itemId'], where: { status: { in: ['IN_STOCK', 'REFURBISHED'] }, warehouse: { kind: { not: 'MOBILE' } } }, _count: { _all: true } }),
    prisma.stockLevel.groupBy({ by: ['itemId'], where: { warehouse: { kind: { not: 'MOBILE' } } }, _sum: { qty: true } }),
    prisma.asset.findMany({ where: { item: { category: 'GA' }, nextMaintenanceAt: { lte: new Date(now + 14 * DAY) } }, include: { item: true }, orderBy: { nextMaintenanceAt: 'asc' }, take: 20 }),
    prisma.asset.count({ where: { status: 'RETURNED_PENDING_QC' } }),
    prisma.customer.groupBy({ by: ['status'], _count: true }),
  ]);

  const byType: Record<string, number> = {};
  for (const g of openByType) byType[g.type] = g._count._all;
  const decorate = <T extends { type: keyof typeof workflows; status: string }>(w: T) => ({ ...w, statusLabel: label(w.type, w.status), owner: ownerOf(w.type, w.status) });

  const progress = { created: 0, done: 0, cancelled: 0, open: 0, pct: 0 };
  const byTypeProgress: Record<string, { open: number; done: number }> = {};
  for (const t of Object.keys(workflows)) byTypeProgress[t] = { open: byType[t] ?? 0, done: 0 };
  for (const r of prog) { progress.created += r.created; progress.done += r.done; progress.cancelled += r.cancelled; progress.open += r.open; byTypeProgress[r.type].done = r.done; }
  progress.pct = progress.created ? Math.round((progress.done / progress.created) * 100) : 0;

  const byOwner: Record<string, number> = {};
  let overdueTotal = 0;
  for (const g of overdueGroups) { overdueTotal += g._count._all; const o = ownerOf(g.type, g.status); if (o) byOwner[o] = (byOwner[o] ?? 0) + g._count._all; }
  const overdue = { total: overdueTotal, byOwner, items: overdueItems.map((w) => ({ ...decorate(w), ageDays: Math.floor((now - w.createdAt.getTime()) / DAY) })).map(({ id, number, type, title, statusLabel, owner, ageDays }) => ({ id, number, type, title, statusLabel, owner, ageDays })) };

  const assetCnt = new Map(assetStock.map((g) => [g.itemId, g._count._all]));
  const qty = new Map(qtyStock.map((g) => [g.itemId, g._sum.qty ?? 0]));
  const stock = items.map((it) => {
    const total = it.tracked ? assetCnt.get(it.id) ?? 0 : qty.get(it.id) ?? 0;
    return { id: it.id, name: it.name, unit: it.unit, total, minStock: it.minStock, level: total <= 0 ? ('OUT' as const) : total < it.minStock ? ('LOW' as const) : ('OK' as const) };
  });
  const lowStock = stock.filter((s) => s.level !== 'OK').sort((a, b) => a.total / a.minStock - b.total / b.minStock);
  const stockSummary = { out: stock.filter((s) => s.level === 'OUT').length, low: stock.filter((s) => s.level === 'LOW').length, ok: stock.filter((s) => s.level === 'OK').length };

  return {
    mine: mineRows.map(decorate), mineTotal, openTotal: Object.values(byType).reduce((a, b) => a + b, 0), byType, byTypeProgress, progress, trend,
    overdue, lowStock, stockSummary, maintenanceDue, pendingQc, customers,
  };
}
