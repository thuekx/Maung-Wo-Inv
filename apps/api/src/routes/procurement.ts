import { Router } from 'express';
import { z } from 'zod';
import { AppError, fieldError, prisma, Tx } from '../db';
import { actorOf, authenticate, requireRole } from '../auth';
import { transact } from '../effects';
import { isLead } from '../wf-types';
import { auditedDelete, auditedUpdate, changes, whoOf, writeAudit } from '../audit';
import { countIf, pageParams, sendPage } from '../paging';
import { DOCS_DEFAULTS, getDocs, getSetting, putSetting } from '../settings';
import { areaAlias } from '../docnum';

/** Pengadaan: master vendor, Purchase Request (perbandingan harga ≥ N vendor, PDF), pencatatan PO dari Accurate. */
export const procurementRoutes = Router();
procurementRoutes.use(authenticate);

const gaOnly = requireRole('GA');
const nul = (v: unknown) => (v === '' ? null : v);
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/* ═════════ Pengaturan dokumen ═════════ */
procurementRoutes.get('/settings/docs', async (_req, res) => res.json(await getDocs()));
procurementRoutes.put('/admin/settings/docs', requireRole('ADMIN'), async (req, res) => {
  const b = z.object({
    codePrefix: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9/.{}-]+$/, 'Hanya huruf, angka, / . - dan {ALIAS}'),
    city: z.string().trim().min(2).max(60),
    taxPct: z.coerce.number().min(0).max(100),
    seqStart: z.coerce.number().int().min(1).max(999999),
    minVendors: z.coerce.number().int().min(1).max(5),
  }).parse(req.body);
  await putSetting('docs', b, req.user!.id);
  res.json(await getDocs());
});

/* ═════════ Master vendor ═════════ */
const vendorBody = z.object({
  name: z.string().trim().min(2).max(120, 'Maksimal 120 karakter'),
  contactName: z.preprocess(nul, z.string().trim().max(80).nullable().optional()),
  phone: z.preprocess(nul, z.string().trim().max(30).nullable().optional()),
  email: z.preprocess(nul, z.string().email('Format email tidak valid').max(120).nullable().optional()),
  address: z.preprocess(nul, z.string().trim().max(300).nullable().optional()),
  notes: z.preprocess(nul, z.string().trim().max(300).nullable().optional()),
  active: z.boolean().optional(),
});
procurementRoutes.get('/vendors', async (req, res) => {
  const all = req.query.all === '1';
  res.json(await prisma.vendor.findMany({ where: all ? {} : { active: true }, orderBy: { name: 'asc' } }));
});
procurementRoutes.post('/vendors', gaOnly, async (req, res) => {
  const b = vendorBody.parse(req.body);
  if (await prisma.vendor.findFirst({ where: { name: { equals: b.name, mode: 'insensitive' } } })) throw fieldError('name', `Vendor "${b.name}" sudah ada`, 409);
  const who = whoOf(req);
  res.status(201).json(await transact(async (fx) => {
    const v = await fx.tx.vendor.create({ data: b as any });
    await writeAudit(fx, who, { action: 'CREATE', entity: 'vendor', entityId: v.id, summary: `${who.name} menambah vendor ${v.name}` });
    return v;
  }));
});
procurementRoutes.patch('/vendors/:id', gaOnly, async (req, res) => {
  const id = String(req.params.id);
  const b = vendorBody.partial().parse(req.body);
  const cur = await prisma.vendor.findUnique({ where: { id } });
  if (!cur) throw new AppError(404, 'Vendor tidak ditemukan');
  if (b.name && b.name !== cur.name && (await prisma.vendor.findFirst({ where: { name: { equals: b.name, mode: 'insensitive' }, id: { not: id } } }))) throw fieldError('name', `Vendor "${b.name}" sudah ada`, 409);
  res.json(await auditedUpdate(whoOf(req), 'vendor', id, cur.name, changes(cur, b), (fx) => fx.tx.vendor.update({ where: { id }, data: b as any })));
});
procurementRoutes.delete('/vendors/:id', gaOnly, async (req, res) => {
  const id = String(req.params.id);
  const v = await prisma.vendor.findUnique({ where: { id }, include: { _count: { select: { quotes: true, pos: true } } } });
  if (!v) throw new AppError(404, 'Vendor tidak ditemukan');
  if (v._count.quotes || v._count.pos) throw new AppError(409, `Vendor dipakai di ${v._count.quotes} penawaran / ${v._count.pos} PO — nonaktifkan saja (centang "Nonaktif") agar riwayat tetap utuh`);
  await auditedDelete(whoOf(req), 'vendor', id, v.name, { id, name: v.name }, (fx) => fx.tx.vendor.delete({ where: { id } }));
  res.json({ ok: true });
});

/* ═════════ Purchase Request ═════════ */
const canCreatePr = (u: { role: string; subRole?: string | null }) => u.role === 'ADMIN' || u.role === 'GA' || isLead({ id: '', name: '', role: u.role as any, subRole: u.subRole as any });
const isGa = (u: { role: string }) => u.role === 'ADMIN' || u.role === 'GA';

const lineBody = z.object({
  description: z.string().trim().min(2, 'Deskripsi minimal 2 karakter').max(200, 'Maksimal 200 karakter'),
  qty: z.coerce.number().int('Qty harus bilangan bulat').min(1, 'Qty minimal 1').max(1_000_000),
  unit: z.string().trim().min(1).max(20).default('Unit'),
  itemId: z.preprocess(nul, z.string().nullable().optional()),
  note: z.preprocess(nul, z.string().trim().max(200).nullable().optional()),
  quotes: z.array(z.object({
    vendorId: z.string().min(1),
    unitPrice: z.coerce.number().min(0, 'Harga tidak boleh negatif').max(1e12),
    note: z.preprocess(nul, z.string().trim().max(200).nullable().optional()),
    chosen: z.boolean().optional(),
  })).max(10).default([]),
});
const prBody = z.object({
  subject: z.string().trim().min(3, 'Perihal minimal 3 karakter').max(200, 'Maksimal 200 karakter'),
  taxPct: z.coerce.number().min(0).max(100).optional(),
  note: z.preprocess(nul, z.string().trim().max(500).nullable().optional()),
  woId: z.preprocess(nul, z.string().nullable().optional()),
  areaId: z.preprocess(nul, z.string().nullable().optional()),
  lines: z.array(lineBody).min(1, 'Minimal 1 baris').max(100),
});

const num = (d: unknown) => Number(d ?? 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

const prInclude = {
  createdBy: { select: { id: true, name: true, role: true, subRole: true } },
  wo: { select: { id: true, number: true } },
  area: { select: { id: true, name: true, alias: true } },
  lines: { orderBy: { sort: 'asc' as const }, include: { quotes: { include: { vendor: { select: { id: true, name: true } } } }, item: { select: { id: true, name: true, unit: true } } } },
  pos: { select: { id: true, number: true, status: true, vendor: true } },
};

/** Ringkasan nominal berdasarkan penawaran yang dipilih. */
function totalsOf(pr: { taxPct: unknown; lines: { qty: number; quotes: { chosen: boolean; unitPrice: unknown }[] }[] }) {
  const subtotal = round2(pr.lines.reduce((n, l) => n + l.qty * num(l.quotes.find((q) => q.chosen)?.unitPrice), 0));
  const tax = round2((subtotal * num(pr.taxPct)) / 100);
  return { subtotal, tax, grandTotal: round2(subtotal + tax) };
}

const decorate = (pr: any) => ({ ...pr, totals: totalsOf(pr) });

procurementRoutes.get('/purchase-requests', async (req, res) => {
  const u = req.user!;
  const q = z.object({ q: z.string().optional(), status: z.string().optional() }).parse(req.query);
  const pp = pageParams(req, { sorts: { number: (d) => ({ number: d }), subject: (d) => ({ subject: d }), status: (d) => ({ status: d }), createdAt: (d) => ({ createdAt: d }) }, defaultSort: { key: 'createdAt', dir: 'desc' }, legacyLimit: 100 });
  const see = ['ADMIN', 'GA', 'FIN'].includes(u.role) ? {} : { createdById: u.id };
  const term = q.q?.trim();
  const where = { ...see, ...(q.status ? { status: q.status } : {}), ...(term ? { OR: [{ number: { contains: term, mode: 'insensitive' as const } }, { subject: { contains: term, mode: 'insensitive' as const } }] } : {}) };
  const [rows, total] = await Promise.all([
    prisma.purchaseRequest.findMany({ where, include: { createdBy: { select: { name: true } }, lines: { include: { quotes: true } } }, orderBy: pp.orderBy, skip: pp.skip, take: pp.take }),
    countIf(pp, () => prisma.purchaseRequest.count({ where })),
  ]);
  sendPage(res, pp, rows.map((r) => ({ ...r, lines: undefined, lineCount: r.lines.length, totals: totalsOf(r) })), total);
});

async function loadPr(id: string) {
  const pr = await prisma.purchaseRequest.findUnique({ where: { id }, include: prInclude });
  if (!pr) throw new AppError(404, 'Purchase Request tidak ditemukan');
  return pr;
}
function assertCanView(pr: { createdById: string }, u: { id: string; role: string }) {
  if (!['ADMIN', 'GA', 'FIN'].includes(u.role) && pr.createdById !== u.id) throw new AppError(403, 'Anda tidak berhak melihat PR ini');
}

procurementRoutes.get('/purchase-requests/:id', async (req, res) => {
  const pr = await loadPr(String(req.params.id));
  assertCanView(pr, req.user!);
  res.json({ ...decorate(pr), docs: await getDocs() });
});

async function writeLines(tx: Tx, prId: string, lines: z.infer<typeof lineBody>[]) {
  for (const [i, l] of lines.entries()) {
    if (l.itemId && !(await tx.item.findUnique({ where: { id: l.itemId } }))) throw fieldError('lines', `Item ${i + 1}: item tidak ditemukan`);
    const vendorIds = l.quotes.map((x) => x.vendorId);
    if (new Set(vendorIds).size !== vendorIds.length) throw fieldError('lines', `Item ${i + 1}: vendor yang sama dimasukkan dua kali`);
    if (vendorIds.length && (await tx.vendor.count({ where: { id: { in: vendorIds } } })) !== vendorIds.length) throw fieldError('lines', `Item ${i + 1}: vendor tidak ditemukan`);
    if (l.quotes.filter((x) => x.chosen).length > 1) throw fieldError('lines', `Item ${i + 1}: hanya satu vendor yang boleh dipilih`);
    await tx.prLine.create({
      data: { prId, sort: i, description: l.description, qty: l.qty, unit: l.unit, itemId: l.itemId ?? null, note: l.note ?? null, quotes: { create: l.quotes.map((x) => ({ vendorId: x.vendorId, unitPrice: x.unitPrice, note: x.note ?? null, chosen: !!x.chosen })) } },
    });
  }
}

procurementRoutes.post('/purchase-requests', async (req, res) => {
  const u = req.user!;
  if (!canCreatePr(u)) throw new AppError(403, 'Purchase Request hanya dapat dibuat oleh supervisor/manager atau GA/Procurement');
  const b = prBody.parse(req.body);
  const docs = await getDocs();
  const who = whoOf(req);
  const ga = isGa(u);
  if (b.areaId && !(await prisma.area.findUnique({ where: { id: b.areaId } }))) throw fieldError('areaId', 'Area tidak ditemukan');
  const out = await transact(async (fx) => {
    const pr = await fx.tx.purchaseRequest.create({ data: { subject: b.subject, city: docs.city, taxPct: ga ? b.taxPct ?? docs.taxPct : docs.taxPct, note: b.note ?? null, woId: b.woId ?? null, areaId: b.areaId ?? null, createdById: u.id } });
    // perbandingan vendor & PPN adalah ranah GA/Procurement: pengaju lain hanya mengisi barang
    await writeLines(fx.tx, pr.id, ga ? b.lines : b.lines.map((l) => ({ ...l, quotes: [] })));
    await writeAudit(fx, who, { action: 'CREATE', entity: 'purchase request', entityId: pr.id, summary: `${who.name} membuat draft PR "${b.subject}"` });
    return pr;
  });
  res.status(201).json({ id: out.id });
});

procurementRoutes.put('/purchase-requests/:id', async (req, res) => {
  const u = req.user!;
  const id = String(req.params.id);
  const b = prBody.parse(req.body);
  const cur = await loadPr(id);
  const mine = cur.createdById === u.id && cur.status === 'DRAFT';
  const ga = isGa(u) && ['DRAFT', 'SUBMITTED'].includes(cur.status);
  if (!mine && !ga) throw new AppError(403, cur.status === 'DRAFT' || cur.status === 'SUBMITTED' ? 'Hanya pembuat (saat draft) atau GA yang dapat mengubah PR' : 'PR yang sudah diterbitkan tidak dapat diubah');
  if (b.areaId && !(await prisma.area.findUnique({ where: { id: b.areaId } }))) throw fieldError('areaId', 'Area tidak ditemukan');
  const ga2 = isGa(u);
  await transact(async (fx) => {
    await fx.tx.purchaseRequest.update({ where: { id }, data: { subject: b.subject, taxPct: ga2 ? b.taxPct ?? undefined : undefined, note: b.note ?? null, ...(b.areaId !== undefined ? { areaId: b.areaId } : {}) } });
    // pengaju non-GA tidak mengubah perbandingan vendor yang mungkin sudah diisi GA: pertahankan penawaran per baris yang sama
    const keep = ga2 ? null : new Map(cur.lines.map((l) => [`${l.description}|${l.qty}`, l.quotes]));
    await fx.tx.prLine.deleteMany({ where: { prId: id } });
    await writeLines(fx.tx, id, b.lines.map((l) => (ga2 ? l : { ...l, quotes: (keep!.get(`${l.description}|${l.qty}`) ?? []).map((q) => ({ vendorId: q.vendorId, unitPrice: Number(q.unitPrice), note: q.note, chosen: q.chosen })) })));
  });
  res.json({ ok: true });
});

procurementRoutes.delete('/purchase-requests/:id', async (req, res) => {
  const u = req.user!;
  const id = String(req.params.id);
  const cur = await loadPr(id);
  if (!['DRAFT', 'SUBMITTED'].includes(cur.status)) throw new AppError(409, 'PR yang sudah diterbitkan tidak dapat dihapus — batalkan saja');
  if (cur.createdById !== u.id && !isGa(u)) throw new AppError(403, 'Hanya pembuat atau GA yang dapat menghapus draft PR');
  await auditedDelete(whoOf(req), 'purchase request', id, cur.subject, { id, subject: cur.subject, status: cur.status }, (fx) => fx.tx.purchaseRequest.delete({ where: { id } }));
  res.json({ ok: true });
});

/** Validasi kelengkapan sebelum diajukan/diterbitkan: tiap baris ≥ N vendor, tepat satu dipilih, harga > 0. */
async function assertComplete(pr: Awaited<ReturnType<typeof loadPr>>) {
  const { minVendors } = await getDocs();
  for (const [i, l] of pr.lines.entries()) {
    const n = `Item ${i + 1} (${l.description})`;
    if (l.quotes.length < minVendors) throw fieldError('lines', `${n}: minimal ${minVendors} vendor untuk perbandingan harga (baru ${l.quotes.length})`);
    if (l.quotes.some((q) => num(q.unitPrice) <= 0)) throw fieldError('lines', `${n}: harga vendor harus lebih dari 0`);
    if (l.quotes.filter((q) => q.chosen).length !== 1) throw fieldError('lines', `${n}: pilih tepat satu vendor`);
  }
}

procurementRoutes.post('/purchase-requests/:id/submit', async (req, res) => {
  const u = req.user!;
  const id = String(req.params.id);
  const pr = await loadPr(id);
  if (pr.status !== 'DRAFT') throw new AppError(409, 'Hanya draft yang dapat diajukan');
  if (pr.createdById !== u.id && !isGa(u)) throw new AppError(403, 'Hanya pembuat yang dapat mengajukan');
  await transact(async (fx) => {
    await fx.tx.purchaseRequest.update({ where: { id }, data: { status: 'SUBMITTED' } });
    await fx.notify({ roles: ['GA'], subject: `[PR] Pengajuan baru: ${pr.subject}`, body: `${u.name} mengajukan Purchase Request "${pr.subject}".\nSilakan periksa, lalu terbitkan PDF-nya.` });
  });
  res.json({ ok: true });
});

/** GA/Procurement menerbitkan PDF: mengisi penandatangan, nomor surat dibuat otomatis. Dapat diulang untuk mengganti penandatangan. */
procurementRoutes.post('/purchase-requests/:id/issue', gaOnly, async (req, res) => {
  const id = String(req.params.id);
  const b = z.object({
    signRequester: z.string().trim().min(2, 'Nama pengaju wajib diisi').max(80),
    signRequesterTitle: z.preprocess(nul, z.string().trim().max(60).nullable().optional()),
    signKnow: z.string().trim().min(2, 'Nama "Mengetahui" wajib diisi').max(80),
    signApprove: z.string().trim().min(2, 'Nama "Menyetujui" wajib diisi').max(80),
    docDate: z.coerce.date().optional(),
  }).parse(req.body);
  const pr = await loadPr(id);
  if (!['DRAFT', 'SUBMITTED', 'ISSUED'].includes(pr.status)) throw new AppError(409, 'PR ini sudah diproses lebih lanjut');
  await assertComplete(pr);
  const docs = await getDocs();
  if (!pr.number && docs.codePrefix.includes('{ALIAS}') && !pr.areaId) throw fieldError('areaId', 'Pilih area PR dulu (menu Ubah → Area) — singkatan area dipakai pada nomor surat');
  const prefix = docs.codePrefix.replace('{ALIAS}', areaAlias(pr.area));
  const who = whoOf(req);
  await transact(async (fx) => {
    let number = pr.number;
    const date = b.docDate ?? pr.docDate ?? new Date();
    if (!number) {
      const key = `PRDOC-${date.getFullYear()}`;
      const c = await fx.tx.counter.upsert({ where: { key }, create: { key, value: docs.seqStart }, update: { value: { increment: 1 } } });
      number = `${c.value}/${prefix}/${ROMAN[date.getMonth()]}/${date.getFullYear()}`;
    }
    await fx.tx.purchaseRequest.update({ where: { id }, data: { number, status: 'ISSUED', docDate: date, issuedAt: pr.issuedAt ?? new Date(), city: docs.city, signRequester: b.signRequester, signRequesterTitle: b.signRequesterTitle ?? null, signKnow: b.signKnow, signApprove: b.signApprove } });
    if (pr.status !== 'ISSUED') {
      await fx.notify({ userIds: [pr.createdById], subject: `[PR ${number}] Diterbitkan`, body: `Purchase Request "${pr.subject}" telah diterbitkan oleh ${who.name} dan menunggu persetujuan.` });
      await writeAudit(fx, who, { action: 'UPDATE', entity: 'purchase request', entityId: id, summary: `${who.name} menerbitkan PR ${number}` });
    }
  });
  res.json(decorate(await loadPr(id)));
});

procurementRoutes.post('/purchase-requests/:id/decision', gaOnly, async (req, res) => {
  const id = String(req.params.id);
  const b = z.object({ decision: z.enum(['APPROVED', 'REJECTED']), approvalRef: z.preprocess(nul, z.string().trim().max(60).nullable().optional()), note: z.preprocess(nul, z.string().trim().max(300).nullable().optional()) }).parse(req.body);
  const pr = await loadPr(id);
  if (pr.status !== 'ISSUED') throw new AppError(409, 'Keputusan hanya dapat dicatat untuk PR yang sudah diterbitkan');
  if (b.decision === 'REJECTED' && !b.note) throw fieldError('note', 'Isi alasan penolakan');
  const stockLines = pr.lines.filter((l) => l.itemId).length;
  const who = whoOf(req);
  await transact(async (fx) => {
    const next = b.decision === 'REJECTED' ? 'REJECTED' : stockLines ? 'APPROVED' : 'CLOSED';
    await fx.tx.purchaseRequest.update({ where: { id }, data: { status: next, approvedAt: new Date(), approvalRef: b.approvalRef ?? null, approvalNote: b.note ?? null } });
    await fx.notify({ userIds: [pr.createdById], subject: `[PR ${pr.number}] ${b.decision === 'APPROVED' ? 'Disetujui' : 'Ditolak'}`, body: `PR "${pr.subject}" ${b.decision === 'APPROVED' ? 'disetujui' : 'ditolak'}.${b.note ? `\nCatatan: ${b.note}` : ''}${b.decision === 'APPROVED' && stockLines ? '\nProcurement akan menerbitkan PO di Accurate dan mencatatnya di sini.' : ''}` });
    await writeAudit(fx, who, { action: 'UPDATE', entity: 'purchase request', entityId: id, summary: `${who.name} mencatat PR ${pr.number}: ${b.decision}` });
  });
  res.json({ ok: true });
});

procurementRoutes.post('/purchase-requests/:id/cancel', async (req, res) => {
  const u = req.user!;
  const id = String(req.params.id);
  const b = z.object({ note: z.string().trim().min(2, 'Isi alasan pembatalan').max(300) }).parse(req.body ?? {});
  const pr = await loadPr(id);
  if (['PO_ENTERED', 'CLOSED', 'CANCELLED', 'REJECTED'].includes(pr.status) || pr.pos.length) throw new AppError(409, 'PR ini tidak dapat dibatalkan lagi');
  if (pr.createdById !== u.id && !isGa(u)) throw new AppError(403, 'Hanya pembuat atau GA yang dapat membatalkan');
  const who = whoOf(req);
  await transact(async (fx) => {
    await fx.tx.purchaseRequest.update({ where: { id }, data: { status: 'CANCELLED', approvalNote: b.note } });
    await writeAudit(fx, who, { action: 'UPDATE', entity: 'purchase request', entityId: id, summary: `${who.name} membatalkan PR ${pr.number ?? pr.subject}: ${b.note}` });
  });
  res.json({ ok: true });
});

/** Procurement mencatat ulang PO yang diterbitkan di Accurate (nomor PO Accurate dipakai sebagai nomor PO di sini). */
procurementRoutes.post('/purchase-requests/:id/purchase-orders', gaOnly, async (req, res) => {
  const id = String(req.params.id);
  const b = z.object({
    number: z.string().trim().min(2, 'Isi nomor PO dari Accurate').max(60),
    vendorId: z.string().min(1, 'Pilih vendor'),
    poDate: z.coerce.date(),
    toWarehouseId: z.string().min(1, 'Pilih gudang tujuan'),
    note: z.preprocess(nul, z.string().trim().max(300).nullable().optional()),
    lines: z.array(z.object({
      prLineId: z.string().min(1),
      itemId: z.string().min(1, 'Pilih item master'),
      qty: z.coerce.number().int().min(1, 'Qty minimal 1').max(1_000_000),
      unitPrice: z.coerce.number().min(0).max(1e12),
    })).min(1, 'Pilih minimal satu baris'),
  }).parse(req.body);
  const pr = await loadPr(id);
  if (pr.status !== 'APPROVED') throw new AppError(409, pr.status === 'PO_ENTERED' ? 'Semua baris PR sudah memiliki PO' : 'PO hanya dapat dicatat untuk PR yang sudah disetujui');
  const vendor = await prisma.vendor.findUnique({ where: { id: b.vendorId } });
  if (!vendor) throw fieldError('vendorId', 'Vendor tidak ditemukan');
  const wh = await prisma.warehouse.findFirst({ where: { id: b.toWarehouseId, kind: { not: 'MOBILE' }, active: true } });
  if (!wh) throw fieldError('toWarehouseId', 'Gudang tujuan tidak valid');
  const who = whoOf(req);
  const out = await transact(async (fx) => {
    if (await fx.tx.purchaseOrder.findUnique({ where: { number: b.number } })) throw fieldError('number', `Nomor PO ${b.number} sudah tercatat`, 409);
    const po = await fx.tx.purchaseOrder.create({
      data: { number: b.number, vendor: vendor.name, vendorId: vendor.id, status: 'ISSUED', woId: pr.woId, toWarehouseId: wh.id, note: b.note ?? null, createdById: who.id, prId: pr.id, poDate: b.poDate, taxPct: pr.taxPct },
    });
    for (const l of b.lines) {
      const prl = pr.lines.find((x) => x.id === l.prLineId);
      if (!prl) throw new AppError(400, 'Baris PR tidak valid');
      if (prl.poLineId) throw new AppError(409, `Baris "${prl.description}" sudah memiliki PO`);
      if (prl.quotes.find((q) => q.chosen)?.vendorId !== vendor.id) throw new AppError(409, `Baris "${prl.description}" dipilih untuk vendor lain`);
      if (!(await fx.tx.item.findUnique({ where: { id: l.itemId } }))) throw new AppError(400, 'Item master tidak ditemukan');
      const pl = await fx.tx.poLine.create({ data: { poId: po.id, itemId: l.itemId, qty: l.qty, unitPrice: l.unitPrice, description: prl.description } });
      await fx.tx.prLine.update({ where: { id: prl.id }, data: { poLineId: pl.id, ...(prl.itemId ? {} : { itemId: l.itemId }) } });
    }
    const left = await fx.tx.prLine.count({ where: { prId: pr.id, itemId: { not: null }, poLineId: null } });
    if (!left) await fx.tx.purchaseRequest.update({ where: { id: pr.id }, data: { status: 'PO_ENTERED' } });
    await fx.notify({ roles: ['GA'], userIds: [pr.createdById], subject: `[PO ${b.number}] Dicatat dari PR ${pr.number}`, body: `PO ${b.number} (${vendor.name}) dicatat ${who.name}. Barang akan diterima & di-QC di menu Purchase Order.` });
    await writeAudit(fx, who, { action: 'CREATE', entity: 'PO', entityId: po.id, summary: `${who.name} mencatat PO ${b.number} (${vendor.name}) dari PR ${pr.number}` });
    return po;
  });
  res.status(201).json({ id: out.id });
});
