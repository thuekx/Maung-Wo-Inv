/**
 * Data demo untuk semua proses, dibuat dengan menjalankan engine WO yang sebenarnya
 * (bukan insert mentah), sehingga status, stok, aset, dan riwayat konsisten.
 * Jalankan setelah seed dasar:  docker compose exec api node dist/prisma/seed-demo.js
 * Aman dijalankan sekali; kedua kalinya dihentikan oleh penanda di tabel Setting.
 * Notifikasi yang dibuat TIDAK dikirim (status SKIPPED) agar tidak mengirim email/Telegram ke akun demo.
 */
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/db';
import { Effects } from '../src/effects';
import { applyAction, createWorkOrder } from '../src/engine';
import { nextNumber } from '../src/inventory';
import { config } from '../src/config';
import { PACKAGES } from '../src/workflows';
import type { Actor } from '../src/wf-types';
import type { WoType } from '../src/orm';

const started = new Date();
const DAY = 86400_000;
const A: Record<string, Actor> = {};
let ID: Record<string, string> = {}; // sku → itemId
let WH: Record<string, string> = {}; // code → warehouseId
const closedWos: string[] = [];

const tx = <T>(fn: (fx: Effects) => Promise<T>) => prisma.$transaction((t) => fn(new Effects(t)), { timeout: 60_000 });
const create = (type: WoType, who: string, input: Record<string, any>) => tx((fx) => createWorkOrder(fx, { type, actor: A[who], input }));
const act = (woId: string, key: string, who: string, input: Record<string, any> = {}) => tx((fx) => applyAction(fx, woId, key, A[who], input));
const status = async (woId: string) => (await prisma.workOrder.findUniqueOrThrow({ where: { id: woId } })).status;

/** Foto demo: SVG bertanda GPS + nama PT (hanya contoh tampilan; foto asli dibuat di aplikasi). */
let photoN = 0;
async function photo(lat: number, lng: number, label: string, by = 'budi') {
  photoN++;
  const name = `demo-photo-${String(photoN).padStart(3, '0')}.svg`;
  const hue = (photoN * 47) % 360;
  const stamp = new Date().toLocaleString('id-ID');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720" viewBox="0 0 960 720">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,38%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},60%,22%)"/></linearGradient></defs>
<rect width="960" height="720" fill="url(#g)"/>
<g fill="none" stroke="rgba(255,255,255,.35)" stroke-width="6" stroke-linecap="round"><path d="M80 520 C 300 380, 520 600, 880 300"/><path d="M80 560 C 300 420, 520 640, 880 340" stroke-dasharray="2 18"/></g>
<text x="480" y="330" font-family="sans-serif" font-size="44" font-weight="700" fill="#fff" text-anchor="middle">FOTO DEMO</text>
<text x="480" y="378" font-family="sans-serif" font-size="26" fill="rgba(255,255,255,.85)" text-anchor="middle">${label}</text>
<rect y="600" width="960" height="120" fill="rgba(0,0,0,.6)"/>
<circle cx="64" cy="660" r="34" fill="#fff"/><text x="64" y="670" font-family="sans-serif" font-size="22" font-weight="800" fill="#1d4ed8" text-anchor="middle">LOGO</text>
<text x="122" y="640" font-family="sans-serif" font-size="26" font-weight="700" fill="#fff">PT L1V (demo)</text>
<text x="122" y="672" font-family="sans-serif" font-size="22" fill="#e2e8f0">GPS ${lat.toFixed(6)}, ${lng.toFixed(6)} (±8 m)</text>
<text x="122" y="702" font-family="sans-serif" font-size="20" fill="#cbd5e1">${stamp}</text>
</svg>`;
  fs.mkdirSync(config.uploadDir, { recursive: true });
  fs.writeFileSync(path.join(config.uploadDir, name), svg);
  const url = `/uploads/${name}`;
  await prisma.attachment.create({ data: { url, mime: 'image/svg+xml', uploadedBy: A[by].id, lat, lng, accuracy: 8, takenAt: new Date(), kind: 'REPORT' } });
  return url;
}

type Stage = 'noc_validation' | 'ready' | 'scheduled' | 'in_progress' | 'physical_done' | 'awaiting_ba' | 'closed';
const ORDER: Stage[] = ['noc_validation', 'ready', 'scheduled', 'in_progress', 'physical_done', 'awaiting_ba', 'closed'];
const STREETS = ['Jl. Melati', 'Jl. Kenanga', 'Jl. Anggrek', 'Jl. Mawar', 'Jl. Cempaka', 'Jl. Flamboyan', 'Jl. Dahlia', 'Jl. Kamboja'];
let seq = 0;

async function install(name: string, o: { until: Stage; cab?: boolean; tech?: 'budi' | 'andi' }) {
  const i = ++seq;
  const lat = -6.2 + (i % 9) * 0.011, lng = 106.8 + (i % 7) * 0.013;
  const wh = o.cab ? WH['WH-CAB-A'] : WH['WH-PUSAT'];
  const at = (s: Stage) => ORDER.indexOf(o.until) >= ORDER.indexOf(s);
  const tech = o.tech ?? (i % 2 ? 'budi' : 'andi');
  const wo = await create('NEW_INSTALL', 'mkt', {
    name, phone: `08121${String(100000 + i * 137).slice(0, 6)}`, email: `${name.toLowerCase().replace(/[^a-z]/g, '')}@contoh.id`,
    address: `${STREETS[i % STREETS.length]} No. ${10 + i}, Jakarta`, lat, lng, packageName: PACKAGES[i % 4], warehouseId: wh, notes: 'Data demo',
  });
  const cust = (await prisma.workOrder.findUniqueOrThrow({ where: { id: wo.id } })).customerId!;
  if (!at('ready')) return { ...wo, customerId: cust };

  await act(wo.id, 'validate', 'noc', { odp: `ODP-${String.fromCharCode(65 + (i % 5))}${1 + (i % 4)}`, port: String(i), vlan: String(100 + (i % 3)), ip: `10.20.${i}.10`, note: 'Coverage OK' });
  if ((await status(wo.id)) !== 'READY_TO_SCHEDULE' || !at('scheduled')) return { ...wo, customerId: cust };

  await act(wo.id, 'schedule', tech, { technicianId: A[tech].id, scheduledAt: new Date(Date.now() + DAY).toISOString(), note: 'Konfirmasi ke pelanggan' });
  if (!at('in_progress')) return { ...wo, customerId: cust };

  const ont = await prisma.asset.findFirstOrThrow({ where: { itemId: ID.ONT, warehouseId: wh, status: 'IN_STOCK' }, orderBy: { serialNumber: 'asc' } });
  await act(wo.id, 'start', tech, { sourceWarehouseId: wh, serials: [ont.serialNumber], materials: [{ itemId: ID.DROPCORE, qty: 120 }, { itemId: ID.FASTCONN, qty: 2 }, { itemId: ID.SLEEVE, qty: 2 }] });
  if (!at('physical_done')) {
    // sampel progres lapangan (foto GPS) untuk WO yang sedang dikerjakan
    const p = await photo(lat, lng, 'Progres: tarik kabel dropcore', tech);
    await tx(async (fx) => {
      await fx.tx.attachment.updateMany({ where: { url: p }, data: { woId: wo.id, kind: 'PROGRESS', note: 'Penarikan kabel dari ODP selesai 60%' } });
      await fx.tx.woEvent.create({ data: { woId: wo.id, action: 'progress', fromStatus: 'IN_PROGRESS', toStatus: 'IN_PROGRESS', actorId: A[tech].id, actorName: A[tech].name, note: 'Penarikan kabel dari ODP selesai 60%', payload: { photos: [p] } } });
    });
    return { ...wo, customerId: cust };
  }

  await act(wo.id, 'submit_report', tech, {
    serials: [ont.serialNumber], cableMeters: 95, materials: [{ itemId: ID.FASTCONN, qty: 2 }, { itemId: ID.SLEEVE, qty: 2 }], opmDbm: -19.4,
    photos: [await photo(lat, lng, 'Perangkat ONT terpasang', tech), await photo(lat, lng, 'Hasil OPM -19.4 dBm', tech)], note: 'Instalasi rapi, sinyal stabil',
  });
  if (!at('awaiting_ba')) return { ...wo, customerId: cust };

  await act(wo.id, 'service_active', 'noc', { ontAuthorized: true, profile: 'HOME-20M', pingMs: 4, latencyMs: 6, downMbps: 19.4, upMbps: 19.1, stable: true, note: 'Aktivasi OK' });
  if (!at('closed')) return { ...wo, customerId: cust };

  await act(wo.id, 'send_ba', 'mkt', {});
  closedWos.push(wo.id);
  return { ...wo, customerId: cust };
}

const technicianUnused = (t: string) => A[t].id;

/** Pelanggan aktif lengkap (pasang baru selesai) sebagai bahan skenario lanjutan. */
const active = (name: string) => install(name, { until: 'closed' });

async function trouble(cust: string, until: 'diagnose' | 'dispatch' | 'scheduled' | 'in_progress' | 'verify' | 'confirm' | 'closed' | 'remote', sev = 'Medium', tech: 'budi' | 'andi' = 'budi') {
  const ORDER_T = ['diagnose', 'dispatch', 'scheduled', 'in_progress', 'verify', 'confirm', 'closed'];
  const wo = await create('TROUBLE', 'mkt', { customerId: cust, source: 'Komplain pelanggan', severity: sev, description: 'Internet putus-putus sejak pagi, lampu LOS berkedip merah' });
  if (until === 'diagnose') return wo;
  if (until === 'remote') { await act(wo.id, 'resolve_remote', 'noc', { rootCause: 'Sesi PPPoE hang', fix: 'Reset sesi dan profil dari NOC' }); await act(wo.id, 'confirm', 'mkt', {}).catch(() => {}); closedWos.push(wo.id); return wo; }
  await act(wo.id, 'escalate_field', 'noc', { cause: 'Redaman tinggi', note: 'Redaman -27 dBm, diduga konektor kotor/tikungan kabel' });
  const at = (s: string) => ORDER_T.indexOf(until) >= ORDER_T.indexOf(s);
  if (!at('scheduled')) return wo;
  await act(wo.id, 'schedule', tech, { technicianId: A[tech].id, scheduledAt: new Date(Date.now() + DAY / 2).toISOString() });
  if (!at('in_progress')) return wo;
  await act(wo.id, 'start', tech, { note: 'Berangkat ke lokasi' });
  if (!at('verify')) return wo;
  const c = await prisma.customer.findUniqueOrThrow({ where: { id: cust } });
  await act(wo.id, 'submit_report', tech, { cableMeters: 0, opmDbm: -20.3, photos: [await photo(c.lat ?? -6.2, c.lng ?? 106.8, 'Pembersihan konektor & OPM', tech)], note: 'Konektor dibersihkan, tikungan kabel dirapikan', serialsNew: [], serialsOld: [], materials: [] });
  if (!at('confirm')) return wo;
  await act(wo.id, 'verify_up', 'noc', { pingMs: 5, note: 'Koneksi normal' });
  if (!at('closed')) return wo;
  await act(wo.id, 'confirm', 'mkt', { note: 'Pelanggan puas' });
  closedWos.push(wo.id);
  return wo;
}

async function terminate(cust: string, until: 'noc' | 'dispatch' | 'scheduled' | 'in_progress' | 'qc' | 'fin' | 'closed', tech: 'budi' | 'andi' = 'andi') {
  const O = ['noc', 'dispatch', 'scheduled', 'in_progress', 'qc', 'fin', 'closed'];
  const at = (s: string) => O.indexOf(until) >= O.indexOf(s);
  const wo = await create('TERMINATE', 'mkt', { customerId: cust, reason: 'Berhenti berlangganan', note: 'Pelanggan pindah kota' });
  if (!at('dispatch')) return wo;
  await act(wo.id, 'deactivate', 'noc', { vlanRemoved: true, ipReleased: true, ontUnauthorized: true, note: 'Konfigurasi dibersihkan' });
  if (!at('scheduled')) return wo;
  await act(wo.id, 'schedule', tech, { technicianId: A[tech].id, scheduledAt: new Date(Date.now() + DAY).toISOString() });
  if (!at('in_progress')) return wo;
  await act(wo.id, 'start', tech, { note: 'Menuju lokasi penarikan' });
  if (!at('qc')) return wo;
  const c = await prisma.customer.findUniqueOrThrow({ where: { id: cust } });
  const installed = await prisma.asset.findMany({ where: { customerId: cust, status: 'INSTALLED' } });
  await act(wo.id, 'submit_report', tech, { serials: installed.map((a) => a.serialNumber), photos: [await photo(c.lat ?? -6.2, c.lng ?? 106.8, 'Perangkat ditarik', tech)], note: 'Perangkat lengkap ditarik' });
  if (!at('fin')) return wo;
  await act(wo.id, 'qc', 'ga', { results: installed.map((a) => ({ serial: a.serialNumber, result: 'GOOD', warehouseId: WH['WH-PUSAT'], note: 'Layak pakai' })) });
  if (!at('closed')) return wo;
  await act(wo.id, 'close_account', 'fin', {});
  closedWos.push(wo.id);
  return wo;
}

async function main() {
  if (await prisma.setting.findUnique({ where: { key: 'demoSeed' } })) {
    console.log('Data demo sudah pernah dibuat (penanda demoSeed). Tidak ada yang diubah.');
    return;
  }
  for (const [k, email] of Object.entries({ mkt: 'mkt@l1v.local', noc: 'noc@l1v.local', budi: 'budi@l1v.local', andi: 'andi@l1v.local', ga: 'ga@l1v.local', fin: 'fin@l1v.local' })) {
    const u = await prisma.user.findUnique({ where: { email } });
    if (!u) throw new Error(`User ${email} belum ada — jalankan seed dasar dulu (node dist/prisma/seed.js)`);
    A[k] = { id: u.id, name: u.name, role: u.role };
  }
  ID = Object.fromEntries((await prisma.item.findMany()).map((i) => [i.sku, i.id]));
  WH = Object.fromEntries((await prisma.warehouse.findMany()).map((w) => [w.code, w.id]));
  technicianUnused('budi');

  // bahan baku: ONT tambahan di gudang pusat, stok cabang A dibuat tipis agar memicu Permintaan Barang otomatis
  const have = await prisma.asset.count({ where: { itemId: ID.ONT } });
  for (let n = have + 1; n <= have + 30; n++) await prisma.asset.create({ data: { itemId: ID.ONT, serialNumber: `ONT-DEMO-${String(n).padStart(4, '0')}`, warehouseId: WH['WH-PUSAT'] } });
  await prisma.stockLevel.upsert({ where: { warehouseId_itemId: { warehouseId: WH['WH-CAB-A'], itemId: ID.DROPCORE } }, update: { qty: 60 }, create: { warehouseId: WH['WH-CAB-A'], itemId: ID.DROPCORE, qty: 60 } });
  await prisma.stockLevel.upsert({ where: { warehouseId_itemId: { warehouseId: WH['WH-CAB-A'], itemId: ID.FASTCONN } }, update: { qty: 1 }, create: { warehouseId: WH['WH-CAB-A'], itemId: ID.FASTCONN, qty: 1 } });

  console.log('• Pasang Baru di setiap tahap');
  const aged: string[] = [];
  const n1 = await install('Budi Santoso', { until: 'noc_validation' }); aged.push(n1.id);
  await install('Siti Rahma', { until: 'ready' });
  const n3 = await install('Agus Wijaya', { until: 'ready', cab: true }); aged.push(n3.id); // stok cabang kurang → STOCK_PENDING + WO anak
  await install('Dewi Lestari', { until: 'scheduled', tech: 'budi' });
  await install('Rudi Hartono', { until: 'in_progress', tech: 'budi' });
  await install('Maya Putri', { until: 'physical_done', tech: 'andi' });
  await install('Hendra Gunawan', { until: 'awaiting_ba', tech: 'andi' });
  await install('Lina Marlina', { until: 'closed' });

  console.log('• Pelanggan aktif untuk skenario lanjutan');
  const C: string[] = [];
  for (const n of ['Toko Maju Jaya', 'Warnet Bintang', 'Kafe Senja', 'Klinik Sehat', 'Bengkel Sinar', 'Apotek Murni', 'Ruko Mandiri', 'Kos Putri Asri', 'Salon Cantika', 'Laundry Bersih', 'CV Karya Utama', 'Sekolah Cerdas', 'Rumah Makan Padang', 'Studio Foto Lensa', 'Kantor Notaris', 'Toko Buku Pelita']) C.push((await active(n)).customerId);

  console.log('• Trouble Ticket di setiap tahap');
  const tt = await trouble(C[0], 'diagnose', 'High'); aged.push(tt.id);
  await trouble(C[1], 'dispatch', 'Critical');
  await trouble(C[2], 'scheduled', 'Medium', 'budi');
  await trouble(C[3], 'in_progress', 'High', 'andi');
  await trouble(C[4], 'verify', 'Medium', 'budi');
  await trouble(C[5], 'confirm', 'Low', 'andi');
  await trouble(C[6], 'remote', 'Low');

  console.log('• Suspend / Unsuspend');
  const sp1 = await create('SUSPEND', 'fin', { customerId: C[7], reason: 'Tunggakan pembayaran', note: 'Menunggak 2 bulan' }); void sp1;
  const sp2 = await create('SUSPEND', 'fin', { customerId: C[8], reason: 'Cuti berlangganan' });
  await act(sp2.id, 'isolate', 'noc', { profile: 'ISOLIR' }); closedWos.push(sp2.id);
  const sp3 = await create('SUSPEND', 'fin', { customerId: C[9], reason: 'Tunggakan pembayaran' });
  await act(sp3.id, 'isolate', 'noc', { profile: 'ISOLIR' }); closedWos.push(sp3.id);
  await create('UNSUSPEND', 'fin', { customerId: C[9], note: 'Pelunasan diterima via transfer' });

  console.log('• Terminate & penarikan aset');
  await terminate(C[10], 'noc');
  await terminate(C[11], 'dispatch');
  await terminate(C[12], 'scheduled', 'budi');
  await terminate(C[13], 'in_progress', 'andi');
  await terminate(C[14], 'qc');
  await terminate(C[15], 'fin');
  const old = await active('Toko Lama Sejahtera');
  await terminate(old.customerId, 'closed');

  console.log('• Permintaan Barang / PO');
  const lines = (...l: [string, number][]) => l.map(([sku, qty]) => ({ itemId: ID[sku], qty }));
  const sr1 = await create('STOCK_REQUEST', 'budi', { toWarehouseId: WH['WH-CAB-A'], lines: lines(['DROPCORE', 500], ['FASTCONN', 50]), reason: 'Stok mobile menipis, butuh restock untuk cabang A' }); aged.push(sr1.id);
  const sr2 = await create('STOCK_REQUEST', 'noc', { toWarehouseId: WH['WH-PUSAT'], lines: lines(['PIGTAIL', 100]), reason: 'Pigtail habis untuk splicing ODP baru' });
  await act(sr2.id, 'create_po', 'ga', { vendor: 'PT Fiber Nusantara', note: 'Termin 14 hari' });
  const sr3 = await create('STOCK_REQUEST', 'ga', { toWarehouseId: WH['WH-CAB-A'], lines: lines(['SLEEVE', 40]), reason: 'Kebutuhan sleeve cabang A' });
  await act(sr3.id, 'transfer', 'ga', { fromWarehouseId: WH['WH-PUSAT'] });
  const sr4 = await create('STOCK_REQUEST', 'ga', { toWarehouseId: WH['WH-CAB-A'], lines: lines(['FASTCONN', 30]), reason: 'Restock fast connector' });
  await act(sr4.id, 'transfer', 'ga', { fromWarehouseId: WH['WH-PUSAT'] });
  await act(sr4.id, 'receive', 'ga', { note: 'Diterima lengkap' }); closedWos.push(sr4.id);

  console.log('• Aset GA & kondisi stok');
  await prisma.$transaction(async (t) => {
    const gaItems: [string, number][] = [['AC', 3], ['LAPTOP', 10], ['CAR', -2], ['MOTOR', 45]];
    for (const [sku, days] of gaItems) {
      const code = await nextNumber(t, 'GA', false);
      await t.asset.create({ data: { itemId: ID[sku], serialNumber: code, assetCode: code, status: 'IN_USE', warehouseId: WH['WH-PUSAT'], nextMaintenanceAt: new Date(Date.now() + days * DAY), notes: 'Aset demo' } });
    }
  });
  // fast connector pusat dibuat di bawah minimum → muncul "menipis" di dashboard
  await prisma.stockLevel.updateMany({ where: { warehouseId: WH['WH-PUSAT'], itemId: ID.FASTCONN }, data: { qty: 60 } });

  console.log('• Merapikan waktu (umur WO untuk dashboard) & notifikasi');
  for (const [k, id] of aged.entries()) await prisma.workOrder.update({ where: { id }, data: { createdAt: new Date(Date.now() - (9 + k * 3) * DAY) } });
  for (const [k, id] of closedWos.entries()) {
    const d = 1 + (k % 13);
    await prisma.workOrder.update({ where: { id }, data: { createdAt: new Date(Date.now() - (d + 2) * DAY), closedAt: new Date(Date.now() - d * DAY) } });
  }
  const skipped = await prisma.notification.updateMany({ where: { status: 'PENDING', createdAt: { gte: started } }, data: { status: 'SKIPPED', error: 'Data demo — tidak dikirim' } });
  await prisma.setting.create({ data: { key: 'demoSeed', value: { at: new Date().toISOString(), notificationsSkipped: skipped.count } } });
  console.log(`Selesai. WO demo: ${await prisma.workOrder.count()} · pelanggan: ${await prisma.customer.count()} · notifikasi dilewati: ${skipped.count}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); process.exit(process.exitCode ?? 0); }); // koneksi Redis dari modul queue tidak perlu ditutup
