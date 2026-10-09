import { prisma } from './db';

const CUID = /^c[a-z0-9]{24}$/;

function walk(v: unknown, ids: Set<string>, texts: Set<string>) {
  if (typeof v === 'string') { if (CUID.test(v)) ids.add(v); else if (v.length >= 3 && v.length <= 60) texts.add(v); }
  else if (Array.isArray(v)) v.forEach((x) => walk(x, ids, texts));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => walk(x, ids, texts));
}

/**
 * Peta "nilai mentah → teks terbaca" untuk data WO (id user/gudang/barang/PR/area/pelanggan → nama; nomor seri → "Nama barang · Merk Tipe · SN").
 * Dipakai tampilan "Detail & laporan" agar tidak ada id cuid yang muncul ke pengguna.
 */
export async function resolveRefs(data: unknown): Promise<Record<string, string>> {
  const ids = new Set<string>(), texts = new Set<string>();
  walk(data, ids, texts);
  const out: Record<string, string> = {};
  if (ids.size) {
    const id = { in: [...ids] };
    const [users, whs, items, prs, areas, custs] = await Promise.all([
      prisma.user.findMany({ where: { id }, select: { id: true, name: true } }),
      prisma.warehouse.findMany({ where: { id }, select: { id: true, name: true } }),
      prisma.item.findMany({ where: { id }, select: { id: true, name: true, sku: true } }),
      prisma.purchaseRequest.findMany({ where: { id }, select: { id: true, number: true, subject: true } }),
      prisma.area.findMany({ where: { id }, select: { id: true, name: true } }),
      prisma.customer.findMany({ where: { id }, select: { id: true, name: true, code: true } }),
    ]);
    users.forEach((x) => (out[x.id] = x.name));
    whs.forEach((x) => (out[x.id] = x.name));
    items.forEach((x) => (out[x.id] = `${x.name}${x.sku ? ` (${x.sku})` : ''}`));
    prs.forEach((x) => (out[x.id] = x.number ?? x.subject));
    areas.forEach((x) => (out[x.id] = x.name));
    custs.forEach((x) => (out[x.id] = `${x.name} (${x.code})`));
  }
  if (texts.size) {
    const assets = await prisma.asset.findMany({ where: { serialNumber: { in: [...texts] } }, include: { item: { select: { name: true } }, brand: { select: { name: true } }, model: { select: { name: true } } } });
    for (const a of assets) out[a.serialNumber] = [a.item.name, [a.brand?.name, a.model?.name].filter(Boolean).join(' '), `SN ${a.serialNumber}`].filter(Boolean).join(' · ');
  }
  return out;
}
