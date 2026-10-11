import { Router } from 'express';
import { z } from 'zod';
import { AppError, prisma } from '../db';
import { authenticate, requireRole } from '../auth';
import { workflows } from '../workflows';

/** Laporan dari data yang ada sekarang — khusus Admin. Periode `from`/`to` (tanggal) berlaku untuk laporan berbasis waktu. */
export const reportRoutes = Router();
// Dibatasi per path: `use` tanpa path akan menahan SEMUA permintaan yang lewat router ini (termasuk router berikutnya).
reportRoutes.use(['/admin/reports', '/admin/trouble-history'], authenticate, requireRole('ADMIN'));

type Col = { key: string; label: string; align?: 'right' };
interface Report { key: string; title: string; group: string; description: string; timed: boolean; columns: Col[]; run: (from: Date, to: Date) => Promise<Record<string, unknown>[]> }

const num = (v: unknown) => (typeof v === 'bigint' ? Number(v) : v !== null && typeof v === 'object' && 'toNumber' in (v as object) ? (v as { toNumber(): number }).toNumber() : v);
const clean = (rows: Record<string, unknown>[]) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, num(v)])));
const q = async (sql: TemplateStringsArray, ...a: unknown[]) => clean(await prisma.$queryRaw<Record<string, unknown>[]>(sql, ...a));
const NOT_BAD = `('CANCELLED','REJECTED')`;
const R = 'right' as const;

const REPORTS: Report[] = [
  {
    key: 'wo-per-jenis', group: 'Work Order', title: 'WO per jenis & status', timed: true, description: 'Jumlah WO dibuat pada periode, berapa yang selesai/terbuka/batal, dan rata-rata durasi penyelesaian (jam).',
    columns: [{ key: 'jenis', label: 'Jenis WO' }, { key: 'total', label: 'Dibuat', align: R }, { key: 'selesai', label: 'Selesai', align: R }, { key: 'terbuka', label: 'Terbuka', align: R }, { key: 'batal', label: 'Batal/ditolak', align: R }, { key: 'rata_jam', label: 'Rata-rata selesai (jam)', align: R }],
    run: (f, t) => q`SELECT type::text AS jenis, COUNT(*) AS total,
      COUNT(*) FILTER (WHERE "closedAt" IS NOT NULL AND status NOT IN ('CANCELLED','REJECTED')) AS selesai,
      COUNT(*) FILTER (WHERE "closedAt" IS NULL) AS terbuka,
      COUNT(*) FILTER (WHERE status IN ('CANCELLED','REJECTED')) AS batal,
      ROUND((AVG(EXTRACT(EPOCH FROM ("closedAt" - "createdAt")) / 3600) FILTER (WHERE "closedAt" IS NOT NULL AND status NOT IN ('CANCELLED','REJECTED')))::numeric, 1) AS rata_jam
      FROM "WorkOrder" WHERE "createdAt" >= ${f} AND "createdAt" < ${t} GROUP BY type ORDER BY total DESC`,
  },
  {
    key: 'wo-tertunda', group: 'Work Order', title: 'WO tertunda (> 7 hari)', timed: false, description: 'WO yang masih terbuka lebih dari 7 hari, beserta tahap dan divisi yang harus bertindak — kandidat eskalasi.',
    columns: [{ key: 'nomor', label: 'Nomor' }, { key: 'jenis', label: 'Jenis' }, { key: 'tahap', label: 'Tahap' }, { key: 'divisi', label: 'Menunggu divisi' }, { key: 'umur', label: 'Umur (hari)', align: R }, { key: 'judul', label: 'Judul' }],
    run: async () => {
      const rows = await prisma.workOrder.findMany({ where: { closedAt: null, createdAt: { lt: new Date(Date.now() - 7 * 86400_000) } }, orderBy: { createdAt: 'asc' }, take: 300 });
      return rows.map((w) => ({ nomor: w.number, jenis: w.type, tahap: workflows[w.type].statuses[w.status]?.label ?? w.status, divisi: workflows[w.type].statuses[w.status]?.owner ?? '-', umur: Math.floor((Date.now() - w.createdAt.getTime()) / 86400_000), judul: w.title }));
    },
  },
  {
    key: 'kinerja-teknisi', group: 'Work Order', title: 'Kinerja teknisi / tim FOC', timed: true, description: 'Per anggota tim FOC: WO yang dikerjakan pada periode, yang sudah selesai, dan yang masih berjalan.',
    columns: [{ key: 'teknisi', label: 'Teknisi' }, { key: 'dikerjakan', label: 'WO ditugaskan', align: R }, { key: 'selesai', label: 'Selesai', align: R }, { key: 'berjalan', label: 'Berjalan', align: R }, { key: 'rata_jam', label: 'Rata-rata selesai (jam)', align: R }],
    run: (f, t) => q`SELECT u.name AS teknisi, COUNT(*) AS dikerjakan,
      COUNT(*) FILTER (WHERE w."closedAt" IS NOT NULL AND w.status NOT IN ('CANCELLED','REJECTED')) AS selesai,
      COUNT(*) FILTER (WHERE w."closedAt" IS NULL) AS berjalan,
      ROUND((AVG(EXTRACT(EPOCH FROM (w."closedAt" - w."createdAt")) / 3600) FILTER (WHERE w."closedAt" IS NOT NULL AND w.status NOT IN ('CANCELLED','REJECTED')))::numeric, 1) AS rata_jam
      FROM "WorkOrder" w JOIN LATERAL unnest(w."teamIds") AS t(id) ON true JOIN "User" u ON u.id = t.id
      WHERE w."createdAt" >= ${f} AND w."createdAt" < ${t} GROUP BY u.name ORDER BY dikerjakan DESC`,
  },
  {
    key: 'lead-time-pasang-baru', group: 'Work Order', title: 'Lead time Pasang Baru per bulan', timed: true, description: 'Rata-rata hari dari WO Pasang Baru dibuat sampai selesai, per bulan.',
    columns: [{ key: 'bulan', label: 'Bulan' }, { key: 'selesai', label: 'Selesai', align: R }, { key: 'rata_hari', label: 'Rata-rata (hari)', align: R }, { key: 'terlama', label: 'Terlama (hari)', align: R }],
    run: (f, t) => q`SELECT to_char(date_trunc('month', "closedAt"), 'YYYY-MM') AS bulan, COUNT(*) AS selesai,
      ROUND((AVG(EXTRACT(EPOCH FROM ("closedAt" - "createdAt")) / 86400))::numeric, 1) AS rata_hari,
      ROUND((MAX(EXTRACT(EPOCH FROM ("closedAt" - "createdAt")) / 86400))::numeric, 1) AS terlama
      FROM "WorkOrder" WHERE type = 'NEW_INSTALL' AND "closedAt" IS NOT NULL AND status NOT IN ('CANCELLED','REJECTED') AND "closedAt" >= ${f} AND "closedAt" < ${t} GROUP BY 1 ORDER BY 1`,
  },
  {
    key: 'pelanggan-area', group: 'Pelanggan', title: 'Pelanggan per area & status', timed: false, description: 'Sebaran pelanggan (tidak diarsipkan) per area dengan rincian status layanan.',
    columns: [{ key: 'area', label: 'Area' }, { key: 'total', label: 'Total', align: R }, { key: 'aktif', label: 'Aktif', align: R }, { key: 'isolir', label: 'Diisolir', align: R }, { key: 'pasang', label: 'Dalam pemasangan', align: R }, { key: 'berhenti', label: 'Berhenti', align: R }],
    run: () => q`SELECT COALESCE(a.name, '(tanpa area)') AS area, COUNT(*) AS total,
      COUNT(*) FILTER (WHERE c.status IN ('ACTIVE','NEED_CHECK')) AS aktif, COUNT(*) FILTER (WHERE c.status = 'SUSPENDED') AS isolir,
      COUNT(*) FILTER (WHERE c.status IN ('PROSPECT','INSTALLING')) AS pasang, COUNT(*) FILTER (WHERE c.status IN ('TERMINATING','TERMINATED')) AS berhenti
      FROM "Customer" c LEFT JOIN "Area" a ON a.id = c."areaId" WHERE c."archivedAt" IS NULL GROUP BY a.name ORDER BY total DESC`,
  },
  {
    key: 'pelanggan-paket', group: 'Pelanggan', title: 'Pelanggan per paket', timed: false, description: 'Jumlah pelanggan aktif dan total per paket langganan.',
    columns: [{ key: 'paket', label: 'Paket' }, { key: 'aktif', label: 'Aktif', align: R }, { key: 'total', label: 'Semua status', align: R }],
    run: () => q`SELECT "packageName" AS paket, COUNT(*) FILTER (WHERE status = 'ACTIVE') AS aktif, COUNT(*) AS total FROM "Customer" WHERE "archivedAt" IS NULL GROUP BY "packageName" ORDER BY aktif DESC, total DESC`,
  },
  {
    key: 'stok-kritis', group: 'Inventori', title: 'Stok barang vs batas minimum', timed: false, description: 'Barang ber-batas-minimum: stok di gudang utama/cabang dibandingkan batas minimum.',
    columns: [{ key: 'barang', label: 'Barang' }, { key: 'satuan', label: 'Satuan' }, { key: 'stok', label: 'Stok', align: R }, { key: 'minimum', label: 'Minimum', align: R }, { key: 'status', label: 'Status' }],
    run: async () => {
      const rows = await q`SELECT i.name AS barang, i.unit AS satuan, i."minStock" AS minimum,
        CASE WHEN i.tracked THEN (SELECT COUNT(*) FROM "Asset" a JOIN "Warehouse" w ON w.id = a."warehouseId" WHERE a."itemId" = i.id AND a.status IN ('IN_STOCK','REFURBISHED') AND w.kind <> 'MOBILE')
             ELSE COALESCE((SELECT SUM(s.qty) FROM "StockLevel" s JOIN "Warehouse" w ON w.id = s."warehouseId" WHERE s."itemId" = i.id AND w.kind <> 'MOBILE'), 0) END AS stok
        FROM "Item" i WHERE i."minStock" > 0 ORDER BY i.name`;
      return rows.map((r) => ({ ...r, status: Number(r.stok) <= 0 ? 'HABIS' : Number(r.stok) < Number(r.minimum) ? 'MENIPIS' : 'AMAN' }));
    },
  },
  {
    key: 'aset-status', group: 'Inventori', title: 'Aset per kategori & status', timed: false, description: 'Aset ber-SN menurut kategori barang dan status (tersedia, terpasang, QC, rusak, afkir).',
    columns: [{ key: 'kategori', label: 'Kategori' }, { key: 'tersedia', label: 'Tersedia', align: R }, { key: 'terpasang', label: 'Terpasang/dipakai', align: R }, { key: 'qc', label: 'Menunggu QC', align: R }, { key: 'rusak', label: 'Rusak', align: R }, { key: 'afkir', label: 'Afkir', align: R }],
    run: () => q`SELECT i.category::text AS kategori,
      COUNT(*) FILTER (WHERE a.status IN ('IN_STOCK','REFURBISHED')) AS tersedia, COUNT(*) FILTER (WHERE a.status IN ('INSTALLED','IN_USE')) AS terpasang,
      COUNT(*) FILTER (WHERE a.status = 'RETURNED_PENDING_QC') AS qc, COUNT(*) FILTER (WHERE a.status = 'DAMAGED') AS rusak, COUNT(*) FILTER (WHERE a.status = 'SCRAP') AS afkir
      FROM "Asset" a JOIN "Item" i ON i.id = a."itemId" GROUP BY i.category ORDER BY 1`,
  },
  {
    key: 'material-terpakai', group: 'Inventori', title: 'Pemakaian material habis pakai', timed: true, description: 'Material yang tercatat terpakai di lapangan pada periode (dari laporan teknisi), per barang.',
    columns: [{ key: 'barang', label: 'Barang' }, { key: 'satuan', label: 'Satuan' }, { key: 'jumlah', label: 'Total terpakai', align: R }, { key: 'transaksi', label: 'Jumlah pencatatan', align: R }],
    run: (f, t) => q`SELECT i.name AS barang, i.unit AS satuan, SUM(m.qty) AS jumlah, COUNT(*) AS transaksi
      FROM "StockMovement" m JOIN "Item" i ON i.id = m."itemId" WHERE m.reason LIKE 'Terpakai%' AND m."createdAt" >= ${f} AND m."createdAt" < ${t} GROUP BY i.name, i.unit ORDER BY jumlah DESC`,
  },
  {
    key: 'pengadaan', group: 'Pengadaan', title: 'Purchase Request per status', timed: true, description: 'PR dibuat pada periode per status, dengan nilai subtotal (vendor terpilih, sebelum PPN).',
    columns: [{ key: 'status', label: 'Status' }, { key: 'jumlah', label: 'Jumlah PR', align: R }, { key: 'subtotal', label: 'Subtotal (Rp)', align: R }],
    run: (f, t) => q`SELECT pr.status AS status, COUNT(DISTINCT pr.id) AS jumlah, COALESCE(SUM(l.qty * q."unitPrice"), 0) AS subtotal
      FROM "PurchaseRequest" pr LEFT JOIN "PrLine" l ON l."prId" = pr.id LEFT JOIN "PrQuote" q ON q."lineId" = l.id AND q.chosen
      WHERE pr."createdAt" >= ${f} AND pr."createdAt" < ${t} GROUP BY pr.status ORDER BY jumlah DESC`,
  },
  {
    key: 'notifikasi', group: 'Sistem', title: 'Notifikasi per kanal & status', timed: true, description: 'Pengiriman email/Telegram/WhatsApp pada periode: terkirim, gagal, atau tidak terkirim (belum diatur/dinonaktifkan).',
    columns: [{ key: 'kanal', label: 'Kanal' }, { key: 'total', label: 'Total', align: R }, { key: 'terkirim', label: 'Terkirim', align: R }, { key: 'tidak_terkirim', label: 'Tidak terkirim', align: R }, { key: 'gagal', label: 'Gagal', align: R }, { key: 'menunggu', label: 'Menunggu', align: R }],
    run: (f, t) => q`SELECT channel::text AS kanal, COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'SENT') AS terkirim, COUNT(*) FILTER (WHERE status = 'NOT_SENT') AS tidak_terkirim,
      COUNT(*) FILTER (WHERE status = 'FAILED') AS gagal, COUNT(*) FILTER (WHERE status = 'PENDING') AS menunggu FROM "Notification" WHERE "createdAt" >= ${f} AND "createdAt" < ${t} GROUP BY channel ORDER BY total DESC`,
  },
  {
    key: 'aktivitas-user', group: 'Sistem', title: 'Aktivitas pengguna (log audit)', timed: true, description: 'Jumlah perubahan data yang tercatat di log audit per pengguna pada periode.',
    columns: [{ key: 'pengguna', label: 'Pengguna' }, { key: 'peran', label: 'Peran' }, { key: 'total', label: 'Total', align: R }, { key: 'tambah', label: 'Tambah', align: R }, { key: 'ubah', label: 'Ubah', align: R }, { key: 'hapus', label: 'Hapus', align: R }],
    run: (f, t) => q`SELECT "userName" AS pengguna, role AS peran, COUNT(*) AS total, COUNT(*) FILTER (WHERE action = 'CREATE') AS tambah, COUNT(*) FILTER (WHERE action = 'UPDATE') AS ubah, COUNT(*) FILTER (WHERE action = 'DELETE') AS hapus
      FROM "AuditLog" WHERE "createdAt" >= ${f} AND "createdAt" < ${t} GROUP BY "userName", role ORDER BY total DESC`,
  },
];
void NOT_BAD;

reportRoutes.get('/admin/reports', (_req, res) => res.json(REPORTS.map(({ key, title, group, description, timed, columns }) => ({ key, title, group, description, timed, columns }))));

reportRoutes.get('/admin/reports/:key', async (req, res) => {
  const r = REPORTS.find((x) => x.key === String(req.params.key));
  if (!r) throw new AppError(404, 'Laporan tidak dikenal');
  const p = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }).parse(req.query);
  const to = new Date((p.to ?? new Date()).getTime() + (p.to ? 86400_000 : 0)); // tanggal akhir inklusif
  const from = p.from ?? new Date(to.getTime() - 30 * 86400_000);
  const rows = await r.run(from, to);
  res.json({ key: r.key, title: r.title, description: r.description, timed: r.timed, columns: r.columns, from, to: new Date(to.getTime() - (p.to ? 86400_000 : 0)), rows, generatedAt: new Date() });
});

/** Riwayat troubleshoot per pelanggan: tiket gangguan + maintenance, lengkap dengan isi laporannya (Temuan/Tindakan/Hasil, signal, redaman). */
reportRoutes.get('/admin/trouble-history', async (req, res) => {
  const { customerId } = z.object({ customerId: z.string().min(1) }).parse(req.query);
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, code: true, name: true, packageName: true, address: true } });
  if (!customer) throw new AppError(404, 'Pelanggan tidak ditemukan');
  const wos = await prisma.workOrder.findMany({
    where: { customerId, type: { in: ['TROUBLE', 'MAINTENANCE'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, number: true, type: true, status: true, title: true, createdAt: true, closedAt: true, data: true },
  });
  const rows = wos.map((w) => {
    const d = (w.data ?? {}) as Record<string, any>;
    const r = (d.report ?? {}) as Record<string, any>;
    return {
      id: w.id, number: w.number, type: w.type, status: w.status, title: w.title, createdAt: w.createdAt, closedAt: w.closedAt,
      issue: d.issue ?? d.description ?? null,
      hasReport: !!d.report,
      findings: r.findings ?? null, actions: r.actions ?? r.note ?? null, result: r.result ?? null,
      signalDbm: r.signalDbm ?? null, attenuationDb: r.attenuationDb ?? r.opmDbm ?? null,
      team: r.team ?? [], submittedBy: r.submittedBy ?? null, reportAt: r.at ?? null,
    };
  });
  res.json({ customer, total: rows.length, rows });
});
