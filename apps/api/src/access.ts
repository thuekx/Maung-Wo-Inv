import type { RequestHandler } from 'express';
import { AppError } from './db';
import { getSetting, putSetting } from './settings';

/**
 * Hak akses fitur per divisi + sub-role (matriks di Admin → Hak Akses). Admin selalu boleh.
 * Token: `MKT:MANAGER` = divisi Marketing sub-role Manager. Bila Admin belum mengubah satu fitur, berlaku bawaan (perilaku semula).
 */
export const DIVISIONS = ['MKT', 'NOC', 'FOC', 'GA', 'FIN'] as const;
export const SUBROLES = ['MANAGER', 'SUPERVISOR', 'STAFF'] as const;
type Div = (typeof DIVISIONS)[number];

interface Feature { key: string; label: string; desc: string; group: string; defaults: Div[]; leadAll?: boolean }
export const FEATURES: Feature[] = [
  { key: 'subscriptions', group: 'Pemasaran', label: 'Form Berlangganan', desc: 'Menu, daftar, buat/ubah/hapus, cetak formulir', defaults: ['MKT'] },
  { key: 'customers', group: 'Pelanggan', label: 'Pelanggan — lihat', desc: 'Menu Pelanggan, detail, ekspor Excel, status MSRadius', defaults: ['MKT', 'NOC', 'FIN', 'GA'] },
  { key: 'customers.edit', group: 'Pelanggan', label: 'Pelanggan — ubah & impor', desc: 'Ubah data jaringan/pelanggan manual, impor Excel', defaults: ['MKT', 'NOC'] },
  { key: 'customers.manage', group: 'Pelanggan', label: 'Pelanggan — tambah, hapus & tarik MSRadius', desc: 'Tambah/hapus pelanggan, sinkron & tarik data MSRadius', defaults: ['MKT'] },
  { key: 'master.packages', group: 'Master Data', label: 'Master: paket/jasa', desc: 'Kelola paket layanan', defaults: ['MKT'] },
  { key: 'master.ga', group: 'Master Data', label: 'Master: area, vendor, merek, barang, gudang', desc: 'Kelola master pengadaan & inventori', defaults: ['GA'] },
  { key: 'inventory', group: 'Inventori', label: 'Inventori & Aset — lihat', desc: 'Menu Inventori, stok, mutasi, aset, cek stok WO', defaults: ['GA'] },
  { key: 'inventory.manage', group: 'Inventori', label: 'Inventori & Aset — kelola', desc: 'Stok masuk/keluar, transfer gudang, QC, aset', defaults: ['GA'] },
  { key: 'stock.mine', group: 'Inventori', label: 'Stok Saya (stok pribadi/mobil)', desc: 'Menu Stok Saya untuk teknisi', defaults: ['FOC'] },
  { key: 'purchase_requests', group: 'Pengadaan', label: 'Purchase Request — menu', desc: 'Menu & daftar PR (pembuatan PR juga mengikuti peran GA/atasan)', defaults: ['GA', 'FIN'], leadAll: true },
  { key: 'purchase_orders', group: 'Pengadaan', label: 'Purchase Order — lihat', desc: 'Menu & daftar PO', defaults: ['GA', 'FIN'] },
  { key: 'procurement.manage', group: 'Pengadaan', label: 'Pengadaan — kelola', desc: 'Vendor, terbitkan PR, catat PO Accurate, penerimaan', defaults: ['GA'] },
];
export const FEATURE_KEYS = FEATURES.map((f) => f.key);

const tok = (d: string, s: string) => `${d}:${s}`;
export function defaultTokens(f: Feature): string[] {
  const out = f.defaults.flatMap((d) => SUBROLES.map((s) => tok(d, s)));
  if (f.leadAll) for (const d of DIVISIONS) for (const s of ['MANAGER', 'SUPERVISOR']) out.push(tok(d, s));
  return [...new Set(out)];
}

export type AccessOverrides = Record<string, string[]>;
export async function getOverrides(): Promise<AccessOverrides> {
  const v = await getSetting<{ overrides?: AccessOverrides }>('access');
  return v?.overrides ?? {};
}
export async function saveOverrides(o: AccessOverrides, userId: string) { await putSetting('access', { overrides: o }, userId); }

/** Matriks efektif: fitur → token yang diizinkan. */
export async function effectiveMatrix(): Promise<Record<string, string[]>> {
  const o = await getOverrides();
  return Object.fromEntries(FEATURES.map((f) => [f.key, o[f.key] ?? defaultTokens(f)]));
}

export async function featuresFor(u: { role: string; subRole?: string | null }): Promise<string[]> {
  if (u.role === 'ADMIN') return FEATURE_KEYS.filter((k) => k !== 'stock.mine'); // Stok Saya = stok pribadi teknisi (hanya saat Admin bertindak sebagai FOC)
  const m = await effectiveMatrix();
  const t = tok(u.role, u.subRole ?? 'STAFF');
  return FEATURE_KEYS.filter((k) => m[k].includes(t));
}

/** Pengganti `requireRole(...)` untuk fitur yang hak aksesnya dapat diatur di Admin. */
export const requireFeature = (key: string): RequestHandler => async (req, _res, next) => {
  const u = req.user!;
  if (u.role !== 'ADMIN' && !(await featuresFor(u)).includes(key)) throw new AppError(403, 'Anda tidak memiliki akses ke fitur ini. Hubungi Admin.');
  next();
};
