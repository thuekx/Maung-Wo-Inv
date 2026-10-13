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
  const extraItems: string[] = [];
  const run = (woId: string, key: string, who: any, input: any = {}) => transact((fx) => applyAction(fx, woId, key, act(who), input));
  const wo = (id: string) => prisma.workOrder.findUniqueOrThrow({ where: { id }, include: { customer: true } });

  t.after(async () => {
    server.close();
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: extraItems } } });
    await prisma.asset.deleteMany({ where: { itemId: { in: extraItems } } });
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
    await prisma.stockLevel.deleteMany({ where: { OR: [{ warehouseId: wh.id }, { warehouse: { ownerId: tech.id } }] } });
    await prisma.warehouse.deleteMany({ where: { OR: [{ id: wh.id }, { ownerId: { in: [tech.id] } }] } });
    await prisma.package.deleteMany({ where: { crmId: { startsWith: tag } } });
    await prisma.stockLevel.deleteMany({ where: { warehouseId: wh.id } });
    await prisma.item.deleteMany({ where: { id: { in: [itemStock.id, itemProj.id, ...extraItems] } } });
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

  await t.test('konfirmasi sumber barang oleh GA/Procurement (pemegang aset), bukan Marketing', async () => {
    assert.equal((await wo(woId)).status, 'SO_NEW');
    await assert.rejects(run(woId, 'confirm', mkt, { lines: [{ idx: 2, source: 'PROJECT' }] }), /khusus divisi/);
    await assert.rejects(run(woId, 'confirm', mktLead, { lines: [{ idx: 2, source: 'PROJECT' }] }), /khusus divisi/);
    // jasa + perangkat dari stok wajib memilih barang
    await assert.rejects(run(woId, 'confirm', ga, { lines: [{ idx: 0, source: 'STOCK' }] }), /pilih barang/);
    assert.deepEqual(allowedActions(await wo(woId), act(mkt2)).sort(), ['cancel_order', 'claim'].sort());
    assert.ok(allowedActions(await wo(woId), act(ga)).includes('confirm'));
  });

  await t.test('konfirmasi: baris Switch → PR proyek (jejak marketing), Kamera → stok aman; menunggu barang proyek', async () => {
    await run(woId, 'confirm', ga, { lines: [{ idx: 2, source: 'PROJECT' }] });
    const w = await wo(woId);
    assert.equal(w.status, 'SO_SOURCING');
    const d: any = w.data;
    assert.equal(d.stockOk, true);
    const pr = await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: d.pr }, include: { lines: true } });
    assert.equal(pr.woId, woId); assert.equal(pr.crmMarketingUserId, mkt.id); assert.equal(pr.crmMarketingName, 'Budi'); assert.equal(pr.crmQuotationNo, `QT-${tag}`);
    assert.equal(pr.lines.length, 1); assert.equal(pr.lines[0].description, 'Switch PoE'); assert.equal(pr.lines[0].itemId, itemProj.id);
    assert.equal(d.marketing.name, 'Budi'); assert.equal(d.mktOwner.id, mkt.id); // tidak ditimpa GA yang mengonfirmasi
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
    await run(q.woId!, 'confirm', ga, { lines: [{ idx: 0, source: 'STOCK' }] });
    const w = await wo(q.woId!);
    assert.equal(w.status, 'SO_SOURCING');
    const child = await prisma.workOrder.findFirst({ where: { parentId: w.id } });
    assert.equal(child?.type, 'STOCK_REQUEST');
    assert.ok(String((w.data as any).stockRequest).startsWith('WO-'));
    // cek ulang selagi permintaan barang belum selesai → tetap menunggu
    await run(w.id, 'recheck', ga);
    assert.equal((await wo(w.id)).status, 'SO_SOURCING');
    // dibatalkan oleh pemegang dengan alasan; GA diberi tahu, PR/permintaan tidak dibatalkan otomatis
    await assert.rejects(run(w.id, 'cancel_order', mkt, { note: 'x' }), /alasan/i);
    await run(w.id, 'cancel_order', mkt, { note: 'Pelanggan batal membeli' });
    assert.equal((await wo(w.id)).status, 'SO_CANCELLED');
  });

  await t.test('permintaan barang anak selesai → order otomatis lanjut ke Siap Dijadwalkan (FOC)', async () => {
    const have = (await prisma.stockLevel.findUniqueOrThrow({ where: { warehouseId_itemId: { warehouseId: wh.id, itemId: itemStock.id } } })).qty;
    await put(`${tag}-q6`, quote({ number: `QT6-${tag}`, customer: { ...quote().customer, name: 'PT Tunggu Stok' }, lines: [{ catalogCrmId: `${tag}-cam`, name: 'Kamera', kind: 'PRODUCT', qty: have + 3, unit: 'unit', unitPrice: 1 }] }));
    const q = await prisma.crmQuotation.findUniqueOrThrow({ where: { crmId: `${tag}-q6` } });
    await run(q.woId!, 'confirm', ga, { lines: [{ idx: 0, source: 'STOCK' }] });
    const w = await wo(q.woId!);
    assert.equal(w.status, 'SO_SOURCING');
    const child = await prisma.workOrder.findFirstOrThrow({ where: { parentId: w.id, number: (w.data as any).stockRequest } });
    assert.equal(child.status, 'PROC_REVIEW');
    await prisma.stockLevel.update({ where: { warehouseId_itemId: { warehouseId: wh.id, itemId: itemStock.id } }, data: { qty: { increment: 3 } } }); // barang masuk (mis. PO diterima)
    await run(child.id, 'in_stock', ga, {});
    assert.equal((await wo(child.id)).status, 'CLOSED');
    assert.equal((await wo(w.id)).status, 'SO_SCHEDULING', 'order lanjut otomatis setelah permintaan barang selesai');
  });

  await t.test('pelanggan existing: ditautkan tanpa mengubah data internet/MSRadius', async () => {
    await put(`${tag}-q3`, quote({ number: `QT3-${tag}`, customer: { ...quote().customer, code: existing.code }, lines: [{ name: 'Survey lokasi', kind: 'SERVICE', qty: 1, unit: 'kali', unitPrice: 1 }] }));
    const q = await prisma.crmQuotation.findUniqueOrThrow({ where: { crmId: `${tag}-q3` } });
    const w = await wo(q.woId!);
    assert.equal(w.customerId, existing.id); assert.equal((w.data as any).newCustomer, false);
    await run(w.id, 'confirm', ga, { lines: [{ idx: 0, source: 'NONE' }] });
    assert.equal((await wo(w.id)).status, 'SO_SCHEDULING'); // jasa murni: langsung jadwal
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: existing.id } });
    assert.equal(c.source, 'RADIUS'); assert.equal(c.status, 'ACTIVE'); assert.equal(c.packageName, 'Home 20 Mbps'); assert.equal(c.name, 'Pelanggan Lama');
  });

  await t.test('sewa WiFi = jasa + perangkat; barang di Stok Berjalan teknisi dipakai tanpa gudang; laporan hanya material yang diambil', async () => {
    const { mobileWarehouse } = await import('../src/inventory');
    const router = await prisma.item.create({ data: { sku: `RTR-${tag}`, name: `Router ${tag}`, category: 'NETWORK', tracked: true, unit: 'unit' } });
    extraItems.push(router.id);
    await prisma.asset.create({ data: { itemId: router.id, serialNumber: `RTR-${tag}-1`, warehouseId: wh.id } });
    const mob = await mobileWarehouse(prisma as any, tech.id);
    await prisma.asset.create({ data: { itemId: router.id, serialNumber: `RTR-${tag}-MOB`, warehouseId: mob.id } }); // sisa pekerjaan lain, belum dikembalikan
    await prisma.stockLevel.upsert({ where: { warehouseId_itemId: { warehouseId: mob.id, itemId: itemStock.id } }, create: { warehouseId: mob.id, itemId: itemStock.id, qty: 3 }, update: { qty: 3 } });
    await put(`${tag}-q5`, quote({ number: `QT5-${tag}`, customer: { ...quote().customer, code: existing.code }, lines: [{ name: 'Sewa WiFi', kind: 'SERVICE', qty: 1, unit: 'bulan', unitPrice: 75000 }] }));
    const q = await prisma.crmQuotation.findUniqueOrThrow({ where: { crmId: `${tag}-q5` } });
    await run(q.woId!, 'confirm', ga, { lines: [{ idx: 0, source: 'STOCK', itemId: router.id }] });
    const w = await wo(q.woId!);
    assert.equal(w.status, 'SO_SCHEDULING'); assert.equal((w.data as any).lines[0].source, 'STOCK');
    await run(w.id, 'schedule', focLead, { technicianIds: [tech.id], scheduledAt: new Date().toISOString() });
    // SN di gudang tanpa memilih gudang → diminta pilih gudang; material melebihi Stok Berjalan → ditolak
    await assert.rejects(run(w.id, 'start', tech, { serials: [`RTR-${tag}-1`] }), /pilih gudang/);
    await assert.rejects(run(w.id, 'start', tech, { materials: [{ itemId: itemStock.id, qty: 5 }] }), /Stok Berjalan Anda hanya 3/);
    // SN & material yang masih di Stok Berjalan teknisi: boleh tanpa gudang, tidak berpindah
    await run(w.id, 'start', tech, { serials: [`RTR-${tag}-MOB`], materials: [{ itemId: itemStock.id, qty: 2 }] });
    const d: any = (await wo(w.id)).data;
    assert.deepEqual(d.pickup.serials, [`RTR-${tag}-MOB`]); assert.equal(d.pickup.fromWarehouseId, null);
    assert.equal((await prisma.stockLevel.findUniqueOrThrow({ where: { warehouseId_itemId: { warehouseId: mob.id, itemId: itemStock.id } } })).qty, 3);
    await prisma.attachment.create({ data: { url: `/uploads/${tag}-sewa.jpg`, mime: 'image/jpeg', uploadedBy: tech.id, lat: -6.9, lng: 107.6 } });
    const rep = { photos: [`/uploads/${tag}-sewa.jpg`], workDone: 'Router sewa terpasang', serials: [`RTR-${tag}-MOB`], ownership: 'Milik perusahaan (sewa/pinjam)' };
    await assert.rejects(run(w.id, 'submit_report', tech, { ...rep, materials: [{ itemId: itemProj.id, qty: 1 }] }), /tidak diambil/);
    await assert.rejects(run(w.id, 'submit_report', tech, { ...rep, materials: [{ itemId: itemStock.id, qty: 3 }] }), /yang diambil hanya 2/);
    await run(w.id, 'submit_report', tech, { ...rep, materials: [{ itemId: itemStock.id, qty: 1 }] });
    const a = await prisma.asset.findUniqueOrThrow({ where: { serialNumber: `RTR-${tag}-MOB` } });
    assert.equal(a.status, 'INSTALLED'); assert.equal(a.customerId, existing.id); // sewa: tetap milik perusahaan, terpasang di pelanggan
    assert.equal((await prisma.stockLevel.findUniqueOrThrow({ where: { warehouseId_itemId: { warehouseId: mob.id, itemId: itemStock.id } } })).qty, 2);
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

  await t.test('uji sambung (demo:true): ditandai, pengiriman keluar ditahan, stok balik, purge terarah, daftar rekonsiliasi', async () => {
    const { purgeCrmDemo, crmDemoCounts } = await import('../src/demo-purge');
    const stockQty = async () => (await prisma.stockLevel.findUnique({ where: { warehouseId_itemId: { warehouseId: wh.id, itemId: itemStock.id } } }))?.qty ?? 0;
    const q0 = await stockQty();
    const dq = (over: any = {}) => quote({ number: `QTD-${tag}`, demo: true, customer: { ...quote().customer, name: 'PT Demo Sambung' }, lines: [{ catalogCrmId: `${tag}-cam`, name: 'Kamera', kind: 'PRODUCT', qty: 2, unit: 'unit', unitPrice: 1 }, { name: 'Switch', kind: 'PRODUCT', qty: 1, unit: 'unit', unitPrice: 1 }], ...over });
    const r: any = await (await put(`${tag}-qd`, dq())).json();
    assert.equal(r.demo, true); assert.match(r.woNumber, /^WO-SO-/);
    assert.equal((await put(`${tag}-qd`, dq({ demo: false }))).status, 409); // penanda demo tidak boleh berubah
    const q = await prisma.crmQuotation.findUniqueOrThrow({ where: { crmId: `${tag}-qd` } });
    const w = await wo(q.woId!);
    assert.equal(q.isDemo, true); assert.equal(w.source, 'CRM_DEMO'); assert.equal(w.customer!.source, 'CRM_DEMO');
    await run(w.id, 'confirm', ga, { lines: [{ idx: 1, source: 'PROJECT' }] });
    const pr = await prisma.purchaseRequest.findFirstOrThrow({ where: { woId: w.id } });
    assert.equal(pr.isDemo, true);
    await run(w.id, 'pr_received', ga, {});
    await run(w.id, 'schedule', focLead, { technicianIds: [tech.id], scheduledAt: new Date().toISOString() });
    await run(w.id, 'start', tech, { sourceWarehouseId: wh.id, materials: [{ itemId: itemStock.id, qty: 2 }] });
    assert.equal(await stockQty(), q0 - 2);
    await prisma.attachment.create({ data: { url: `/uploads/${tag}-demo.jpg`, mime: 'image/jpeg', uploadedBy: tech.id, lat: -6.9, lng: 107.6 } });
    await run(w.id, 'submit_report', tech, { photos: [`/uploads/${tag}-demo.jpg`], workDone: 'Demo', materials: [{ itemId: itemStock.id, qty: 1 }] });
    await run(w.id, 'send_ba', mkt, { sendTelegram: true, recipientTelegram: '999', sendEmail: true, recipientEmail: 'pelanggan@demo.test' });
    const d: any = (await wo(w.id)).data;
    assert.equal(d.ba.demo, true);
    // pengiriman keluar ditahan: tidak ada Notification (email/Telegram/WA) untuk WO ini; kotak masuk dalam aplikasi diberi label [DEMO]
    assert.equal(await prisma.notification.count({ where: { woId: w.id } }), 0);
    const inbox = await prisma.inbox.findMany({ where: { woId: w.id } });
    assert.ok(inbox.length > 0 && inbox.every((i) => i.subject.startsWith('[DEMO]')));
    // WO sungguhan (non-demo) tidak ikut terpengaruh oleh purge terarah
    const real = await prisma.crmQuotation.findUniqueOrThrow({ where: { crmId: `${tag}-q1` } });
    // daftar rekonsiliasi
    const list: any = await (await fetch(`${base}/integrations/crm/quotations?demo=only&limit=500`, { headers: { 'x-api-key': KEY } })).json();
    const row = list.data.find((x: any) => x.crmId === `${tag}-qd`);
    assert.ok(row); assert.equal(row.demo, true); assert.equal(row.woNumber, w.number); assert.equal(row.woStatus, 'SO_DONE'); assert.equal(row.total, 1500000);
    const noDemo: any = await (await fetch(`${base}/integrations/crm/quotations?demo=exclude&limit=500`, { headers: { 'x-api-key': KEY } })).json();
    assert.ok(!noDemo.data.some((x: any) => x.crmId === `${tag}-qd`) && noDemo.data.some((x: any) => x.crmId === `${tag}-q1`));
    assert.equal((await fetch(`${base}/integrations/crm/quotations`)).status, 401);
    const c0 = await crmDemoCounts();
    assert.ok(c0.quotations >= 1 && c0.orders >= 1 && c0.customers >= 1 && c0.purchaseRequests >= 1);
    // purge terarah: bertanda demo hilang, stok kembali seperti semula, data sungguhan utuh
    const res = await purgeCrmDemo();
    assert.ok(res.quotations >= 1 && res.orders >= 1);
    assert.deepEqual(await crmDemoCounts(), { quotations: 0, orders: 0, customers: 0, purchaseRequests: 0 });
    assert.equal(await stockQty(), q0, 'stok sungguhan kembali seperti sebelum uji sambung');
    assert.equal(await prisma.workOrder.count({ where: { id: w.id } }), 0);
    assert.ok(await prisma.crmQuotation.findUnique({ where: { id: real.id } }), 'penawaran sungguhan utuh');
    assert.ok(await prisma.workOrder.findUnique({ where: { id: real.woId! } }), 'order sungguhan utuh');
  });
});
