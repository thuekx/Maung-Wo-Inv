/** Tes tautan CRM pada pelanggan: induk akun & nomor Lead (PATCH /customers/:id/crm-links), kelompok akun, Export API. Butuh DATABASE_URL (DB uji). */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.EXPORT_API_KEY = 'test-export-key';

test('tautan CRM pelanggan', { skip: process.env.DATABASE_URL ? false : 'DATABASE_URL tidak diisi' }, async (t) => {
  const express = (await import('express')).default;
  const { prisma } = await import('../src/db');
  const { signToken, authenticate } = await import('../src/auth');
  const { masterRoutes } = await import('../src/routes/masters');
  const { core: coreRoutes } = await import('../src/routes/core');
  const { exportRoutes } = await import('../src/routes/export');
  const app = express();
  app.use(express.json());
  app.use('/api', exportRoutes);
  app.use('/api', authenticate, masterRoutes);
  if (coreRoutes) app.use('/api', authenticate, coreRoutes);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.name === 'ZodError' ? 400 : err.status ?? 500).json({ error: err.message, fields: err.fields }));
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  const tag = `L${Date.now()}`;
  const mk = (role: any) => prisma.user.create({ data: { email: `${tag}-${role}@t.local`, name: `U ${role}`, passwordHash: 'x', role, subRole: 'STAFF', mustChangePassword: false } });
  const [mkt, noc] = await Promise.all([mk('MKT'), mk('NOC')]);
  const hdr = (u: any) => ({ authorization: `Bearer ${signToken(u)}`, 'content-type': 'application/json' });
  const cu = (code: string, extra: object = {}) => prisma.customer.create({ data: { code, name: `Pelanggan ${code}`, phone: '0812', address: 'Alamat uji', packageName: 'P', ...extra } });
  const induk = await cu(`IND-${tag}`);
  const anak = await cu(`ANK-${tag}`, { status: 'PROSPECT' });
  const lain = await cu(`LAIN-${tag}`);
  const sub = await prisma.subscription.create({ data: { regNo: `ZZ${tag}`, name: 'Form', phone: '08', packageName: 'P', createdById: mkt.id, customerId: anak.id } });
  const patch = (u: any, id: string, body: unknown) => fetch(`${base}/customers/${id}/crm-links`, { method: 'PATCH', headers: hdr(u), body: JSON.stringify(body) });

  t.after(async () => {
    server.close();
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [induk.id, anak.id, lain.id] } } });
    await prisma.subscription.delete({ where: { id: sub.id } });
    await prisma.customer.deleteMany({ where: { id: { in: [induk.id, anak.id, lain.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [mkt.id, noc.id] } } });
    await prisma.$disconnect();
  });

  await t.test('hanya Marketing/Admin (fitur Form Berlangganan); NOC ditolak', async () => {
    assert.equal((await patch(noc, anak.id, { crmLeadRef: 'LD-1' })).status, 403);
  });

  await t.test('induk akun: harus ada (404), bukan diri sendiri, tanpa lingkaran; huruf apa adanya', async () => {
    assert.equal((await patch(mkt, anak.id, { parentCustomerCode: 'TIDAK-ADA-9' })).status, 404);
    assert.ok([400, 422].includes((await patch(mkt, anak.id, { parentCustomerCode: anak.code })).status), 'induk = diri sendiri ditolak');
    const ok = await patch(mkt, anak.id, { parentCustomerCode: induk.code });
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as any).parentCustomerCode, induk.code);
    // lingkaran: induk → anak
    const loop = await patch(mkt, induk.id, { parentCustomerCode: anak.code });
    assert.ok([400, 409].includes(loop.status), `lingkaran ditolak (status ${loop.status})`);
    // hapus tautan
    assert.equal(((await (await patch(mkt, anak.id, { parentCustomerCode: '' })).json()) as any).parentCustomerCode, null);
    await patch(mkt, anak.id, { parentCustomerCode: induk.code });
  });

  await t.test('nomor Lead: format LD-<angka> (huruf kecil dinormalkan), 1 Lead = 1 kode (409), idempoten pada kode yang sama', async () => {
    assert.equal((await patch(mkt, anak.id, { crmLeadRef: 'LEAD-1' })).status, 400);
    assert.equal((await patch(mkt, anak.id, { crmLeadRef: 'LD-1234567890' })).status, 400); // >9 digit
    const ok = await patch(mkt, anak.id, { crmLeadRef: ' ld-123 ' });
    assert.equal(((await ok.json()) as any).crmLeadRef, 'LD-123');
    assert.equal((await patch(mkt, anak.id, { crmLeadRef: 'LD-123' })).status, 200); // sama pada kode yang sama
    const dup = await patch(mkt, lain.id, { crmLeadRef: 'LD-123' });
    assert.equal(dup.status, 409);
    assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: lain.id } })).crmLeadRef, null);
    assert.ok(await prisma.auditLog.count({ where: { entityId: anak.id, entity: 'pelanggan' } }) > 0, 'perubahan tercatat di audit');
  });

  await t.test('Export API: customers & subscriptions membawa parentCustomerCode + crmLeadRef apa adanya', async () => {
    const h = { headers: { 'x-api-key': 'test-export-key' } };
    const c: any = await (await fetch(`${base}/export/customers?limit=5000`, h)).json();
    const row = c.data.find((x: any) => x.code === anak.code);
    assert.equal(row.parentCustomerCode, induk.code); assert.equal(row.crmLeadRef, 'LD-123');
    const s: any = await (await fetch(`${base}/export/subscriptions?limit=5000`, h)).json();
    const sr = s.data.find((x: any) => x.regNo === sub.regNo);
    assert.equal(sr.parentCustomerCode, induk.code); assert.equal(sr.crmLeadRef, 'LD-123'); assert.equal(sr.customerCode, anak.code);
  });

  await t.test('detail pelanggan: kelompok akun (induk + layanan anak)', async (t2) => {
    if (!coreRoutes) return t2.skip('coreRoutes tidak diekspor');
    const a: any = await (await fetch(`${base}/customers/${anak.id}`, { headers: hdr(mkt) })).json();
    assert.equal(a.group.parent.code, induk.code);
    const i: any = await (await fetch(`${base}/customers/${induk.id}`, { headers: hdr(mkt) })).json();
    assert.deepEqual(i.group.children.map((x: any) => x.code), [anak.code]); assert.equal(i.group.parent, null);
  });
});
