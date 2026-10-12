/** Tes alur SERVICE_ORDER: penawaran CRM WON → order → sumber barang → jadwal → laporan → BA. Butuh DATABASE_URL (DB uji). */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const HAS_DB = !!process.env.DATABASE_URL;
const KEY = 'test-so-key';
process.env.CRM_INTEGRATION_KEY = KEY;

test('SERVICE_ORDER', { skip: HAS_DB ? false : 'DATABASE_URL tidak diisi' }, async (t) => {
  const express = (await import('express')).default;
  const { prisma } = await import('../src/db');
  const { crmRoutes } = await import('../src/routes/crm');
  const { transact } = await import('../src/effects');
  const { applyAction, allowedActions } = await import('../src/engine');
  const app = express();
  app.use(express.json());
  app.use(crmRoutes);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.name === 'ZodError' ? 400 : err.status ?? 500).json({ error: err.message }));
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const put = (id: string, body: unknown) => fetch(`${base}/integrations/crm/quotations/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-api-key': KEY }, body: JSON.stringify(body) });

  const tag = `S${Date.now()}`;
  const mk = (role: any, subRole: any = 'STAFF', name = role) => prisma.user.create({ data: { name: `${name} ${tag}`, email: `${name.toLowerCase().replace(/ /g, "")}${role.toLowerCase()}-${tag}@t.local`, passwordHash: 'x', role, subRole } });
  const mkt = await mk('MKT', 'STAFF', 'Budi');
  const mkt2 = await mk('MKT', 'STAFF', 'Cici');
  const mktLead = await mk('MKT', 'MANAGER', 'Lead');
  const ga = await mk('GA');
  const focLead = await mk('FOC', 'SUPERVISOR');
  const tech = await mk('FOC', 'STAFF', 'Teknisi');
  const act = (u: any) => ({ id: u.id, name: u.name, role: u.role, subRole: u.subRole });
  const wh = await prisma.warehouse.create({ data: { code: `WH-${tag}`, name: `Gudang ${tag}`, kind: 'BRANCH' } });
  const area = await prisma.area.create({ data: { name: `Area ${tag}`, code: tag, warehouseId: wh.id, alias: 'TST' } });
  const itemStock = await prisma.item.create({ data: { sku: `STK-${tag}`, name: `Kamera ${tag}`, category: 'CONSUMABLE', unit: 'unit' } });
  const itemProj = await prisma.item.create({ data: { sku: `PRJ-${tag}`, name: `Switch ${tag}`, category: 'CONSUMABLE', unit: 'unit' } });
  await prisma.stockLevel.create({ data: { warehouseId: wh.id, itemId: itemStock.id, qty: 10 } });
  await prisma.package.createMany({ data: [{ name: `Jasa ${tag}`, source: 'CRM', kind: 'SERVICE', crmId: `${tag}-svc` }, { name: `Kamera CRM ${tag}`, source: 'CRM', kind: 'PRODUCT', crmId: `${tag}-cam`, sku: itemStock.sku }] });
  const existing = await prisma.customer.create({ data: { code: `EX-${tag}`, name: 'Pelanggan Lama', phone: '0812', address: 'Alamat lama', packageName: 'Home 20 Mbps', status: 'ACTIVE', source: 'RADIUS', areaId: area.id, warehouseId: wh.id } });

  const quote = (over: any = {}) => ({
    number: `QT-${tag}`, rev: 1, status: 'WON', total: 1500000, taxNote: 'PPN 11%', marketingUserId: mkt.id, marketingName: 'Budi',
    customer: { name: 'PT Baru', phone: '+62812345678', address: 'Jl. Contoh No. 1 Bandung', areaCode: tag },
    lines: [
      { catalogCrmId: `${tag}-svc`, name: 'Instalasi CCTV', kind: 'SERVICE', qty: 1, unit: 'paket', unitPrice: 500000 },
      { catalogCrmId: `${tag}-cam`, name: 'Kamera', kind: 'PRODUCT', qty: 2, unit: 'unit', unitPrice: 300000 },
      { name: 'Switch PoE', kind: 'PRODUCT', qty: 1, unit: 'unit', unitPrice: 400000, sku: itemProj.sku },
    ],
    ...over,
  });
  const run = (woId: string, key: string, who: any, input: any = {}) => transact((fx) => applyAction(fx, woId, key, act(who), input));
  const wo = (id: string) => prisma.workOrder.findUniqueOrThrow({ where: { id }, include: { customer: true } });

  t.after(async () => {
    server.close();
    const qs = await prisma.crmQuotation.findMany({ where: { crmId: { startsWith: tag } } });
    const wids = qs.map((q) => q.woId).filter(Boolean) as string[];
    const all = await prisma.workOrder.findMany({ where: { OR: [{ id: { in: wids } }, { parentId: { in: wids } }] }, select: { id: true, customerId: true } });
    const ids = all.map((w) => w.id);
    await prisma.purchaseRequest.deleteMany({ where: { woId: { in: ids } } });
    await prisma.stockMovement.deleteMany({ where: { OR: [{ woId: { in: ids } }, { itemId: { in: [itemStock.id, itemProj.id] } }] } });
    await prisma.attachment.deleteMany({ where: { OR: [{ woId: { in: ids } }, { url: { startsWith: `/uploads/${tag}` } }] } });
    await prisma.woEvent.deleteMany({ where: { woId: { in: ids } } });
    await prisma.inbox.deleteMany({ where: { woId: { in: ids } } }).catch(() => {});
    await prisma.crmQuotation.deleteMany({ where: { crmId: { startsWith: tag } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: ids.filter((i) => !wids.includes(i)) } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: wids } } });
    await prisma.customer.deleteMany({ where: { OR: [{ id: { in: all.map((w) => w.customerId).filter(Boolean) as string[] } }, { id: existing.id }] } });
    await prisma.area.delete({ where: { id: area.id } }).catch(() => {});
    await prisma.stockLevel.deleteMany({ where: { warehouseId: wh.id } });
    await prisma.warehouse.deleteMany({ where: { OR: [{ id: wh.id }, { ownerId: { in: [tech.id] } }] } });
    await prisma.package.deleteMany({ where: { crmId: { startsWith: tag } } });
    await prisma.stockLevel.deleteMany({ where: { warehouseId: wh.id } });
    await prisma.item.deleteMany({ where: { id: { in: [itemStock.id, itemProj.id] } } });
    await prisma.auditLog.deleteMany({ where: { role: 'CRM', OR: [{ summary: { contains: tag } }, { summary: { contains: `QT-${tag}` } }] } });
    await prisma.user.deleteMany({ where: { id: { in: [mkt.id, mkt2.id, mktLead.id, ga.id, focLead.id, tech.id] } } });
    await prisma.$disconnect();
  });

  let woId = '';
  await t.test('QUOTED tidak membuat order; WON membuat pelanggan CRM + order SO_NEW dengan jejak marketing apa adanya', async () => {
    const r1: any = await (await put(`${tag}-q1`, quote({ status: 'QUOTED' }))).json();
    assert.equal(r1.woNumber, null);
    const r: any = await (await put(`${tag}-q1`, quote())).json();
    assert.match(r.woNumber, /^WO-SO-/);
    const q = await prisma.crmQuotation.findUniqueOrThrow({ where: { crmId: `${tag}-q1` } });
    woId = q.woId!;
    const w = await wo(woId);
    assert.equal(w.type, 'SERVICE_ORDER'); assert.equal(w.status, 'SO_NEW'); assert.equal(w.source, 'CRM');
    assert.equal(w.customer!.source, 'CRM'); assert.equal(w.customer!.salesName, 'Budi'); assert.equal(w.customer!.warehouseId, wh.id);
    const d: any = w.data;
    assert.deepEqual(d.marketing, { id: mkt.id, name: 'Budi' });
    assert.equal(d.mktOwner.id, mkt.id); assert.equal(d.newCustomer, true);
    const src = d.lines.map((l: any) => l.source);
    assert.deepEqual(src, ['NONE', 'STOCK', 'STOCK']); // SKU katalog/baris → barang → default Pakai stok
    // kirim ulang WON identik tidak membuat order kedua
    const r2: any = await (await put(`${tag}-q1`, quote())).json();
    assert.equal(r2.duplicate, true); assert.equal(r2.woNumber, r.woNumber);
  });

  await t.test('pemegang order: marketing lain ditolak, supervisor/manager MKT boleh; bukan MKT ditolak', async () => {
    await assert.rejects(run(woId, 'confirm', mkt2, { lines: [{ idx: 2, source: 'PROJECT' }] }), /dipegang Budi/);
    await assert.rejects(run(woId, 'confirm', ga, { lines: [{ idx: 2, source: 'PROJECT' }] }), /khusus divisi/);
    // jasa tidak boleh punya sumber barang; STOK tanpa barang ditolak
    await assert.rejects(run(woId, 'confirm', mkt, { lines: [{ idx: 0, source: 'STOCK' }] }), /jasa/);
    assert.deepEqual(allowedActions(await wo(woId), act(mkt2)).sort(), ['cancel_order', 'claim', 'confirm'].sort().filter((k) => k !== 'cancel'));
  });

  await t.test('konfirmasi: baris Switch → PR proyek (jejak marketing), Kamera → stok aman; menunggu barang proyek', async () => {
    await run(woId, 'confirm', mktLead, { lines: [{ idx: 2, source: 'PROJECT' }] }); // manager MKT boleh mengambil alih
    const w = await wo(woId);
    assert.equal(w.status, 'SO_SOURCING');
    const d: any = w.data;
    assert.equal(d.stockOk, true);
    const pr = await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: d.pr }, include: { lines: true } });
    assert.equal(pr.woId, woId); assert.equal(pr.crmMarketingUserId, mkt.id); assert.equal(pr.crmMarketingName, 'Budi'); assert.equal(pr.crmQuotationNo, `QT-${tag}`);
    assert.equal(pr.lines.length, 1); assert.equal(pr.lines[0].description, 'Switch PoE'); assert.equal(pr.lines[0].itemId, itemProj.id);
    assert.equal(d.marketing.name, 'Budi'); // tidak ditimpa nama manager yang mengonfirmasi
    await assert.rejects(run(woId, 'recheck', tech), /khusus divisi/);
    await run(woId, 'recheck', ga);
    assert.equal((await wo(woId)).status, 'SO_SOURCING');
  });

  await t.test('PR proyek diterima → siap jadwal → jadwalkan → mulai → laporan → BA jasa → selesai', async () => {
    await run(woId, 'pr_received', ga, {});
    assert.equal((await wo(woId)).status, 'SO_SCHEDULING');
    await assert.rejects(run(woId, 'schedule', tech, { technicianIds: [tech.id], scheduledAt: new Date().toISOString() }), /supervisor|khusus/);
    await run(woId, 'schedule', focLead, { technicianIds: [tech.id], scheduledAt: new Date().toISOString() });
    assert.equal((await wo(woId)).status, 'SO_SCHEDULED');
    await assert.rejects(run(woId, 'start', focLead, {}), /tim yang ditugaskan/);
    await run(woId, 'start', tech, {});
    assert.equal((await wo(woId)).status, 'SO_IN_PROGRESS');
    await assert.rejects(run(woId, 'submit_report', tech, { photos: [], workDone: 'Selesai' }), /foto/i);
    await assert.rejects(run(woId, 'submit_report', tech, { photos: [`/uploads/${tag}-nogps.jpg`], workDone: 'x' }), /GPS/); // foto teknisi wajib GPS (kebijakan yang sama)
    await prisma.attachment.create({ data: { url: `/uploads/${tag}-ok.jpg`, mime: 'image/jpeg', uploadedBy: tech.id, lat: -6.9, lng: 107.6 } });
    await run(woId, 'submit_report', tech, { photos: [`/uploads/${tag}-ok.jpg`], workDone: 'Kamera terpasang & diuji' });
    assert.equal((await wo(woId)).status, 'SO_AWAITING_BA');
    await assert.rejects(run(woId, 'send_ba', mkt2, { sendTelegram: true, recipientTelegram: '123' }), /dipegang/);
    await assert.rejects(run(woId, 'send_ba', mkt, {}), /minimal satu/);
    await run(woId, 'send_ba', mkt, { sendTelegram: true, recipientTelegram: '123456' });
    const w = await wo(woId);
    assert.equal(w.status, 'SO_DONE'); assert.ok(w.closedAt);
    const ba: any = (w.data as any).ba;
    assert.match(ba.number, /^BAJ\/TST\//);
    assert.ok(ba.body.includes('Instalasi CCTV') && ba.body.includes('Garansi:') && ba.body.includes('PT Baru'));
    assert.equal(w.customer!.status, 'ACTIVE'); // pelanggan CRM baru aktif setelah BA
  });

  await t.test('stok kurang → WO Permintaan Barang anak dibuat, menunggu', async () => {
    await put(`${tag}-q2`, quote({ number: `QT2-${tag}`, customer: { ...quote().customer, name: 'PT Kurang' }, lines: [{ catalogCrmId: `${tag}-cam`, name: 'Kamera', kind: 'PRODUCT', qty: 50, unit: 'unit', unitPrice: 1 }] }));
    const q = await prisma.crmQuotation.findUniqueOrThrow({ where: { crmId: `${tag}-q2` } });
    await run(q.woId!, 'confirm', mkt, { lines: [{ idx: 0, source: 'STOCK' }] });
    const w = await wo(q.woId!);
    assert.equal(w.status, 'SO_SOURCING');
    const child = await prisma.workOrder.findFirst({ where: { parentId: w.id } });
    assert.equal(child?.type, 'STOCK_REQUEST');
    assert.ok(String((w.data as any).stockRequest).startsWith('WO-'));
    // dibatalkan oleh pemegang dengan alasan; GA diberi tahu, PR/permintaan tidak dibatalkan otomatis
    await assert.rejects(run(w.id, 'cancel_order', mkt, { note: 'x' }), /alasan/i);
    await run(w.id, 'cancel_order', mkt, { note: 'Pelanggan batal membeli' });
    assert.equal((await wo(w.id)).status, 'SO_CANCELLED');
  });

  await t.test('pelanggan existing: ditautkan tanpa mengubah data internet/MSRadius', async () => {
    await put(`${tag}-q3`, quote({ number: `QT3-${tag}`, customer: { ...quote().customer, code: existing.code }, lines: [{ name: 'Sewa WiFi', kind: 'SERVICE', qty: 1, unit: 'bulan', unitPrice: 1 }] }));
    const q = await prisma.crmQuotation.findUniqueOrThrow({ where: { crmId: `${tag}-q3` } });
    const w = await wo(q.woId!);
    assert.equal(w.customerId, existing.id); assert.equal((w.data as any).newCustomer, false);
    await run(w.id, 'confirm', mkt, { lines: [{ idx: 0, source: 'NONE' }] });
    assert.equal((await wo(w.id)).status, 'SO_SCHEDULING'); // jasa murni: langsung jadwal
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: existing.id } });
    assert.equal(c.source, 'RADIUS'); assert.equal(c.status, 'ACTIVE'); assert.equal(c.packageName, 'Home 20 Mbps'); assert.equal(c.name, 'Pelanggan Lama');
  });

  await t.test('marketing nonaktif: order masuk antrean MKT, jejak id+nama tetap menempel', async () => {
    await prisma.user.update({ where: { id: mkt2.id }, data: { active: false } });
    await put(`${tag}-q4`, quote({ number: `QT4-${tag}`, marketingUserId: mkt2.id, marketingName: 'Cici', customer: { ...quote().customer, name: 'PT Antrean' }, lines: [{ name: 'Survey', kind: 'SERVICE', qty: 1, unitPrice: 1 }] }));
    const q = await prisma.crmQuotation.findUniqueOrThrow({ where: { crmId: `${tag}-q4` } });
    const d: any = (await wo(q.woId!)).data;
    assert.equal(d.mktOwner, null); assert.deepEqual(d.marketing, { id: mkt2.id, name: 'Cici' });
    await run(q.woId!, 'claim', mkt, {}); // antrean: MKT mana pun dapat mengambil
    assert.equal(((await wo(q.woId!)).data as any).mktOwner.id, mkt.id);
  });
});
