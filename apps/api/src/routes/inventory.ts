import { Router } from 'express';
import { requireFeature } from '../access';
import { z } from 'zod';
import { AssetStatus } from '../orm';
import { AppError, fieldError, prisma, Tx } from '../db';
import { authenticate, requireRole } from '../auth';
import { transact } from '../effects';
import { applyAction, systemActor } from '../engine';
import { moveAsset, moveStock, normSn, nextNumber, qcAssets, AVAILABLE } from '../inventory';
import { auditedDelete, auditedUpdate, changes, whoOf } from '../audit';
import { countIf, pageParams, sendPage } from '../paging';

export const inventoryRoutes = Router();
inventoryRoutes.use(authenticate);

const stockRoles = requireFeature('inventory.manage');

/* ── gudang ── */
inventoryRoutes.get('/warehouses', async (req, res) => {
  const all = req.query.all === '1';
  res.json(await prisma.warehouse.findMany({ where: all ? {} : { active: true, kind: { not: 'MOBILE' } }, include: { owner: { select: { name: true } } }, orderBy: [{ kind: 'asc' }, { name: 'asc' }] }));
});
inventoryRoutes.post('/warehouses', stockRoles, async (req, res) => {
  const b = z.object({ code: z.string().min(2).toUpperCase(), name: z.string().min(2), kind: z.enum(['MAIN', 'BRANCH', 'TRANSIT', 'MOBILE']), address: z.string().optional() }).parse(req.body);
  res.status(201).json(await prisma.warehouse.create({ data: b }));
});
inventoryRoutes.patch('/warehouses/:id', stockRoles, async (req, res) => {
  const id = String(req.params.id);
  const b = z.object({ code: z.string().min(2).toUpperCase(), name: z.string().min(2), address: z.string().nullable(), kind: z.enum(['MAIN', 'BRANCH', 'TRANSIT']), active: z.boolean() }).partial().parse(req.body);
  const cur = await prisma.warehouse.findUnique({ where: { id } });
  if (!cur) throw new AppError(404, 'Gudang tidak ditemukan');
  if (b.kind && cur.kind === 'MOBILE') throw new AppError(400, 'Jenis gudang Mobile tidak dapat diubah');
  res.json(await auditedUpdate(whoOf(req), 'gudang', id, `${cur.code} ${cur.name}`, changes(cur, b), (fx) => fx.tx.warehouse.update({ where: { id }, data: b })));
});
inventoryRoutes.delete('/warehouses/:id', stockRoles, async (req, res) => {
  const id = String(req.params.id);
  const w = await prisma.warehouse.findUnique({ where: { id }, include: { _count: { select: { assets: true, customers: true } }, stock: { where: { qty: { not: 0 } } } } });
  if (!w) throw new AppError(404, 'Gudang tidak ditemukan');
  if (w.kind === 'MOBILE') throw new AppError(409, 'Gudang Mobile milik teknisi — nonaktifkan, bukan dihapus');
  if (w._count.assets || w.stock.length || w._count.customers) throw new AppError(409, `Gudang masih berisi ${w._count.assets} aset, ${w.stock.length} jenis stok, dan terkait ${w._count.customers} pelanggan — pindahkan dulu atau nonaktifkan`);
  await auditedDelete(whoOf(req), 'gudang', id, `${w.code} ${w.name}`, { id, code: w.code, name: w.name, kind: w.kind }, async (fx) => {
    await fx.tx.stockLevel.deleteMany({ where: { warehouseId: id } });
    await fx.tx.warehouse.delete({ where: { id } });
  });
  res.json({ ok: true });
});

/* ── master item ── */
inventoryRoutes.get('/items', async (_req, res) => {
  res.json(await prisma.item.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] }));
});
const itemBody = z.object({
  sku: z.string().min(2).toUpperCase(),
  name: z.string().min(2),
  category: z.enum(['CONSUMABLE', 'NETWORK', 'GA']),
  unit: z.string().default('pcs'),
  installDefaultQty: z.coerce.number().int().min(0).nullable().optional(),
  minStock: z.coerce.number().int().min(0).default(0),
  coreCount: z.preprocess((v) => (v === '' ? null : v), z.coerce.number().int().min(1, 'Minimal 1 core').max(288, 'Maksimal 288 core').nullable().optional()),
  isVehicle: z.boolean().optional(),
});
inventoryRoutes.post('/items', stockRoles, async (req, res) => {
  const b = itemBody.parse(req.body);
  if (b.coreCount && b.category !== 'CONSUMABLE') throw fieldError('coreCount', 'Jumlah core hanya untuk item kabel (kategori Habis pakai)');
  if (b.isVehicle && b.category !== 'GA') throw fieldError('isVehicle', 'Kendaraan harus kategori Aset GA');
  res.status(201).json(await prisma.item.create({ data: { ...b, unit: b.coreCount ? 'meter' : b.unit, tracked: b.category !== 'CONSUMABLE' } }));
});
inventoryRoutes.patch('/items/:id', stockRoles, async (req, res) => {
  const id = String(req.params.id);
  const b = itemBody.partial().omit({ category: true }).parse(req.body);
  const cur = await prisma.item.findUnique({ where: { id } });
  if (!cur) throw new AppError(404, 'Item tidak ditemukan');
  if (b.coreCount && cur.category !== 'CONSUMABLE') throw fieldError('coreCount', 'Jumlah core hanya untuk item kabel (kategori Habis pakai)');
  if (b.isVehicle && cur.category !== 'GA') throw fieldError('isVehicle', 'Kendaraan harus kategori Aset GA');
  if (b.coreCount) b.unit = 'meter';
  res.json(await auditedUpdate(whoOf(req), 'item', id, `${cur.sku} ${cur.name}`, changes(cur, b), (fx) => fx.tx.item.update({ where: { id }, data: b })));
});
inventoryRoutes.delete('/items/:id', stockRoles, async (req, res) => {
  const id = String(req.params.id);
  const it = await prisma.item.findUnique({ where: { id }, include: { _count: { select: { assets: true, poLines: true } }, stock: { where: { qty: { not: 0 } } } } });
  if (!it) throw new AppError(404, 'Item tidak ditemukan');
  if (it._count.assets || it.stock.length || it._count.poLines) throw new AppError(409, `Item masih dipakai (${it._count.assets} aset, ${it.stock.length} stok, ${it._count.poLines} baris PO)`);
  await auditedDelete(whoOf(req), 'item', id, `${it.sku} ${it.name}`, { id, sku: it.sku, name: it.name, category: it.category }, async (fx) => {
    await fx.tx.stockLevel.deleteMany({ where: { itemId: id } });
    await fx.tx.item.delete({ where: { id } });
  });
  res.json({ ok: true });
});

/* ── stok ── */
/** Stok Berjalan milik teknisi yang sedang login (material + perangkat ber-SN), untuk halaman "Stok Saya". */
inventoryRoutes.get('/stock/mine', requireFeature('stock.mine'), async (req, res) => {
  const wh = await prisma.warehouse.findFirst({ where: { kind: 'MOBILE', ownerId: req.user!.id } });
  if (!wh) return void res.json({ warehouse: null, stock: [], assets: [] });
  const [stock, assets] = await Promise.all([
    prisma.stockLevel.findMany({ where: { warehouseId: wh.id, qty: { gt: 0 } }, include: { item: true }, orderBy: { item: { name: 'asc' } } }),
    prisma.asset.findMany({ where: { warehouseId: wh.id }, include: { item: true }, orderBy: { serialNumber: 'asc' }, take: 500 }),
  ]);
  res.json({ warehouse: wh, stock, assets });
});
inventoryRoutes.get('/stock', requireFeature('inventory'), async (req, res) => {
  const warehouseId = req.query.warehouseId ? String(req.query.warehouseId) : undefined;
  const [levels, assetGroups] = await Promise.all([
    prisma.stockLevel.findMany({ where: { ...(warehouseId ? { warehouseId } : {}), qty: { not: 0 } }, include: { item: true, warehouse: true } }),
    prisma.asset.groupBy({ by: ['warehouseId', 'itemId', 'status'], where: { warehouseId: warehouseId ?? { not: null }, status: { in: ['IN_STOCK', 'REFURBISHED', 'IN_USE', 'DAMAGED', 'RETURNED_PENDING_QC'] } }, _count: true }),
  ]);
  const [items, whs] = await Promise.all([prisma.item.findMany(), prisma.warehouse.findMany()]);
  const rows = [
    ...levels.map((l) => ({ warehouse: l.warehouse, item: l.item, status: 'QTY', qty: l.qty })),
    ...assetGroups.map((g) => ({ warehouse: whs.find((w) => w.id === g.warehouseId)!, item: items.find((i) => i.id === g.itemId)!, status: g.status, qty: g._count })),
  ];
  res.json(rows.sort((a, b) => a.warehouse.name.localeCompare(b.warehouse.name) || a.item.name.localeCompare(b.item.name)));
});

inventoryRoutes.get('/stock/movements', requireFeature('inventory'), async (req, res) => {
  res.json(await prisma.stockMovement.findMany({ where: req.query.itemId ? { itemId: String(req.query.itemId) } : {}, orderBy: { createdAt: 'desc' }, take: 100 }));
});

/**
 * Transfer stok ANTAR GUDANG oleh GA/Procurement (tanpa WO): stok tetap milik GA, hanya lokasinya pindah — mis. mengirim stok ke gudang cabang.
 * Gudang berjalan teknisi (MOBILE) tidak termasuk: stok teknisi hanya berubah lewat alur WO (ambil material, serah-terima).
 */
inventoryRoutes.post('/stock/transfer', stockRoles, async (req, res) => {
  const b = z.object({
    fromWarehouseId: z.string().min(1), toWarehouseId: z.string().min(1),
    note: z.string().trim().max(200).optional(),
    lines: z.array(z.object({ itemId: z.string().min(1), qty: z.coerce.number().int().min(1) })).default([]),
    serials: z.array(z.string().trim().min(1)).default([]),
  }).parse(req.body);
  if (b.fromWarehouseId === b.toWarehouseId) throw new AppError(400, 'Gudang asal dan tujuan tidak boleh sama');
  if (!b.lines.length && !b.serials.length) throw new AppError(400, 'Pilih minimal satu item atau aset (SN) yang dipindahkan');
  const u = req.user!;
  const out = await transact(async (fx) => {
    const [from, to] = await Promise.all([fx.tx.warehouse.findUnique({ where: { id: b.fromWarehouseId } }), fx.tx.warehouse.findUnique({ where: { id: b.toWarehouseId } })]);
    if (!from || !to) throw new AppError(404, 'Gudang tidak ditemukan');
    if (from.kind === 'MOBILE' || to.kind === 'MOBILE') throw new AppError(400, 'Gudang berjalan teknisi tidak dapat dipakai di sini — stok teknisi berubah lewat alur WO');
    if (!to.active) throw new AppError(400, `Gudang tujuan ${to.name} tidak aktif`);
    const number = await nextNumber(fx.tx, 'TRF');
    const reason = `Transfer ${number}: ${from.name} → ${to.name}${b.note ? ` (${b.note})` : ''}`;
    const merged = new Map<string, number>();
    for (const l of b.lines) merged.set(l.itemId, (merged.get(l.itemId) ?? 0) + l.qty);
    for (const [itemId, qty] of merged) {
      const item = await fx.tx.item.findUnique({ where: { id: itemId } });
      if (!item) throw new AppError(404, 'Item tidak ditemukan');
      if (item.tracked) throw new AppError(400, `${item.name} ber-serial — pindahkan lewat nomor serial (SN)`);
      await moveStock(fx.tx, { itemId, qty, from: from.id, to: to.id, reason, actorId: u.id });
    }
    const sns = [...new Set(b.serials.map(normSn))];
    for (const sn of sns) {
      const a = await fx.tx.asset.findUnique({ where: { serialNumber: sn } });
      if (!a) throw new AppError(404, `SN ${sn} tidak terdaftar`);
      if (a.warehouseId !== from.id) throw new AppError(409, `SN ${sn} tidak berada di ${from.name}`);
      if (a.customerId || ![...AVAILABLE, 'IN_USE'].includes(a.status)) throw new AppError(409, `SN ${sn} berstatus ${a.status} — hanya aset siap pakai / aset GA yang bisa dipindahkan`);
      await moveAsset(fx.tx, a, { status: a.status, toWarehouseId: to.id, reason, actorId: u.id });
    }
    await fx.notify({ roles: ['GA'], subject: `Transfer stok ${number}`, body: `${u.name} memindahkan ${merged.size} item & ${sns.length} aset: ${from.name} → ${to.name}.` });
    return { number, items: merged.size, assets: sns.length, from: from.name, to: to.name };
  });
  res.status(201).json(out);
});

// Stock opname: sesuaikan jumlah fisik item kuantitas (consumable) di sebuah gudang
inventoryRoutes.post('/stock/opname', stockRoles, async (req, res) => {
  const b = z.object({ warehouseId: z.string(), counts: z.array(z.object({ itemId: z.string(), counted: z.coerce.number().int().min(0) })).min(1) }).parse(req.body);
  const u = req.user!;
  const diffs = await transact(async (fx) => {
    const out = [];
    for (const c of b.counts) {
      const cur = (await fx.tx.stockLevel.findUnique({ where: { warehouseId_itemId: { warehouseId: b.warehouseId, itemId: c.itemId } } }))?.qty ?? 0;
      const d = c.counted - cur;
      if (d === 0) continue;
      await moveStock(fx.tx, d > 0 ? { itemId: c.itemId, qty: d, to: b.warehouseId, reason: 'Stock opname (+)', actorId: u.id } : { itemId: c.itemId, qty: -d, from: b.warehouseId, reason: 'Stock opname (−)', actorId: u.id });
      out.push({ itemId: c.itemId, before: cur, after: c.counted, diff: d });
    }
    if (out.length) await fx.notify({ roles: ['GA'], subject: 'Stock opname dengan selisih', body: `${u.name} melakukan opname, ${out.length} item berselisih.` });
    return out;
  });
  res.json({ diffs });
});

/* ── aset (ber-SN & GA) ── */
inventoryRoutes.get('/assets', requireFeature('inventory'), async (req, res) => {
  const q = z.object({ q: z.string().optional(), status: z.string().optional(), warehouseId: z.string().optional(), category: z.string().optional(), customerId: z.string().optional(), ids: z.string().optional(), idsOnly: z.string().optional(), limit: z.coerce.number().int().min(1).max(2000).default(200) }).parse(req.query);
  const term = q.q?.trim();
  // nama item/merk/tipe dicari di tabel kecil lebih dulu → filter ber-indeks (tanpa join per baris aset)
  const like = term ? { contains: term, mode: 'insensitive' as const } : undefined;
  const related = term
    ? await Promise.all([prisma.item.findMany({ where: { name: like }, select: { id: true }, take: 200 }), prisma.assetBrand.findMany({ where: { name: like }, select: { id: true }, take: 200 }), prisma.assetModel.findMany({ where: { name: like }, select: { id: true }, take: 200 })]).then(([i, b, m]) => ({ itemIds: i.map((x) => x.id), brandIds: b.map((x) => x.id), modelIds: m.map((x) => x.id) }))
    : { itemIds: [], brandIds: [], modelIds: [] };
  const where: any = {
    ...(q.ids ? { id: { in: q.ids.split(',').slice(0, 2000) } } : {}),
    ...(q.status ? { status: q.status as AssetStatus } : {}),
    ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
    ...(q.customerId ? { customerId: q.customerId } : {}),
    ...(q.category ? { item: { category: q.category as any } } : {}),
    ...(term ? { OR: [{ serialNumber: { contains: term, mode: 'insensitive' } }, { assetCode: { contains: term, mode: 'insensitive' } }, ...(related.itemIds.length ? [{ itemId: { in: related.itemIds } }] : []), ...(related.brandIds.length ? [{ brandId: { in: related.brandIds } }] : []), ...(related.modelIds.length ? [{ modelId: { in: related.modelIds } }] : [])] } : {}),
  };
  // semua id yang cocok filter (untuk "pilih semua hasil" lintas halaman, mis. cetak QR massal)
  if (q.idsOnly === '1') {
    const rows = await prisma.asset.findMany({ where, select: { id: true }, orderBy: { createdAt: 'desc' }, take: 5000 });
    return void res.json({ ids: rows.map((r) => r.id), capped: rows.length === 5000 });
  }
  const pp = pageParams(req, {
    sorts: { serialNumber: (d) => ({ serialNumber: d }), status: (d) => ({ status: d }), createdAt: (d) => ({ createdAt: d }), nextMaintenanceAt: (d) => ({ nextMaintenanceAt: d }), item: (d) => ({ item: { name: d } }) },
    defaultSort: { key: 'createdAt', dir: 'desc' },
    legacyLimit: q.limit,
  });
  const [rows, total] = await Promise.all([
    prisma.asset.findMany({ where, include: { item: true, warehouse: true, brand: true, model: true, customer: { select: { id: true, name: true, code: true } } }, orderBy: pp.orderBy, skip: pp.skip, take: pp.take }),
    countIf(pp, () => prisma.asset.count({ where })),
  ]);
  sendPage(res, pp, rows, total);
});

inventoryRoutes.get('/assets/pending-qc', requireFeature('inventory'), async (_req, res) => {
  res.json(await prisma.asset.findMany({ where: { status: 'RETURNED_PENDING_QC' }, include: { item: true, warehouse: true }, orderBy: { createdAt: 'asc' } }));
});

inventoryRoutes.get('/assets/by-serial/:sn', async (req, res) => {
  const a = await prisma.asset.findUnique({ where: { serialNumber: normSn(String(req.params.sn)) }, include: { item: true, warehouse: true, brand: true, model: true, customer: { select: { id: true, name: true, code: true } } } });
  if (!a) throw new AppError(404, 'SN tidak terdaftar');
  res.json(a);
});

export type MaintOpts = { needsMaintenance?: boolean; maintenanceIntervalDays?: number; plateNumber?: string; chassisNumber?: string };

export async function createAsset(tx: Tx, p: { itemId: string; serial?: string; warehouseId: string; status?: AssetStatus; actorId: string; reason: string; woId?: string; nextMaintenanceAt?: Date; notes?: string; brandId?: string; modelId?: string } & MaintOpts) {
  const item = await tx.item.findUnique({ where: { id: p.itemId } });
  if (!item || !item.tracked) throw new AppError(400, 'Item harus bertipe ber-SN (Perangkat Jaringan / Aset GA)');
  if (p.modelId) {
    const m = await tx.assetModel.findUnique({ where: { id: p.modelId } });
    if (!m || (p.brandId && m.brandId !== p.brandId)) throw new AppError(400, 'Tipe tidak sesuai dengan merk yang dipilih');
    p.brandId = m.brandId;
  }
  if (p.brandId && !(await tx.assetBrand.findUnique({ where: { id: p.brandId } }))) throw new AppError(400, 'Merk tidak valid');
  const assetCode = item.category === 'GA' ? await nextNumber(tx, 'GA', false) : null;
  const serialNumber = p.serial ? normSn(p.serial) : assetCode;
  if (!serialNumber) throw new AppError(400, 'Serial number wajib diisi');
  if (await tx.asset.findUnique({ where: { serialNumber } })) throw new AppError(409, `SN ${serialNumber} sudah terdaftar`);
  const asset = await tx.asset.create({
    data: { itemId: item.id, serialNumber, assetCode, warehouseId: p.warehouseId, status: p.status ?? 'IN_STOCK', needsMaintenance: !!p.needsMaintenance, maintenanceIntervalDays: p.needsMaintenance ? p.maintenanceIntervalDays ?? null : null,
      nextMaintenanceAt: p.nextMaintenanceAt ?? (p.needsMaintenance && p.maintenanceIntervalDays ? new Date(Date.now() + p.maintenanceIntervalDays * 86_400_000) : undefined),
      plateNumber: item.isVehicle ? p.plateNumber?.trim().toUpperCase() || null : null, chassisNumber: item.isVehicle ? p.chassisNumber?.trim().toUpperCase() || null : null,
      notes: p.notes, brandId: p.brandId ?? null, modelId: p.modelId ?? null },
  });
  await tx.stockMovement.create({ data: { itemId: item.id, assetId: asset.id, qty: 1, toWarehouseId: p.warehouseId, reason: p.reason, woId: p.woId, actorId: p.actorId } });
  return asset;
}

// Registrasi aset: Network Asset (bulk SN) atau GA (kode aset otomatis)
inventoryRoutes.post('/assets/register', stockRoles, async (req, res) => {
  const b = z
    .object({
      itemId: z.string(),
      warehouseId: z.string(),
      serials: z.array(z.string().min(1)).default([]),
      count: z.coerce.number().int().min(1).max(50).default(1), // GA tanpa SN: jumlah unit
      status: z.enum(['IN_STOCK', 'IN_USE']).optional(),
      nextMaintenanceAt: z.coerce.date().optional(),
      needsMaintenance: z.boolean().optional(),
      maintenanceIntervalDays: z.coerce.number().int().min(1, 'Minimal 1 hari').max(3650, 'Maksimal 3650 hari').optional(),
      plateNumber: z.string().trim().max(15, 'Maksimal 15 karakter').optional(),
      chassisNumber: z.string().trim().max(30, 'Maksimal 30 karakter').optional(),
      notes: z.string().max(500, 'Maksimal 500 karakter').optional(),
      brandId: z.string().optional(),
      modelId: z.string().optional(),
    })
    .parse(req.body);
  const u = req.user!;
  const created = await transact(async (fx) => {
    const item = await fx.tx.item.findUnique({ where: { id: b.itemId } });
    if (!item) throw new AppError(404, 'Item tidak ditemukan');
    const serials: (string | undefined)[] = b.serials.length ? b.serials : item.category === 'GA' ? Array.from({ length: b.count }, () => undefined) : [];
    if (!serials.length) throw new AppError(400, 'Isi minimal 1 serial number');
    if (item.isVehicle) {
      if (serials.length > 1) throw fieldError('count', 'Kendaraan didaftarkan satu per satu (plat & no. rangka unik)');
      if (!b.plateNumber) throw fieldError('plateNumber', 'Plat nomor wajib untuk kendaraan');
      if (await fx.tx.asset.findFirst({ where: { plateNumber: b.plateNumber.toUpperCase() } })) throw fieldError('plateNumber', `Plat ${b.plateNumber.toUpperCase()} sudah terdaftar`, 409);
      if (b.chassisNumber && (await fx.tx.asset.findFirst({ where: { chassisNumber: b.chassisNumber.toUpperCase() } }))) throw fieldError('chassisNumber', `No. rangka ${b.chassisNumber.toUpperCase()} sudah terdaftar`, 409);
    }
    const out = [];
    for (const s of serials) out.push(await createAsset(fx.tx, { itemId: b.itemId, serial: s, warehouseId: b.warehouseId, status: b.status, actorId: u.id, reason: 'Registrasi aset', nextMaintenanceAt: b.nextMaintenanceAt, needsMaintenance: b.needsMaintenance, maintenanceIntervalDays: b.maintenanceIntervalDays, plateNumber: b.plateNumber, chassisNumber: b.chassisNumber, notes: b.notes, brandId: b.brandId, modelId: b.modelId }));
    return out;
  });
  res.status(201).json(created);
});

inventoryRoutes.patch('/assets/:id', stockRoles, async (req, res) => {
  const id = String(req.params.id);
  const b = z
    .object({ serialNumber: z.string().min(2).transform(normSn), assetCode: z.string().min(2).nullable(), nextMaintenanceAt: z.coerce.date().nullable(), lastMaintenanceAt: z.coerce.date().nullable(), needsMaintenance: z.boolean(), maintenanceIntervalDays: z.coerce.number().int().min(1).max(3650).nullable(), plateNumber: z.string().trim().max(15).nullable(), chassisNumber: z.string().trim().max(30).nullable(), notes: z.string().max(500).nullable(), condition: z.string().nullable(), status: z.enum(['IN_STOCK', 'IN_USE', 'DAMAGED', 'SCRAP']), warehouseId: z.string(), brandId: z.string().nullable(), modelId: z.string().nullable() })
    .partial()
    .parse(req.body);
  const cur = await prisma.asset.findUnique({ where: { id } });
  if (!cur) throw new AppError(404, 'Aset tidak ditemukan');
  if (b.modelId) {
    const m = await prisma.assetModel.findUnique({ where: { id: b.modelId } });
    if (!m) throw new AppError(400, 'Tipe tidak valid');
    b.brandId = m.brandId;
  } else if (b.modelId === null && b.brandId === undefined) b.brandId = cur.brandId;
  res.json(await auditedUpdate(whoOf(req), 'aset', id, cur.serialNumber, changes(cur, b), (fx) => fx.tx.asset.update({ where: { id }, data: b })));
});
inventoryRoutes.delete('/assets/:id', stockRoles, async (req, res) => {
  const id = String(req.params.id);
  const a = await prisma.asset.findUnique({ where: { id }, include: { item: true } });
  if (!a) throw new AppError(404, 'Aset tidak ditemukan');
  if (a.status === 'INSTALLED') throw new AppError(409, 'Aset sedang terpasang di pelanggan — tarik dulu lewat WO Terminate');
  await auditedDelete(whoOf(req), 'aset', id, `${a.serialNumber} (${a.item.name})`, a as any, (fx) => fx.tx.asset.delete({ where: { id } }));
  res.json({ ok: true });
});

inventoryRoutes.post('/assets/qc', stockRoles, async (req, res) => {
  const b = z.object({ results: z.array(z.object({ serial: z.string(), result: z.enum(['GOOD', 'DAMAGED', 'SCRAP']), warehouseId: z.string().optional(), note: z.string().optional() })).min(1) }).parse(req.body);
  const u = req.user!;
  await transact((fx) => qcAssets(fx.tx, b.results, u.id));
  res.json({ ok: true });
});

/* ── purchase order & penerimaan ── */
inventoryRoutes.get('/purchase-orders', requireFeature('purchase_orders'), async (req, res) => {
  const term = req.query.q ? String(req.query.q).trim() : '';
  const status = req.query.status ? String(req.query.status) : undefined;
  const pp = pageParams(req, { sorts: { number: (d) => ({ number: d }), vendor: (d) => ({ vendor: d }), status: (d) => ({ status: d }), createdAt: (d) => ({ createdAt: d }) }, defaultSort: { key: 'createdAt', dir: 'desc' }, legacyLimit: 100 });
  const where = { ...(status ? { status } : {}), ...(term ? { OR: [{ number: { contains: term, mode: 'insensitive' as const } }, { vendor: { contains: term, mode: 'insensitive' as const } }] } : {}) };
  const [rows, total] = await Promise.all([
    prisma.purchaseOrder.findMany({ where, include: { lines: { include: { item: true } }, wo: { select: { id: true, number: true } } }, orderBy: pp.orderBy, skip: pp.skip, take: pp.take }),
    countIf(pp, () => prisma.purchaseOrder.count({ where })),
  ]);
  sendPage(res, pp, rows, total);
});
inventoryRoutes.get('/purchase-orders/:id', requireFeature('purchase_orders'), async (req, res) => {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: String(req.params.id) }, include: { lines: { include: { item: true } }, wo: { select: { id: true, number: true } }, pr: { select: { id: true, number: true, subject: true } } } });
  if (!po) throw new AppError(404, 'PO tidak ditemukan');
  const wh = await prisma.warehouse.findUnique({ where: { id: po.toWarehouseId } });
  res.json({ ...po, warehouse: wh });
});

// Penerimaan barang: QC lolos saja yang dimasukkan; item ber-SN wajib input SN → label QR
inventoryRoutes.post('/purchase-orders/:id/receive', stockRoles, async (req, res) => {
  const b = z.object({ lines: z.array(z.object({ lineId: z.string(), qty: z.coerce.number().int().min(0), serials: z.array(z.string()).default([]), brandId: z.string().optional(), modelId: z.string().optional(), needsMaintenance: z.boolean().optional(), maintenanceIntervalDays: z.coerce.number().int().min(1).max(3650).optional() })) }).parse(req.body);
  const u = req.user!;
  const result = await transact(async (fx) => {
    const po = await fx.tx.purchaseOrder.findUnique({ where: { id: String(req.params.id) }, include: { lines: { include: { item: true } } } });
    if (!po) throw new AppError(404, 'PO tidak ditemukan');
    if (po.status === 'RECEIVED') throw new AppError(409, 'PO sudah diterima penuh');
    const assets = [];
    for (const r of b.lines) {
      if (r.qty === 0) continue;
      const line = po.lines.find((l) => l.id === r.lineId);
      if (!line) throw new AppError(400, 'Baris PO tidak valid');
      if (r.qty > line.qty - line.receivedQty) throw new AppError(400, `${line.item.name}: melebihi sisa (${line.qty - line.receivedQty})`);
      if (line.item.tracked) {
        const needSerial = line.item.category !== 'GA';
        if (needSerial && r.serials.length !== r.qty) throw new AppError(400, `${line.item.name}: isi ${r.qty} serial number`);
        for (let k = 0; k < r.qty; k++)
          assets.push(await createAsset(fx.tx, { itemId: line.itemId, serial: r.serials[k], warehouseId: po.toWarehouseId, actorId: u.id, reason: `Penerimaan ${po.number}`, woId: po.woId ?? undefined, status: line.item.category === 'GA' ? 'IN_USE' : 'IN_STOCK', brandId: r.brandId, modelId: r.modelId, needsMaintenance: r.needsMaintenance, maintenanceIntervalDays: r.maintenanceIntervalDays }));
      } else {
        await moveStock(fx.tx, { itemId: line.itemId, qty: r.qty, to: po.toWarehouseId, reason: `Penerimaan ${po.number}`, woId: po.woId ?? undefined, actorId: u.id });
      }
      await fx.tx.poLine.update({ where: { id: line.id }, data: { receivedQty: { increment: r.qty } } });
    }
    const lines = await fx.tx.poLine.findMany({ where: { poId: po.id } });
    const complete = lines.every((l) => l.receivedQty >= l.qty);
    await fx.tx.purchaseOrder.update({ where: { id: po.id }, data: { status: complete ? 'RECEIVED' : 'PARTIAL' } });
    if (complete && po.woId) {
      // WO ditutup bila semua PO untuk WO ini sudah diterima dan semua baris stok di PR-nya sudah punya PO
      const openPo = await fx.tx.purchaseOrder.count({ where: { woId: po.woId, status: { not: 'RECEIVED' }, id: { not: po.id } } });
      const unassigned = po.prId ? await fx.tx.prLine.count({ where: { prId: po.prId, itemId: { not: null }, poLineId: null } }) : 0;
      if (!openPo && !unassigned) await applyAction(fx, po.woId, 'po_received', await systemActor(fx.tx), { note: `PO ${po.number} diterima lengkap` }, true);
    }
    return { complete, assets };
  });
  res.json(result);
});

inventoryRoutes.patch('/purchase-orders/:id', stockRoles, async (req, res) => {
  const id = String(req.params.id);
  const b = z.object({ vendor: z.string().min(2), note: z.string().nullable() }).partial().parse(req.body);
  const cur = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!cur) throw new AppError(404, 'PO tidak ditemukan');
  if (cur.status !== 'ISSUED') throw new AppError(409, 'PO yang sudah diterima (sebagian/penuh) tidak dapat diubah');
  res.json(await auditedUpdate(whoOf(req), 'PO', id, cur.number, changes(cur, b), (fx) => fx.tx.purchaseOrder.update({ where: { id }, data: b })));
});
inventoryRoutes.delete('/purchase-orders/:id', stockRoles, async (req, res) => {
  const id = String(req.params.id);
  const po = await prisma.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
  if (!po) throw new AppError(404, 'PO tidak ditemukan');
  if (po.status !== 'ISSUED' || po.lines.some((l) => l.receivedQty > 0)) throw new AppError(409, 'PO yang sudah ada penerimaannya tidak dapat dihapus');
  if (po.woId) {
    const wo = await prisma.workOrder.findUnique({ where: { id: po.woId } });
    if (wo && !wo.closedAt) throw new AppError(409, `PO terkait WO ${wo.number} yang masih berjalan — batalkan WO-nya dulu`);
  }
  await auditedDelete(whoOf(req), 'PO', id, `${po.number} (${po.vendor})`, { id, number: po.number, vendor: po.vendor }, (fx) => fx.tx.purchaseOrder.delete({ where: { id } }));
  res.json({ ok: true });
});
