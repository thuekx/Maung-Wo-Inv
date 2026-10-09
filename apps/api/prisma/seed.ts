import type { Role, ItemCategory } from '../src/orm';
import { prisma } from '../src/db';
import bcrypt from 'bcryptjs';
import { PACKAGES } from '../src/workflows';

const PASSWORD = process.env.SEED_PASSWORD ?? 'Passw0rd!';

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 10);

  // User sistem: dipakai sebagai "pembuat" WO dari billing. Nonaktif → tidak bisa login & tidak menerima notifikasi.
  await prisma.user.upsert({
    where: { email: 'system@l1v.local' },
    update: {},
    create: { name: 'Sistem', email: 'system@l1v.local', passwordHash: await bcrypt.hash(Math.random().toString(36), 10), role: 'ADMIN', active: false },
  });

  const users: [string, string, Role][] = [
    ['Admin', 'admin@l1v.local', 'ADMIN'],
    ['Marketing', 'mkt@l1v.local', 'MKT'],
    ['NOC Engineer', 'noc@l1v.local', 'NOC'],
    ['Teknisi Budi', 'budi@l1v.local', 'FOC'],
    ['Teknisi Andi', 'andi@l1v.local', 'FOC'],
    ['GA / Procurement', 'ga@l1v.local', 'GA'],
    ['Finance', 'fin@l1v.local', 'FIN'],
  ];
  for (const [name, email, role] of users)
    await prisma.user.upsert({ where: { email }, update: {}, create: { name, email, role, passwordHash: hash } });

  // Master paket/jasa awal (dapat ditambah/dikurangi di menu Master Paket)
  for (const [i, name] of PACKAGES.entries()) await prisma.package.upsert({ where: { name }, update: {}, create: { name, sortOrder: i } });

  const wh = async (code: string, name: string, kind: 'MAIN' | 'BRANCH' | 'TRANSIT') =>
    prisma.warehouse.upsert({ where: { code }, update: {}, create: { code, name, kind } });
  const main = await wh('WH-PUSAT', 'Gudang Pusat', 'MAIN');
  const cabA = await wh('WH-CAB-A', 'Gudang Cabang A', 'BRANCH');
  await wh('WH-TRANSIT', 'Gudang Transit', 'TRANSIT');

  const item = (sku: string, name: string, category: ItemCategory, extra: { unit?: string; installDefaultQty?: number; minStock?: number; coreCount?: number; isVehicle?: boolean } = {}) =>
    prisma.item.upsert({
      where: { sku },
      update: {},
      create: { sku, name, category, tracked: category !== 'CONSUMABLE', unit: extra.unit ?? 'pcs', installDefaultQty: extra.installDefaultQty, minStock: extra.minStock ?? 0, coreCount: extra.coreCount, isVehicle: extra.isVehicle ?? false },
    });

  const dropcore = await item('DROPCORE', 'Kabel Dropcore', 'CONSUMABLE', { unit: 'meter', installDefaultQty: 100, minStock: 2000, coreCount: 1 });
  await item('DROPCORE2', 'Kabel Dropcore 2 Core', 'CONSUMABLE', { unit: 'meter', minStock: 500, coreCount: 2 });
  const fast = await item('FASTCONN', 'Fast Connector', 'CONSUMABLE', { installDefaultQty: 2, minStock: 100 });
  const sleeve = await item('SLEEVE', 'Protection Sleeve', 'CONSUMABLE', { installDefaultQty: 2, minStock: 100 });
  await item('PIGTAIL', 'Pigtail', 'CONSUMABLE', { minStock: 20 });
  const ont = await item('ONT', 'ONT', 'NETWORK', { installDefaultQty: 1, minStock: 5 });
  await item('ROUTER', 'Router WiFi', 'NETWORK');
  for (const [sku, name] of [['OLT', 'OLT'], ['SFP', 'SFP Module'], ['SWITCH', 'Switch'], ['SPLICER', 'Splicer'], ['OTDR', 'OTDR']] as const) await item(sku, name, 'NETWORK');
  for (const [sku, name] of [['CAR', 'Mobil Operasional'], ['MOTOR', 'Motor Operasional'], ['LAPTOP', 'Laptop Kantor'], ['AC', 'AC'], ['FURN', 'Meja/Kursi'], ['TOOLS', 'Alat Pertukangan']] as const) await item(sku, name, 'GA', { isVehicle: sku === 'CAR' || sku === 'MOTOR' });

  // Demo stok awal (hanya jika masih kosong)
  if ((await prisma.stockLevel.count()) === 0) {
    const set = (warehouseId: string, itemId: string, qty: number) => prisma.stockLevel.create({ data: { warehouseId, itemId, qty } });
    await set(main.id, dropcore.id, 3000);
    await set(main.id, fast.id, 300);
    await set(main.id, sleeve.id, 300);
    await set(cabA.id, dropcore.id, 150); // cabang A sengaja tipis → memicu Permintaan Barang otomatis
    await set(cabA.id, fast.id, 10);
    await set(cabA.id, sleeve.id, 10);
    for (let i = 1; i <= 10; i++) await prisma.asset.create({ data: { itemId: ont.id, serialNumber: `ONT-DEMO-${String(i).padStart(4, '0')}`, warehouseId: i <= 8 ? main.id : cabA.id } });
  }
  console.log(`Seed selesai. Login contoh: admin@l1v.local / ${PASSWORD}`);
}

main().finally(() => prisma.$disconnect());
