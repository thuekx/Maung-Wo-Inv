import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError, prisma } from '../db';
import { getAssetInfo, getBranding } from '../settings';
import { normSn } from '../inventory';

/**
 * Halaman informasi aset untuk siapa saja yang memindai label QR (tanpa login). Hanya data aman:
 * nama barang, merk/tipe, status, lokasi gudang & nama perusahaan — TIDAK menampilkan nama pelanggan.
 */
export const publicRoutes = Router();

const STATUS: Record<string, string> = {
  IN_STOCK: 'Tersedia di gudang', INSTALLED: 'Terpasang di lokasi pelanggan', IN_USE: 'Sedang digunakan', RETURNED_PENDING_QC: 'Menunggu pemeriksaan (QC)',
  REFURBISHED: 'Siap dipakai kembali', DAMAGED: 'Rusak', SCRAP: 'Afkir / tidak dipakai',
};
const CATEGORY: Record<string, string> = { CONSUMABLE: 'Material habis pakai', NETWORK: 'Perangkat jaringan', GA: 'Aset umum (GA)' };

publicRoutes.get('/public/asset/:sn', rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }), async (req, res) => {
  const a = await prisma.asset.findUnique({
    where: { serialNumber: normSn(String(req.params.sn)) },
    include: { item: true, warehouse: { select: { name: true } }, brand: { select: { name: true } }, model: { select: { name: true } } },
  });
  if (!a) throw new AppError(404, 'Aset tidak terdaftar');
  const [b, info] = await Promise.all([getBranding(), getAssetInfo()]);
  res.json({
    info: { intro: info.intro, footer: info.footer, contacts: info.contacts },
    company: b.companyName,
    appName: b.appName,
    serialNumber: a.serialNumber,
    assetCode: a.assetCode,
    name: a.item.name,
    category: CATEGORY[a.item.category] ?? a.item.category,
    brand: a.brand?.name ?? null,
    model: a.model?.name ?? null,
    status: a.status,
    statusLabel: STATUS[a.status] ?? a.status,
    location: a.status === 'INSTALLED' ? 'Lokasi pelanggan' : a.warehouse?.name ?? null,
    condition: a.condition,
    plateNumber: a.item.isVehicle ? a.plateNumber : null,
    notes: a.notes,
  });
});
