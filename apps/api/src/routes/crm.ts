import { Router, Request } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { AppError, prisma } from '../db';
import { config } from '../config';

/**
 * Pintu masuk tulis dari aplikasi CRM (Tahap 2a): katalog jasa/produk dan penawaran.
 * Auth: header `x-api-key` (atau `Authorization: Bearer`) = CRM_INTEGRATION_KEY — terpisah dari EXPORT_API_KEY (kunci export tidak boleh bisa menulis).
 * Idempoten menurut crmId. Tidak menyentuh tabel pelanggan/WO (itu Tahap 2b, saat status WON).
 * Dokumentasi: docs/API.md, docs/USULAN-SERVICE-ORDER.md
 */
export const crmRoutes = Router();

const safeEq = (a: string, b: string) => {
  const A = Buffer.from(a), B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};

crmRoutes.use(
  '/integrations/crm',
  rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }),
  (req, _res, next) => {
    if (!config.crmIntegrationKey) throw new AppError(503, 'Integrasi CRM nonaktif (CRM_INTEGRATION_KEY belum diisi)');
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
    if (!safeEq(String(req.headers['x-api-key'] ?? bearer), config.crmIntegrationKey)) throw new AppError(401, 'API key tidak valid');
    next();
  },
);

const blank = (v: unknown) => (v === '' || v === null ? undefined : v);
const optStr = (max: number) => z.preprocess(blank, z.string().trim().max(max).optional());
const optDate = z.preprocess(blank, z.coerce.date().optional());
const idParam = (req: Request) => z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/, 'crmId hanya huruf, angka, . _ : -').parse(req.params.crmId);

/** Jejak audit bersumber CRM (tanpa pengguna WO). */
const audit = (tx: any, p: { action: 'CREATE' | 'UPDATE'; entity: string; entityId: string; summary: string; before?: object; after?: object }) =>
  tx.auditLog.create({ data: { userName: 'CRM', role: 'CRM', action: p.action, entity: p.entity, entityId: p.entityId, summary: p.summary, before: p.before as any, after: p.after as any } });

/* ───────────────────────── katalog ───────────────────────── */

const catalogBody = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(['SERVICE', 'PRODUCT']),
  unit: optStr(20),
  priceSell: z.preprocess(blank, z.coerce.number().min(0).max(1e12).optional()),
  active: z.boolean().default(true),
  description: optStr(200),
  sku: optStr(60), // PRODUCT: SKU barang di Master Barang (opsional; tanpa SKU = dipetakan manual oleh Marketing/Admin)
});

crmRoutes.put('/integrations/crm/catalog/:crmId', async (req, res) => {
  const crmId = idParam(req);
  const b = catalogBody.parse(req.body);
  const own = await prisma.package.findUnique({ where: { crmId } });
  const byName = await prisma.package.findUnique({ where: { name: b.name } });
  // nama sudah dipakai paket lain (MSRadius/manual/katalog CRM lain) → jangan pernah menimpa
  if (byName && byName.id !== own?.id) throw new AppError(409, `Nama "${b.name}" sudah dipakai paket lain (${byName.source}${byName.crmId ? ', katalog CRM lain' : ''}) — gunakan nama berbeda`);
  const data = { name: b.name, kind: b.kind, unit: b.unit ?? null, priceSell: b.priceSell ?? null, active: b.active, description: b.description ?? null, sku: b.sku ?? null, source: 'CRM' };
  const item = b.sku ? await prisma.item.findUnique({ where: { sku: b.sku }, select: { id: true, name: true } }) : null;
  const out = await prisma.$transaction(async (tx) => {
    if (own) {
      const row = await tx.package.update({ where: { id: own.id }, data });
      await audit(tx, { action: 'UPDATE', entity: 'paket', entityId: row.id, summary: `CRM memperbarui katalog ${row.name}` });
      return { row, created: false };
    }
    const row = await tx.package.create({ data: { ...data, crmId, sortOrder: 200 } });
    await audit(tx, { action: 'CREATE', entity: 'paket', entityId: row.id, summary: `CRM menambah katalog ${row.name} (${b.kind})` });
    return { row, created: true };
  });
  res.status(out.created ? 201 : 200).json({ ok: true, packageId: out.row.id, created: out.created, kind: out.row.kind, ...(b.sku ? { skuFound: !!item, itemName: item?.name ?? null } : {}) });
});

/* ───────────────────────── penawaran ───────────────────────── */

const lineZ = z.object({
  catalogCrmId: optStr(64),
  name: z.string().trim().min(1).max(160),
  kind: z.enum(['SERVICE', 'PRODUCT']),
  qty: z.coerce.number().positive().max(1e6),
  unit: optStr(20),
  unitPrice: z.coerce.number().min(0).max(1e12),
  note: optStr(300),
  sku: optStr(60),
});

const quotationBody = z.object({
  number: z.string().trim().min(1).max(60),
  rev: z.coerce.number().int().min(1).max(9999),
  status: z.enum(['QUOTED', 'WON', 'LOST']),
  validUntil: optDate,
  sentAt: optDate,
  decidedAt: optDate,
  lostReason: optStr(300),
  customer: z.object({
    code: optStr(40), // kode pelanggan WO bila Lead untuk pelanggan existing; kosong = pelanggan baru
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(6).max(24).regex(/^[0-9+][0-9 +()-]*$/, 'Hanya angka, spasi, + ( ) -'),
    email: z.preprocess(blank, z.string().email().max(120).optional()),
    address: z.string().trim().min(5).max(300),
    lat: z.preprocess(blank, z.coerce.number().min(-90).max(90).optional()),
    lng: z.preprocess(blank, z.coerce.number().min(-180).max(180).optional()),
    areaCode: optStr(40),
    picName: optStr(120),
  }),
  marketingUserId: optStr(64), // id pengguna WO (dari /api/auth/me saat login CRM) — pencocokan pasti
  marketingName: optStr(120),
  lines: z.array(lineZ).min(1).max(100),
  total: z.coerce.number().min(0).max(1e13),
  taxNote: optStr(200),
  terms: optStr(2000),
});

const view = (q: any) => ({ quotationId: q.id, crmId: q.crmId, number: q.number, rev: q.rev, status: q.status, woNumber: null as string | null });

crmRoutes.put('/integrations/crm/quotations/:crmId', async (req, res) => {
  const crmId = idParam(req);
  const b = quotationBody.parse(req.body);
  const cur = await prisma.crmQuotation.findUnique({ where: { crmId } });

  // idempoten / urutan revisi
  if (cur) {
    if (b.rev < cur.rev) return void res.json({ ok: true, stale: true, ...view(cur) });
    if (cur.status === 'WON' && (b.rev > cur.rev || b.status !== 'WON')) throw new AppError(409, `Penawaran ${cur.number} sudah WON dan terkunci — perubahan lingkup dibuat sebagai penawaran baru`);
    if (b.rev === cur.rev && b.status === cur.status) return void res.json({ ok: true, duplicate: true, ...view(cur) });
    if (b.rev === cur.rev && cur.status === 'LOST') throw new AppError(409, `Penawaran ${cur.number} sudah LOST pada revisi ${cur.rev} — kirim revisi lebih tinggi untuk membukanya lagi`);
  }

  // pelanggan existing: kode harus ada (kode tak dikenal → 404 agar CRM menandai gagal, bukan membuat duplikat)
  if (b.customer.code && !(await prisma.customer.findUnique({ where: { code: b.customer.code }, select: { id: true } })))
    throw new AppError(404, `Pelanggan ${b.customer.code} tidak ditemukan di WO`);

  // pemasaran: pencocokan pasti lewat id pengguna WO; tak cocok/ nonaktif/ bukan MKT → antrean MKT (diputuskan di Tahap 2b)
  const mkt = b.marketingUserId ? await prisma.user.findUnique({ where: { id: b.marketingUserId }, select: { id: true, role: true, active: true } }) : null;
  const marketingMatched = !!mkt && mkt.active && mkt.role === 'MKT';

  // katalog & SKU → pemetaan barang otomatis (dapat diubah Marketing/Admin di Tahap 2b)
  const crmIds = [...new Set(b.lines.map((l) => l.catalogCrmId).filter((x): x is string => !!x))];
  const known = crmIds.length ? await prisma.package.findMany({ where: { crmId: { in: crmIds } }, select: { crmId: true, sku: true } }) : [];
  const knownIds = new Set(known.map((k) => k.crmId));
  const catSku = new Map(known.map((k) => [k.crmId!, k.sku]));
  const withSku = b.lines.map((l) => ({ ...l, sku: l.sku ?? (l.catalogCrmId ? catSku.get(l.catalogCrmId) ?? undefined : undefined) ?? null })); // SKU baris menang atas SKU katalog
  const skus = [...new Set(withSku.map((l) => l.sku).filter((x): x is string => !!x))];
  const itemBySku = new Map((skus.length ? await prisma.item.findMany({ where: { sku: { in: skus } }, select: { id: true, sku: true } }) : []).map((i) => [i.sku, i.id]));
  const lines = withSku.map((l) => ({ ...l, itemId: l.sku ? itemBySku.get(l.sku) ?? null : null }));
  const warnings = {
    marketingMatched,
    unknownCatalog: crmIds.filter((x) => !knownIds.has(x)),
    skuNotFound: lines.filter((l) => l.kind === 'PRODUCT' && l.sku && !l.itemId).map((l) => l.sku),
    areaNotFound: b.customer.areaCode ? !(await prisma.area.findFirst({ where: { code: b.customer.areaCode } })) : false,
  };

  const { code, ...cust } = b.customer;
  const data = {
    number: b.number, rev: b.rev, status: b.status, validUntil: b.validUntil ?? null, sentAt: b.sentAt ?? null, decidedAt: b.decidedAt ?? null,
    lostReason: b.lostReason ?? null, customerCode: code ?? null, customer: cust as any,
    marketingUserId: marketingMatched ? mkt!.id : null, marketingName: b.marketingName ?? null,
    lines: lines as any, total: b.total, taxNote: b.taxNote ?? null, terms: b.terms ?? null,
  };
  const row = await prisma.$transaction(async (tx) => {
    const r = cur ? await tx.crmQuotation.update({ where: { id: cur.id }, data }) : await tx.crmQuotation.create({ data: { ...data, crmId } });
    await audit(tx, { action: cur ? 'UPDATE' : 'CREATE', entity: 'penawaran CRM', entityId: r.id, summary: `CRM ${cur ? 'memperbarui' : 'mengirim'} penawaran ${r.number} rev ${r.rev} (${r.status})`, before: cur ? { rev: cur.rev, status: cur.status } : undefined, after: { rev: r.rev, status: r.status, total: b.total } });
    return r;
  });
  res.status(cur ? 200 : 201).json({ ok: true, ...view(row), warnings });
});

crmRoutes.get('/integrations/crm/quotations/:crmId', async (req, res) => {
  const q = await prisma.crmQuotation.findUnique({ where: { crmId: idParam(req) } });
  if (!q) throw new AppError(404, 'Penawaran tidak ditemukan');
  res.json(view(q));
});
