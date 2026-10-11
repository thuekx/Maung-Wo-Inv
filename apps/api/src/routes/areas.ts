import { Router } from 'express';
import { requireFeature } from '../access';
import { z } from 'zod';
import { AppError, fieldError, prisma } from '../db';
import { authenticate, requireRole } from '../auth';
import { auditedDelete, auditedUpdate, changes, whoOf, writeAudit } from '../audit';
import { transact } from '../effects';

/** Master Area: bersumber dari MSRadius (masterdata/area/list) atau manual; tiap area dihubungkan ke gudang penyuplainya. */
export const areaRoutes = Router();
areaRoutes.use(authenticate);
const gaOnly = requireFeature('master.ga');

areaRoutes.get('/areas', async (req, res) => {
  const all = req.query.all === '1';
  res.json(await prisma.area.findMany({ where: all ? {} : { active: true }, include: { warehouse: { select: { id: true, name: true } }, _count: { select: { customers: true } } }, orderBy: { name: 'asc' } }));
});

const body = z.object({
  name: z.string().trim().min(2).max(80, 'Maksimal 80 karakter'),
  warehouseId: z.preprocess((v) => (v === '' ? null : v), z.string().nullable().optional()),
  alias: z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() || null : v), z.string().regex(/^[A-Z0-9]{2,8}$/, 'Singkatan 2–8 huruf/angka, mis. BDG').nullable().optional()),
  active: z.boolean().optional(),
});

async function checkAlias(alias: string | null | undefined, selfId?: string) {
  if (alias && (await prisma.area.findFirst({ where: { alias, ...(selfId ? { id: { not: selfId } } : {}) } }))) throw fieldError('alias', `Singkatan ${alias} sudah dipakai area lain`, 409);
}

async function checkWarehouse(id?: string | null) {
  if (id && !(await prisma.warehouse.findFirst({ where: { id, kind: { in: ['MAIN', 'BRANCH'] } } }))) throw fieldError('warehouseId', 'Gudang tidak valid (pilih gudang utama/cabang)');
}

areaRoutes.post('/areas', gaOnly, async (req, res) => {
  const b = body.parse(req.body);
  if (await prisma.area.findFirst({ where: { name: { equals: b.name, mode: 'insensitive' } } })) throw fieldError('name', `Area "${b.name}" sudah ada`, 409);
  await checkWarehouse(b.warehouseId);
  await checkAlias(b.alias);
  const who = whoOf(req);
  res.status(201).json(await transact(async (fx) => {
    const a = await fx.tx.area.create({ data: { name: b.name, alias: b.alias ?? null, warehouseId: b.warehouseId ?? null } });
    await writeAudit(fx, who, { action: 'CREATE', entity: 'area', entityId: a.id, summary: `${who.name} menambah area ${a.name}` });
    return a;
  }));
});

areaRoutes.patch('/areas/:id', gaOnly, async (req, res) => {
  const id = String(req.params.id);
  const b = body.partial().parse(req.body);
  const cur = await prisma.area.findUnique({ where: { id } });
  if (!cur) throw new AppError(404, 'Area tidak ditemukan');
  if (cur.source === 'RADIUS' && b.name && b.name !== cur.name) throw fieldError('name', 'Nama area dari MSRadius diubah di MSRadius');
  if (b.name && (await prisma.area.findFirst({ where: { name: { equals: b.name, mode: 'insensitive' }, id: { not: id } } }))) throw fieldError('name', `Area "${b.name}" sudah ada`, 409);
  await checkWarehouse(b.warehouseId);
  await checkAlias(b.alias, id);
  const updated = await auditedUpdate(whoOf(req), 'area', id, cur.name, changes(cur, b), async (fx) => {
    const a = await fx.tx.area.update({ where: { id }, data: b as any });
    // gudang penyuplai berubah → ikut ke pelanggan di area ini
    if (b.warehouseId !== undefined) await fx.tx.customer.updateMany({ where: { areaId: id }, data: { warehouseId: b.warehouseId ?? null } });
    return a;
  });
  res.json(updated);
});

areaRoutes.delete('/areas/:id', gaOnly, async (req, res) => {
  const id = String(req.params.id);
  const a = await prisma.area.findUnique({ where: { id }, include: { _count: { select: { customers: true } } } });
  if (!a) throw new AppError(404, 'Area tidak ditemukan');
  if (a.source === 'RADIUS') throw new AppError(409, 'Area dari MSRadius tidak dihapus di sini — nonaktifkan saja (centang "Nonaktif")');
  if (a._count.customers) throw new AppError(409, `Area masih dipakai ${a._count.customers} pelanggan — nonaktifkan saja`);
  await auditedDelete(whoOf(req), 'area', id, a.name, { id, name: a.name }, (fx) => fx.tx.area.delete({ where: { id } }));
  res.json({ ok: true });
});
