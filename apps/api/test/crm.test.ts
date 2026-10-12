/** Tes pintu masuk CRM (Tahap 2a): katalog & penawaran, idempoten, kunci terpisah. Butuh DATABASE_URL (DB uji). */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const HAS_DB = !!process.env.DATABASE_URL;
const KEY = 'test-crm-key';
process.env.CRM_INTEGRATION_KEY = KEY;
process.env.EXPORT_API_KEY = 'test-export-key';

test('integrasi CRM 2a', { skip: HAS_DB ? false : 'DATABASE_URL tidak diisi' }, async (t) => {
  const express = (await import('express')).default;
  const { prisma } = await import('../src/db');
  const { crmRoutes } = await import('../src/routes/crm');
  const { exportRoutes } = await import('../src/routes/export');
  const app = express();
  app.use(express.json());
  app.use(crmRoutes);
  app.use(exportRoutes);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.name === 'ZodError' ? 400 : err.status ?? 500).json({ error: err.message }));
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const put = (p: string, body: unknown, key: string | null = KEY) => fetch(base + p, { method: 'PUT', headers: { 'content-type': 'application/json', ...(key ? { 'x-api-key': key } : {}) }, body: JSON.stringify(body) });
  const get = (p: string, key: string | null = KEY) => fetch(base + p, { headers: key ? { 'x-api-key': key } : {} });

  const tag = `C${Date.now()}`;
  const mktUser = await prisma.user.create({ data: { name: `Mkt ${tag}`, email: `mkt-${tag}@t.local`, passwordHash: 'x', role: 'MKT' } });
  const focUser = await prisma.user.create({ data: { name: `Foc ${tag}`, email: `foc-${tag}@t.local`, passwordHash: 'x', role: 'FOC' } });
  const item = await prisma.item.create({ data: { sku: `SKU-${tag}`, name: `Router ${tag}`, category: 'NETWORK', tracked: true } });
  const manual = await prisma.package.create({ data: { name: `Manual ${tag}`, source: 'MANUAL' } });
  const cust = await prisma.customer.create({ data: { code: `C-${tag}`, name: 'Existing', phone: '0812', address: 'Alamat', packageName: 'P' } });

  t.after(async () => {
    server.close();
    await prisma.crmQuotation.deleteMany({ where: { crmId: { startsWith: tag } } });
    await prisma.package.deleteMany({ where: { OR: [{ crmId: { startsWith: tag } }, { id: manual.id }] } });
    await prisma.auditLog.deleteMany({ where: { role: 'CRM', summary: { contains: tag } } });
    await prisma.customer.delete({ where: { id: cust.id } });
    await prisma.item.delete({ where: { id: item.id } });
    await prisma.user.deleteMany({ where: { id: { in: [mktUser.id, focUser.id] } } });
    await prisma.$disconnect();
  });

  await t.test('autentikasi: tanpa/salah key → 401; kunci export TIDAK bisa menulis', async () => {
    const b = { name: `X ${tag}`, kind: 'SERVICE' };
    assert.equal((await put(`/integrations/crm/catalog/${tag}-x`, b, null)).status, 401);
    assert.equal((await put(`/integrations/crm/catalog/${tag}-x`, b, 'salah')).status, 401);
    assert.equal((await put(`/integrations/crm/catalog/${tag}-x`, b, 'test-export-key')).status, 401);
    assert.equal((await get(`/integrations/crm/quotations/${tag}-q`, null)).status, 401);
  });

  await t.test('katalog: buat, perbarui (idempoten), kind/unit/sku, dan jejak audit', async () => {
    const body = { name: `Sewa Router ${tag}`, kind: 'PRODUCT', unit: 'unit', priceSell: 250000, description: 'Router sewa', sku: item.sku };
    const r1 = await put(`/integrations/crm/catalog/${tag}-c1`, body);
    assert.equal(r1.status, 201);
    const j1: any = await r1.json();
    assert.equal(j1.created, true); assert.equal(j1.skuFound, true); assert.equal(j1.itemName, item.name);
    const r2 = await put(`/integrations/crm/catalog/${tag}-c1`, { ...body, priceSell: 275000, active: false });
    assert.equal(r2.status, 200);
    assert.equal(((await r2.json()) as any).created, false);
    const p = await prisma.package.findUniqueOrThrow({ where: { crmId: `${tag}-c1` } });
    assert.equal(p.source, 'CRM'); assert.equal(p.kind, 'PRODUCT'); assert.equal(p.unit, 'unit'); assert.equal(Number(p.priceSell), 275000); assert.equal(p.active, false); assert.equal(p.sku, item.sku);
    const au = await prisma.auditLog.count({ where: { role: 'CRM', entityId: p.id } });
    assert.equal(au, 2);
    // SKU tak dikenal tidak menggagalkan (dipetakan manual nanti)
    const r3 = await put(`/integrations/crm/catalog/${tag}-c2`, { name: `Jasa ${tag}`, kind: 'SERVICE', sku: 'TIDAK-ADA' });
    assert.equal(r3.status, 201); assert.equal(((await r3.json()) as any).skuFound, false);
  });

  await t.test('katalog: nama bentrok dengan paket lain → 409 (tidak menimpa)', async () => {
    const r = await put(`/integrations/crm/catalog/${tag}-c3`, { name: manual.name, kind: 'SERVICE' });
    assert.equal(r.status, 409);
    assert.equal((await prisma.package.findUniqueOrThrow({ where: { id: manual.id } })).source, 'MANUAL');
    const r2 = await put(`/integrations/crm/catalog/${tag}-c3`, { name: `Jasa ${tag}`, kind: 'SERVICE' }); // nama milik katalog CRM lain
    assert.equal(r2.status, 409);
    assert.equal((await put(`/integrations/crm/catalog/${tag}-c3`, { name: 'Z', kind: 'INTERNET' })).status, 400); // kind terlarang / nama pendek
  });

  await t.test('export packages membawa kind/unit/sku/crmId', async () => {
    const j: any = await (await fetch(`${base}/export/packages?limit=5000`, { headers: { 'x-api-key': 'test-export-key' } })).json();
    const row = j.data.find((x: any) => x.crmId === `${tag}-c1`);
    assert.ok(row);
    for (const k of ['kind', 'unit', 'sku', 'crmId', 'priceSell']) assert.ok(k in row, k);
    assert.equal(row.kind, 'PRODUCT');
  });

  const quote = (over: any = {}) => ({
    number: `QT-${tag}`, rev: 1, status: 'QUOTED', total: 500000, marketingUserId: mktUser.id, marketingName: 'Budi',
    customer: { name: 'PT Contoh', phone: '+62812345678', address: 'Jl. Contoh No. 1 Bandung', areaCode: 'TIDAK-ADA' },
    lines: [{ catalogCrmId: `${tag}-c1`, name: 'Sewa Router', kind: 'PRODUCT', qty: 2, unit: 'unit', unitPrice: 250000 }, { name: 'Instalasi', kind: 'SERVICE', qty: 1, unitPrice: 0 }],
    ...over,
  });

  await t.test('penawaran: buat → pemetaan SKU otomatis + peringatan; idempoten; stale diabaikan', async () => {
    const r = await put(`/integrations/crm/quotations/${tag}-q1`, quote());
    assert.equal(r.status, 201);
    const j: any = await r.json();
    assert.equal(j.status, 'QUOTED'); assert.equal(j.woNumber, null);
    assert.equal(j.warnings.marketingMatched, true); assert.equal(j.warnings.areaNotFound, true); assert.deepEqual(j.warnings.unknownCatalog, []);
    const row = await prisma.crmQuotation.findUniqueOrThrow({ where: { crmId: `${tag}-q1` } });
    assert.equal(row.marketingUserId, mktUser.id);
    const l0 = (row.lines as any[])[0];
    assert.equal(l0.sku, item.sku); assert.equal(l0.itemId, item.id); // SKU diwarisi dari katalog → barang
    // kirim ulang persis sama → duplicate, tidak menulis audit lagi
    const before = await prisma.auditLog.count({ where: { entityId: row.id } });
    const d: any = await (await put(`/integrations/crm/quotations/${tag}-q1`, quote())).json();
    assert.equal(d.duplicate, true);
    assert.equal(await prisma.auditLog.count({ where: { entityId: row.id } }), before);
    // rev lebih tinggi memperbarui
    const u = await put(`/integrations/crm/quotations/${tag}-q1`, quote({ rev: 3, total: 600000 }));
    assert.equal(u.status, 200);
    // rev lebih rendah → stale, data tetap
    const s: any = await (await put(`/integrations/crm/quotations/${tag}-q1`, quote({ rev: 2, total: 1 }))).json();
    assert.equal(s.stale, true);
    assert.equal(Number((await prisma.crmQuotation.findUniqueOrThrow({ where: { crmId: `${tag}-q1` } })).total), 600000);
    assert.equal(((await (await get(`/integrations/crm/quotations/${tag}-q1`)).json()) as any).rev, 3);
    assert.equal((await get(`/integrations/crm/quotations/${tag}-tidakada`)).status, 404);
  });

  await t.test('penawaran: WON terkunci; WON pada rev yang sama diperbolehkan dari QUOTED', async () => {
    assert.equal((await put(`/integrations/crm/quotations/${tag}-q2`, quote({ number: `QT2-${tag}` }))).status, 201);
    const w = await put(`/integrations/crm/quotations/${tag}-q2`, quote({ number: `QT2-${tag}`, status: 'WON', decidedAt: new Date().toISOString() }));
    assert.equal(w.status, 200);
    assert.equal(((await w.json()) as any).status, 'WON');
    assert.equal((await put(`/integrations/crm/quotations/${tag}-q2`, quote({ number: `QT2-${tag}`, rev: 2 }))).status, 409); // revisi baru setelah WON
    assert.equal((await put(`/integrations/crm/quotations/${tag}-q2`, quote({ number: `QT2-${tag}`, status: 'LOST' }))).status, 409);
    assert.equal(((await (await put(`/integrations/crm/quotations/${tag}-q2`, quote({ number: `QT2-${tag}`, status: 'WON' }))).json()) as any).duplicate, true);
  });

  await t.test('penawaran: LOST final pada revisinya; revisi lebih tinggi membuka lagi', async () => {
    await put(`/integrations/crm/quotations/${tag}-q3`, quote({ number: `QT3-${tag}` }));
    assert.equal((await put(`/integrations/crm/quotations/${tag}-q3`, quote({ number: `QT3-${tag}`, status: 'LOST', lostReason: 'Harga' }))).status, 200);
    assert.equal((await put(`/integrations/crm/quotations/${tag}-q3`, quote({ number: `QT3-${tag}`, status: 'QUOTED' }))).status, 409);
    assert.equal((await put(`/integrations/crm/quotations/${tag}-q3`, quote({ number: `QT3-${tag}`, status: 'QUOTED', rev: 2 }))).status, 200);
  });

  await t.test('penawaran: pelanggan existing harus ada (404); marketing tak cocok/bukan MKT → tidak ditautkan', async () => {
    const bad = await put(`/integrations/crm/quotations/${tag}-q4`, quote({ customer: { ...quote().customer, code: 'TIDAK-ADA-999' } }));
    assert.equal(bad.status, 404);
    assert.equal(await prisma.crmQuotation.count({ where: { crmId: `${tag}-q4` } }), 0);
    const ok = await put(`/integrations/crm/quotations/${tag}-q4`, quote({ customer: { ...quote().customer, code: cust.code }, marketingUserId: focUser.id }));
    assert.equal(ok.status, 201);
    const j: any = await ok.json();
    assert.equal(j.warnings.marketingMatched, false);
    const row = await prisma.crmQuotation.findUniqueOrThrow({ where: { crmId: `${tag}-q4` } });
    assert.equal(row.marketingUserId, null); assert.equal(row.marketingName, 'Budi'); assert.equal(row.customerCode, cust.code);
    // tidak ada penulisan ke tabel pelanggan/WO pada Tahap 2a
    assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: cust.id } })).name, 'Existing');
  });

  await t.test('penawaran: validasi badan (baris kosong/ status tak dikenal → 400)', async () => {
    assert.equal((await put(`/integrations/crm/quotations/${tag}-q5`, quote({ lines: [] }))).status, 400);
    assert.equal((await put(`/integrations/crm/quotations/${tag}-q5`, quote({ status: 'DRAFT' }))).status, 400);
    assert.equal((await put(`/integrations/crm/quotations/bad id!`, quote())).status, 400);
  });
});
