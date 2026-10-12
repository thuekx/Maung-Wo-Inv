/** Tes API export: resource subscriptions (tanpa data biaya) dan penambahan areaName di customers. Butuh DATABASE_URL (DB uji). */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const HAS_DB = !!process.env.DATABASE_URL;
const KEY = 'test-export-key';
process.env.EXPORT_API_KEY = KEY;

test('export API', { skip: HAS_DB ? false : 'DATABASE_URL tidak diisi' }, async (t) => {
  const express = (await import('express')).default;
  const { prisma } = await import('../src/db');
  const { exportRoutes } = await import('../src/routes/export');
  const app = express();
  app.use(exportRoutes);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.name === 'ZodError' ? 400 : err.status ?? 500).json({ error: err.message }));
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = (p: string, key: string | null = KEY) => fetch(base + p, { headers: key ? { 'x-api-key': key } : {} });

  const tag = `T${Date.now()}`;
  const sys = await prisma.user.findFirstOrThrow({ select: { id: true } });
  const area = await prisma.area.create({ data: { name: `Area ${tag}`, code: tag } });
  const cust = await prisma.customer.create({ data: { code: `C-${tag}`, name: `Pelanggan ${tag}`, phone: '0812', address: '-', packageName: 'P', status: 'NEED_CHECK', radiusStatus: 'OFFLINE', salesName: 'Sales X', areaId: area.id } });
  const wo = await prisma.workOrder.findFirst({ select: { id: true, number: true } });
  const mk = (n: number, extra: object = {}) => prisma.subscription.create({ data: { regNo: `ZZ${tag}${n}`, name: `S${n}`, phone: '08', packageName: 'Paket', marketingName: 'Mkt', installFee: 123456, monthlyFee: 654321, createdById: sys.id, ...extra } });
  const s1 = await mk(1, { customerId: cust.id, woId: wo?.id ?? null, source: 'RADIUS' });
  const s2 = await mk(2);
  const s3 = await mk(3);

  t.after(async () => {
    server.close();
    await prisma.subscription.deleteMany({ where: { id: { in: [s1.id, s2.id, s3.id] } } });
    await prisma.customer.delete({ where: { id: cust.id } });
    await prisma.area.delete({ where: { id: area.id } });
    await prisma.$disconnect();
  });

  await t.test('autentikasi: tanpa/ salah key → 401', async () => {
    assert.equal((await get('/export/subscriptions', null)).status, 401);
    assert.equal((await get('/export/subscriptions', 'salah')).status, 401);
  });

  await t.test('subscriptions: kolom yang diminta ada, data biaya TIDAK ada', async () => {
    const r = await get(`/export/subscriptions?limit=1000&since=${new Date(Date.now() - 3600_000).toISOString()}`);
    assert.equal(r.status, 200);
    const j: any = await r.json();
    const row = j.data.find((x: any) => x.regNo === `ZZ${tag}1`);
    assert.ok(row);
    for (const k of ['regNo', 'formDate', 'name', 'phone', 'address', 'packageName', 'source', 'marketingName', 'customerCode', 'woNumber', 'createdAt', 'updatedAt']) assert.ok(k in row, `kolom ${k}`);
    assert.equal(row.customerCode, `C-${tag}`);
    assert.equal(row.woNumber, wo?.number ?? null);
    assert.equal(row.source, 'RADIUS');
    const raw = JSON.stringify(j);
    for (const k of ['installFee', 'monthlyFee', 'email', 'picName', 'payment', 'customerId', 'woId']) assert.ok(!(k in row), `tidak boleh ada ${k}`);
    assert.ok(!raw.includes('123456') && !raw.includes('654321'));
    const r2: any = j.data.find((x: any) => x.regNo === `ZZ${tag}2`);
    assert.equal(r2.customerCode, null); assert.equal(r2.woNumber, null);
  });

  await t.test('subscriptions: cursor/limit berjalan & since menyaring createdAt', async () => {
    const seen: string[] = []; let cursor = ''; let guard = 0;
    do {
      const r = await get(`/export/subscriptions?limit=1${cursor ? `&cursor=${cursor}` : ''}`);
      const j: any = await r.json();
      assert.ok(j.count <= 1);
      seen.push(...j.data.map((x: any) => x.regNo));
      cursor = j.nextCursor ?? ''; guard++;
    } while (cursor && guard < 5000);
    for (const n of [1, 2, 3]) assert.ok(seen.includes(`ZZ${tag}${n}`));
    assert.equal(new Set(seen).size, seen.length, 'tanpa duplikat antar halaman');
    const fut: any = await (await get(`/export/subscriptions?since=${new Date(Date.now() + 86400_000).toISOString()}`)).json();
    assert.equal(fut.count, 0);
    const csv = await (await get('/export/subscriptions?format=csv&limit=5')).text();
    assert.ok(csv.split('\r\n')[0].includes('regNo') && !csv.includes('installFee'));
  });

  await t.test('daftar resource memuat subscriptions', async () => {
    const j: any = await (await get('/export')).json();
    assert.ok(j.resources.subscriptions);
    assert.equal(j.resources.subscriptions.sinceField, 'updatedAt');
    assert.equal(j.resources.customers.sinceField, 'updatedAt');
    for (const k of ['packages', 'areas']) assert.ok(j.resources[k], k);
  });

  await t.test('customers: code, name, phone, status, radiusStatus, salesName, createdAt, areaName', async () => {
    const j: any = await (await get(`/export/customers?limit=5000&since=${new Date(Date.now() - 3600_000).toISOString()}`)).json();
    const row = j.data.find((x: any) => x.code === `C-${tag}`);
    assert.ok(row);
    for (const k of ['code', 'name', 'phone', 'status', 'radiusStatus', 'salesName', 'createdAt', 'areaName']) assert.ok(k in row, `kolom ${k}`);
    assert.equal(row.areaName, `Area ${tag}`); assert.equal(row.status, 'NEED_CHECK'); assert.equal(row.radiusStatus, 'OFFLINE');
    assert.ok('warehouseCode' in row); // kolom lama tetap ada (kompatibel mundur)
  });

  await t.test('customers: perubahan status terlihat di ?since (updatedAt), bukan hanya pelanggan baru', async () => {
    const t0 = new Date();
    await new Promise((r) => setTimeout(r, 20));
    const before: any = await (await get(`/export/customers?limit=5000&since=${t0.toISOString()}`)).json();
    assert.ok(!before.data.some((x: any) => x.code === `C-${tag}`), 'belum berubah → tidak ikut');
    await prisma.customer.update({ where: { id: cust.id }, data: { status: 'ACTIVE', radiusStatus: 'ONLINE' } });
    const after: any = await (await get(`/export/customers?limit=5000&since=${t0.toISOString()}`)).json();
    const row = after.data.find((x: any) => x.code === `C-${tag}`);
    assert.ok(row, 'berubah → ikut tarikan inkremental');
    assert.equal(row.status, 'ACTIVE'); assert.ok('updatedAt' in row);
  });

  await t.test('packages & areas: kolom yang diminta, tanpa harga modal/komisi', async () => {
    const pk = await prisma.package.create({ data: { name: `Pkg ${tag}`, source: 'CRM', priceSell: 150000, speed: '20M' } });
    try {
      const j: any = await (await get(`/export/packages?limit=5000&since=${new Date(Date.now() - 3600_000).toISOString()}`)).json();
      const row = j.data.find((x: any) => x.name === `Pkg ${tag}`);
      assert.ok(row);
      for (const k of ['id', 'name', 'speed', 'priceSell', 'active', 'source', 'updatedAt']) assert.ok(k in row, `kolom ${k}`);
      assert.equal(row.source, 'CRM');
      const a: any = await (await get('/export/areas?limit=5000')).json();
      const ar = a.data.find((x: any) => x.code === tag);
      assert.ok(ar); assert.deepEqual(Object.keys(ar).sort(), ['active', 'code', 'id', 'name']);
    } finally { await prisma.package.delete({ where: { id: pk.id } }); }
  });

  await t.test('work-orders: ?type menyaring; tipe tidak dikenal → 400', async () => {
    const r = await get('/export/work-orders?type=NEW_INSTALL&limit=50');
    assert.equal(r.status, 200);
    const j: any = await r.json();
    assert.ok(j.data.every((w: any) => w.type === 'NEW_INSTALL'));
    for (const k of ['status', 'customerCode', 'updatedAt']) if (j.data[0]) assert.ok(k in j.data[0], `kolom ${k}`);
    assert.equal((await get('/export/work-orders?type=NGAWUR')).status, 400);
  });

  await t.test('applyPackages: paket bersumber CRM tidak ditimpa MSRadius; MANUAL tetap diadopsi', async () => {
    const { applyPackages } = await import('../src/radius');
    const crm = await prisma.package.create({ data: { name: `PkgCrm ${tag}`, source: 'CRM', priceSell: 111 } });
    const man = await prisma.package.create({ data: { name: `PkgMan ${tag}`, source: 'MANUAL' } });
    try {
      await applyPackages([{ profile_name: crm.name, speed: '99M', price_sell: 999 }, { profile_name: man.name, speed: '10M', price_sell: 50000 }]);
      const c = await prisma.package.findUniqueOrThrow({ where: { id: crm.id } });
      assert.equal(c.source, 'CRM'); assert.equal(Number(c.priceSell), 111); assert.equal(c.speed, null);
      const m = await prisma.package.findUniqueOrThrow({ where: { id: man.id } });
      assert.equal(m.source, 'RADIUS'); assert.equal(m.speed, '10M');
    } finally { await prisma.package.deleteMany({ where: { id: { in: [crm.id, man.id] } } }); }
  });
});
