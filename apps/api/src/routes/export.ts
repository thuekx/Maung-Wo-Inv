import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { AppError, prisma } from '../db';
import { config } from '../config';

/**
 * API baca-saja untuk menarik data keluar (BI, spreadsheet, sistem lain).
 * Auth: header `x-api-key` (atau `Authorization: Bearer <key>`) = EXPORT_API_KEY.
 * Dokumentasi: docs/API.md
 */
export const exportRoutes = Router();

const safeEq = (a: string, b: string) => {
  const A = Buffer.from(a), B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};

exportRoutes.use(
  '/export',
  rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }),
  (req, _res, next) => {
    if (!config.exportApiKey) throw new AppError(503, 'Export API nonaktif (EXPORT_API_KEY belum diisi)');
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
    const key = String(req.headers['x-api-key'] ?? bearer);
    if (!safeEq(key, config.exportApiKey)) throw new AppError(401, 'API key tidak valid');
    next();
  },
);

type Row = Record<string, unknown>;
interface Q { take: number; cursor?: string; since?: Date; include: Set<string> }
interface Resource {
  description: string;
  sinceField: 'createdAt' | 'updatedAt' | null; // null = resource tanpa kolom waktu, ?since diabaikan
  fetch: (q: Q) => Promise<Row[]>;
}

const page = (q: Q, sinceField: string) => ({
  take: q.take + 1, // +1 untuk mengetahui apakah masih ada halaman berikutnya
  orderBy: { id: 'asc' as const },
  ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  ...(q.since ? { where: { [sinceField]: { gte: q.since } } } : {}),
});

const resources: Record<string, Resource> = {
  customers: {
    description: 'Data pelanggan (kode, kontak, paket, status, ODP/port/VLAN/IP, tanggal aktivasi)',
    sinceField: 'createdAt',
    fetch: async (q) => {
      const rows = await prisma.customer.findMany({ ...page(q, 'createdAt'), include: { warehouse: { select: { code: true } }, area: { select: { name: true } } } });
      return rows.map(({ warehouse, area, ...c }) => ({ ...c, warehouseCode: warehouse?.code ?? null, areaName: area?.name ?? null }));
    },
  },
  subscriptions: {
    description: 'Formulir Berlangganan (Reg. No., tanggal, nama, telepon, paket, sumber, marketing, kode pelanggan, nomor WO). Tanpa data biaya.',
    sinceField: 'createdAt',
    fetch: async (q) => {
      // select eksplisit: kolom biaya (installFee/monthlyFee) dan data lain yang tidak diminta tidak pernah ikut keluar
      const rows = await prisma.subscription.findMany({
        ...page(q, 'createdAt'),
        select: { id: true, regNo: true, formDate: true, name: true, phone: true, packageName: true, source: true, marketingName: true, customerId: true, woId: true, createdAt: true },
      });
      const cids = [...new Set(rows.map((r) => r.customerId).filter((x): x is string => !!x))];
      const wids = [...new Set(rows.map((r) => r.woId).filter((x): x is string => !!x))];
      const [cs, ws] = await Promise.all([
        cids.length ? prisma.customer.findMany({ where: { id: { in: cids } }, select: { id: true, code: true } }) : [],
        wids.length ? prisma.workOrder.findMany({ where: { id: { in: wids } }, select: { id: true, number: true } }) : [],
      ]);
      const code = new Map(cs.map((c) => [c.id, c.code])), num = new Map(ws.map((w) => [w.id, w.number]));
      return rows.map(({ customerId, woId, ...s }) => ({ ...s, customerCode: customerId ? code.get(customerId) ?? null : null, woNumber: woId ? num.get(woId) ?? null : null }));
    },
  },
  'work-orders': {
    description: 'Work order beserta data form (JSON). Tambah ?include=events untuk riwayat transisi.',
    sinceField: 'updatedAt',
    fetch: async (q) => {
      const rows = await prisma.workOrder.findMany({
        ...page(q, 'updatedAt'),
        include: {
          customer: { select: { code: true, name: true } },
          createdBy: { select: { name: true } },
          assignee: { select: { name: true } },
          ...(q.include.has('events') ? { events: { orderBy: { createdAt: 'asc' as const } } } : {}),
        },
      });
      return rows.map(({ customer, createdBy, assignee, ...w }) => ({
        ...w,
        customerCode: customer?.code ?? null,
        customerName: customer?.name ?? null,
        createdByName: createdBy.name,
        assigneeName: assignee?.name ?? null,
      }));
    },
  },
  items: {
    description: 'Master barang/aset (SKU, kategori, satuan, tracked, stok minimum)',
    sinceField: null,
    fetch: async (q) => {
      const { where: _w, ...p } = page(q, 'createdAt'); // Item tidak punya createdAt
      return prisma.item.findMany(p);
    },
  },
  warehouses: {
    description: 'Gudang (pusat, cabang, mobile teknisi)',
    sinceField: null,
    fetch: async (q) => {
      const { where: _w, ...p } = page(q, 'createdAt');
      const rows = await prisma.warehouse.findMany({ ...p, include: { owner: { select: { name: true } } } });
      return rows.map(({ owner, ...w }) => ({ ...w, ownerName: owner?.name ?? null }));
    },
  },
  stock: {
    description: 'Posisi stok kuantitas per gudang per barang',
    sinceField: null,
    fetch: async (q) => {
      const { where: _w, ...p } = page(q, 'createdAt');
      const rows = await prisma.stockLevel.findMany({ ...p, include: { item: { select: { sku: true, name: true, unit: true, minStock: true } }, warehouse: { select: { code: true, name: true, kind: true } } } });
      return rows.map(({ item, warehouse, ...s }) => ({ ...s, sku: item.sku, itemName: item.name, unit: item.unit, minStock: item.minStock, warehouseCode: warehouse.code, warehouseName: warehouse.name, warehouseKind: warehouse.kind }));
    },
  },
  assets: {
    description: 'Aset ber-serial number (status, lokasi, pelanggan, jadwal maintenance)',
    sinceField: 'createdAt',
    fetch: async (q) => {
      const rows = await prisma.asset.findMany({ ...page(q, 'createdAt'), include: { item: { select: { sku: true, name: true, category: true } }, warehouse: { select: { code: true } }, customer: { select: { code: true, name: true } }, brand: { select: { name: true } }, model: { select: { name: true } } } });
      return rows.map(({ item, warehouse, customer, brand, model, ...a }) => ({ ...a, brand: brand?.name ?? null, model: model?.name ?? null, sku: item.sku, itemName: item.name, category: item.category, warehouseCode: warehouse?.code ?? null, customerCode: customer?.code ?? null, customerName: customer?.name ?? null }));
    },
  },
  movements: {
    description: 'Riwayat mutasi stok/aset',
    sinceField: 'createdAt',
    fetch: async (q) => prisma.stockMovement.findMany(page(q, 'createdAt')),
  },
  'purchase-orders': {
    description: 'Purchase order beserta baris barang',
    sinceField: 'createdAt',
    fetch: async (q) => prisma.purchaseOrder.findMany({ ...page(q, 'createdAt'), include: { lines: { include: { item: { select: { sku: true, name: true } } } } } }),
  },
};

const query = z.object({
  format: z.enum(['json', 'csv']).default('json'),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
  cursor: z.string().min(1).optional(),
  since: z.coerce.date().optional(),
  include: z.string().optional(),
});

/** Ratakan objek bersarang → kolom bertitik; array/JSON dijadikan string JSON. */
function flatten(o: Row, prefix = '', out: Row = {}): Row {
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v instanceof Date) out[key] = v.toISOString();
    else if (Array.isArray(v)) out[key] = JSON.stringify(v);
    else if (v && typeof v === 'object') flatten(v as Row, key, out);
    else out[key] = v;
  }
  return out;
}
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // cegah CSV/formula injection saat dibuka di Excel
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
function toCsv(rows: Row[]) {
  const flat = rows.map((r) => flatten(r));
  const cols = [...new Set(flat.flatMap((r) => Object.keys(r)))];
  return '﻿' + [cols.join(','), ...flat.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';
}

exportRoutes.get('/export', (_req, res) => {
  res.json({
    resources: Object.fromEntries(Object.entries(resources).map(([k, r]) => [k, { path: `/api/export/${k}`, description: r.description, sinceField: r.sinceField }])),
    params: { format: 'json|csv', limit: '1..5000 (default 1000)', cursor: 'nextCursor dari respons sebelumnya', since: 'ISO date; filter createdAt/updatedAt >= nilai', include: 'khusus work-orders: events' },
  });
});

exportRoutes.get('/export/:resource', async (req: Request, res: Response) => {
  const r = resources[String(req.params.resource)];
  if (!r) throw new AppError(404, `Resource tidak dikenal. Daftar: ${Object.keys(resources).join(', ')}`);
  const p = query.parse(req.query);
  const rows = await r.fetch({ take: p.limit, cursor: p.cursor, since: p.since, include: new Set((p.include ?? '').split(',').filter(Boolean)) });
  const hasMore = rows.length > p.limit;
  const data = hasMore ? rows.slice(0, p.limit) : rows;
  const nextCursor = hasMore ? (data[data.length - 1].id as string) : null;

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Next-Cursor', nextCursor ?? '');
  if (p.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.resource}.csv"`);
    return void res.send(toCsv(data));
  }
  res.json({ resource: req.params.resource, count: data.length, nextCursor, generatedAt: new Date().toISOString(), data });
});
