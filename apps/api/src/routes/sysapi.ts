import { Router } from 'express';
import { AppError, prisma } from '../db';
import { authenticate, requireRole } from '../auth';
import { config } from '../config';

/** Katalog API sistem ini untuk dibaca aplikasi lain (khusus Admin): endpoint, autentikasi, dan contoh respons nyata. */
export const systemApiRoutes = Router();
systemApiRoutes.use('/admin/system-api', authenticate, requireRole('ADMIN'));

const EXPORT = [
  { key: 'customers', description: 'Pelanggan: kode, kontak, alamat, paket, status, ODP/port/VLAN/IP, area' },
  { key: 'work-orders', description: 'WO + pelanggan, pembuat, tim, data isian (?include=events menambah riwayat)' },
  { key: 'items', description: 'Master barang: SKU, kategori, satuan, batas minimum' },
  { key: 'warehouses', description: 'Gudang (pusat/cabang/mobile)' },
  { key: 'stock', description: 'Stok kuantitas per gudang per barang' },
  { key: 'assets', description: 'Aset ber-SN: merk, tipe, status, lokasi, pelanggan, jadwal maintenance' },
  { key: 'movements', description: 'Riwayat mutasi stok/aset' },
  { key: 'purchase-orders', description: 'PO + baris barang' },
];

systemApiRoutes.get('/admin/system-api', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const hint = (k: string) => (k ? `••••${k.slice(-4)}` : '');
  res.json({
    baseUrl: base,
    export: { enabled: !!config.exportApiKey, keyHint: hint(config.exportApiKey), header: 'x-api-key', rateLimit: '120 permintaan / menit / IP', resources: EXPORT.map((e) => ({ ...e, path: `/api/export/${e.key}` })), params: [['format', 'json | csv (default json)'], ['limit', '1–5000 (default 1000)'], ['cursor', 'nextCursor dari respons sebelumnya'], ['since', 'tanggal ISO; hanya data baru/diubah sejak itu'], ['include', 'khusus work-orders: events']] },
    billing: { enabled: !!config.billing.apiKey, keyHint: hint(config.billing.apiKey), header: 'x-api-key', endpoints: [
      { method: 'POST', path: '/api/integrations/billing/events', description: 'Billing → Maung: buat WO Suspend / Unsuspend / Terminate otomatis', body: '{"event":"suspend|unsuspend|terminate","customerCode":"…","reason":"…","invoiceRef":"…"}' },
      { method: 'GET', path: '/api/integrations/billing/customers/{kode}', description: 'Billing membaca status layanan pelanggan (status, tanggal aktif, paket)', body: '' },
    ] },
    public: { endpoints: [{ method: 'GET', path: '/api/public/asset/{SN}', description: 'Info aset untuk halaman label QR (tanpa kunci; tanpa data pelanggan)' }] },
  });
});

/** Contoh respons nyata: Maung memanggil API-nya sendiri dengan kunci server (kunci tidak dikirim ke browser). Hanya 1 data. */
systemApiRoutes.post('/admin/system-api/sample', async (req, res) => {
  const { kind, resource } = (req.body ?? {}) as { kind?: string; resource?: string };
  const base = `http://127.0.0.1:${config.port}`;
  let url: string; let headers: Record<string, string> = {};
  if (kind === 'export') {
    if (!config.exportApiKey) throw new AppError(400, 'EXPORT_API_KEY belum diisi di .env — API ekspor nonaktif');
    if (!EXPORT.some((e) => e.key === resource)) throw new AppError(400, 'Resource tidak dikenal');
    url = `${base}/api/export/${resource}?limit=1`; headers = { 'x-api-key': config.exportApiKey };
  } else if (kind === 'billing-customer') {
    const c = await prisma.customer.findFirst({ where: { archivedAt: null }, select: { code: true } });
    if (!c) throw new AppError(404, 'Belum ada pelanggan');
    url = `${base}/api/integrations/billing/customers/${encodeURIComponent(c.code)}`; headers = { 'x-api-key': config.billing.apiKey };
  } else if (kind === 'public-asset') {
    const a = await prisma.asset.findFirst({ select: { serialNumber: true } });
    if (!a) throw new AppError(404, 'Belum ada aset');
    url = `${base}/api/public/asset/${encodeURIComponent(a.serialNumber)}`;
  } else throw new AppError(400, 'Jenis contoh tidak dikenal');
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  const body: unknown = await r.json().catch(() => null);
  res.json({ httpStatus: r.status, sample: body });
});
