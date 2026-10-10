import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { CustomerStatus } from '../orm';
import { AppError, fieldError, prisma } from '../db';
import { authenticate, requireRole } from '../auth';
import { Effects, transact } from '../effects';
import { nextNumber } from '../inventory';
import { auditedDelete, auditedUpdate, changes, whoOf, writeAudit } from '../audit';
import { config } from '../config';
import { countIf, pageParams, sendPage } from '../paging';
import { assertNetworkFree, internalIp, odpName, portName, publicIp, vlanId } from '../network';
import { getAppName, webUrl } from '../settings';

/** Master & data pendukung: pelanggan (manual/impor/ekspor Excel), paket, merk/tipe, reset password, hapus/edit, audit. */
export const masterRoutes = Router();
masterRoutes.use(authenticate);

const nul = (v: unknown) => (v === '' ? null : v); // '' → null (undefined tetap undefined)
const optStr = z.preprocess(nul, z.string().trim().nullable().optional());
const optNum = (min: number, max: number) => z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(min).max(max).nullable().optional());
const CUST_STATUS = ['PROSPECT', 'INSTALLING', 'ACTIVE', 'SUSPENDED', 'TERMINATING', 'TERMINATED'] as const;

/* ═════════════ Pelanggan: input manual ═════════════ */
const customerBody = z.object({
  code: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().trim().min(3).max(40).optional()),
  name: z.string().trim().min(2).max(120, 'Maksimal 120 karakter'),
  phone: z.string().trim().min(6).max(20, 'Maksimal 20 karakter').regex(/^[0-9+][0-9 +()-]*$/, 'Hanya angka, spasi, + ( ) -'),
  email: z.preprocess(nul, z.string().email().nullable().optional()),
  address: z.string().trim().min(3).max(300, 'Maksimal 300 karakter'),
  lat: optNum(-90, 90),
  lng: optNum(-180, 180),
  packageName: z.string().trim().min(1),
  status: z.enum(CUST_STATUS).default('ACTIVE'),
  warehouseId: optStr,
  areaId: optStr,
  allowDuplicate: z.boolean().optional(), // lewati peringatan kemungkinan duplikat (nama/telepon sama)
  odp: z.preprocess(nul, odpName.nullable()),
  port: z.preprocess(nul, portName.nullable()),
  vlan: z.preprocess(nul, vlanId.nullable()),
  ip: z.preprocess(nul, internalIp.nullable()),
  publicIp: z.preprocess(nul, publicIp.nullable()),
  activatedAt: z.preprocess(nul, z.coerce.date().nullable().optional()),
});

masterRoutes.post('/customers', requireRole('MKT'), async (req, res) => {
  const b = customerBody.parse(req.body);
  const who = whoOf(req);
  const c = await transact(async (fx) => {
    const code = b.code ?? (await nextNumber(fx.tx, 'CUST'));
    if (await fx.tx.customer.findUnique({ where: { code } })) throw fieldError('code', `Kode pelanggan ${code} sudah ada`, 409);
    await assertNetworkFree(fx.tx, b);
    if (b.warehouseId && !(await fx.tx.warehouse.findUnique({ where: { id: b.warehouseId } }))) throw new AppError(400, 'Gudang tidak valid');
    if (b.areaId) {
      const a = await fx.tx.area.findUnique({ where: { id: b.areaId } });
      if (!a) throw fieldError('areaId', 'Area tidak ditemukan');
      b.warehouseId = a.warehouseId ?? b.warehouseId ?? null;
    }
    if (!b.allowDuplicate) {
      // pelanggan MSRadius adalah sumber utama: cegah input manual ganda dengan nama/telepon yang sama
      const digits = b.phone.replace(/\D/g, '');
      const dup = await fx.tx.customer.findFirst({ where: { archivedAt: null, OR: [{ name: { equals: b.name, mode: 'insensitive' } }, ...(digits.length >= 8 ? [{ phone: b.phone }] : [])] }, select: { code: true, name: true, source: true } });
      if (dup) throw new AppError(409, `Kemungkinan duplikat: sudah ada pelanggan "${dup.name}" (${dup.code}${dup.source === 'RADIUS' ? ', dari MSRadius' : ''}) dengan nama/telepon sama`, { name: `Mirip ${dup.name} (${dup.code})` });
    }
    const { allowDuplicate: _ad, ...rest } = b;
    const row = await fx.tx.customer.create({ data: { ...rest, code, activatedAt: b.activatedAt ?? (b.status === 'ACTIVE' ? new Date() : null) } as any });
    await writeAudit(fx, who, { action: 'CREATE', entity: 'pelanggan', entityId: row.id, summary: `${who.name} menambah pelanggan ${row.code} ${row.name} (input manual)` });
    return row;
  });
  res.status(201).json(c);
});

masterRoutes.patch('/customers/:id', requireRole('MKT', 'NOC'), async (req, res) => {
  const id = String(req.params.id);
  const { allowDuplicate: _ad, ...b } = customerBody.partial().parse(req.body);
  const who = whoOf(req);
  if (b.status && who.role !== 'ADMIN' && who.role !== 'NOC') throw new AppError(403, 'Status pelanggan hanya diubah NOC/Admin (lewat WO untuk alur normal)');
  if (who.role === 'NOC') {
    const NOC_KEYS = ['odp', 'port', 'vlan', 'ip', 'publicIp', 'status'];
    const bad = Object.keys(b).filter((k) => !NOC_KEYS.includes(k));
    if (bad.length) throw new AppError(403, `NOC hanya boleh mengubah data jaringan (ODP, port, VLAN, IP, status), bukan: ${bad.join(', ')}`);
  }
  const cur = await prisma.customer.findUnique({ where: { id } });
  if (!cur) throw new AppError(404, 'Pelanggan tidak ditemukan');
  if (b.areaId) {
    const ar = await prisma.area.findUnique({ where: { id: b.areaId } });
    if (!ar) throw fieldError('areaId', 'Area tidak ditemukan');
    if (ar.warehouseId) b.warehouseId = ar.warehouseId;
  }
  if (cur.source === 'RADIUS') {
    const locked = (['name', 'phone', 'address', 'packageName'] as const).filter((k) => b[k] !== undefined && b[k] !== cur[k]);
    if (locked.length) throw new AppError(409, `Pelanggan ini bersumber dari MSRadius (hanya dibaca): ubah ${locked.join(', ')} di MSRadius lalu tarik datanya`);
  }
  const ch = changes(cur, b);
  const updated = await auditedUpdate(who, 'pelanggan', id, `${cur.code} ${cur.name}`, ch, async (fx) => {
    if (b.code && b.code !== cur.code && (await fx.tx.customer.findUnique({ where: { code: b.code } }))) throw fieldError('code', `Kode ${b.code} sudah ada`, 409);
    await assertNetworkFree(fx.tx, { ip: b.ip === undefined ? undefined : b.ip, publicIp: b.publicIp === undefined ? undefined : b.publicIp, odp: b.odp ?? cur.odp, port: b.port ?? cur.port }, id);
    return fx.tx.customer.update({ where: { id }, data: b as any });
  });
  res.json(updated);
});

/**
 * Hapus pelanggan:
 *  - tanpa riwayat WO/aset → dihapus permanen;
 *  - punya riwayat WO yang sudah selesai → DIARSIPKAN (hilang dari daftar & pencarian, riwayat tetap utuh; Admin dapat memulihkan);
 *  - masih ada WO berjalan atau aset terpasang → ditolak dengan alasan jelas.
 */
masterRoutes.delete('/customers/:id', requireRole('MKT'), async (req, res) => {
  const id = String(req.params.id);
  const c = await prisma.customer.findUnique({ where: { id }, include: { _count: { select: { workOrders: true } } } });
  if (!c) throw new AppError(404, 'Pelanggan tidak ditemukan');
  const [openWos, installed] = await Promise.all([
    prisma.workOrder.findMany({ where: { customerId: id, closedAt: null }, select: { number: true }, take: 5 }),
    prisma.asset.count({ where: { customerId: id, status: 'INSTALLED' } }),
  ]);
  if (openWos.length) throw new AppError(409, `Masih ada WO berjalan (${openWos.map((w) => w.number).join(', ')}) — selesaikan atau batalkan dulu`);
  if (installed) throw new AppError(409, `Masih ada ${installed} perangkat terpasang di pelanggan ini — tarik lewat WO Terminate dulu`);
  const who = whoOf(req);
  if (c._count.workOrders === 0) {
    await auditedDelete(who, 'pelanggan', id, `${c.code} ${c.name}`, c as any, (fx) => fx.tx.customer.delete({ where: { id } }));
    return void res.json({ ok: true, mode: 'deleted' });
  }
  if (c.archivedAt) throw new AppError(409, 'Pelanggan ini sudah diarsipkan');
  await auditedDelete(who, 'pelanggan (diarsipkan)', id, `${c.code} ${c.name}`, { id, code: c.code, name: c.name, status: c.status, wo: c._count.workOrders }, (fx) => fx.tx.customer.update({ where: { id }, data: { archivedAt: new Date() } }));
  res.json({ ok: true, mode: 'archived' });
});

masterRoutes.post('/customers/:id/restore', requireRole('ADMIN'), async (req, res) => {
  const id = String(req.params.id);
  const c = await prisma.customer.findUnique({ where: { id } });
  if (!c || !c.archivedAt) throw new AppError(404, 'Pelanggan arsip tidak ditemukan');
  const who = whoOf(req);
  await transact(async (fx) => {
    await fx.tx.customer.update({ where: { id }, data: { archivedAt: null } });
    await writeAudit(fx, who, { action: 'UPDATE', entity: 'pelanggan', entityId: id, summary: `${who.name} memulihkan pelanggan ${c.code} ${c.name} dari arsip` });
  });
  res.json({ ok: true });
});

/* ═════════════ Pelanggan: impor / ekspor Excel ═════════════ */
const COLS: { key: string; label: string; width: number; alias: string[] }[] = [
  { key: 'code', label: 'Kode', width: 22, alias: ['kode', 'code', 'idpelanggan', 'customerid', 'nopelanggan'] },
  { key: 'name', label: 'Nama', width: 28, alias: ['nama', 'name', 'namapelanggan', 'pelanggan'] },
  { key: 'phone', label: 'Telepon', width: 16, alias: ['telepon', 'phone', 'hp', 'nohp', 'telp', 'notelp', 'whatsapp', 'wa'] },
  { key: 'email', label: 'Email', width: 26, alias: ['email'] },
  { key: 'address', label: 'Alamat', width: 40, alias: ['alamat', 'address'] },
  { key: 'lat', label: 'Latitude', width: 12, alias: ['latitude', 'lat'] },
  { key: 'lng', label: 'Longitude', width: 12, alias: ['longitude', 'lng', 'long', 'lon'] },
  { key: 'packageName', label: 'Paket', width: 22, alias: ['paket', 'package', 'packagename', 'layanan', 'jasa', 'namapaket'] },
  { key: 'status', label: 'Status', width: 14, alias: ['status'] },
  { key: 'area', label: 'Area', width: 16, alias: ['area', 'gudang', 'warehouse', 'cabang'] },
  { key: 'odp', label: 'ODP', width: 12, alias: ['odp', 'node'] },
  { key: 'port', label: 'Port', width: 8, alias: ['port', 'portodp'] },
  { key: 'vlan', label: 'VLAN', width: 8, alias: ['vlan'] },
  { key: 'ip', label: 'IP', width: 16, alias: ['ip', 'ipaddress', 'alamatip'] },
  { key: 'activatedAt', label: 'Aktif Sejak', width: 14, alias: ['aktifsejak', 'activatedat', 'tanggalaktif', 'tglaktif', 'tanggalaktivasi'] },
];
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const STATUS_MAP: Record<string, CustomerStatus> = { active: 'ACTIVE', aktif: 'ACTIVE', suspended: 'SUSPENDED', suspend: 'SUSPENDED', isolir: 'SUSPENDED', isolated: 'SUSPENDED', terminated: 'TERMINATED', berhenti: 'TERMINATED', putus: 'TERMINATED', cabut: 'TERMINATED', nonaktif: 'TERMINATED', prospect: 'PROSPECT', calon: 'PROSPECT', installing: 'INSTALLING', pemasangan: 'INSTALLING', terminating: 'TERMINATING' };

function cellVal(v: ExcelJS.CellValue): string | Date | number | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as any;
    if ('result' in o) return cellVal(o.result);
    if ('richText' in o) return o.richText.map((r: any) => r.text).join('');
    if ('text' in o) return String(o.text);
    return null;
  }
  return v as any;
}
const str = (v: ReturnType<typeof cellVal> | undefined) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v).trim());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

async function readSheet(file: Express.Multer.File) {
  const wb = new ExcelJS.Workbook();
  try {
    if (/\.csv$/i.test(file.originalname) || file.mimetype.includes('csv')) {
      const { Readable } = await import('stream');
      await wb.csv.read(Readable.from(file.buffer));
    } else await wb.xlsx.load(file.buffer as any);
  } catch {
    throw new AppError(400, 'File tidak dapat dibaca. Gunakan .xlsx atau .csv (unduh template di halaman ini).');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new AppError(400, 'File kosong');
  const header = new Map<number, string>();
  ws.getRow(1).eachCell((cell, col) => {
    const n = norm(str(cellVal(cell.value)));
    const def = COLS.find((c) => c.alias.includes(n));
    if (def) header.set(col, def.key);
  });
  if (![...header.values()].includes('name')) throw new AppError(400, 'Kolom "Nama" tidak ditemukan di baris pertama. Unduh template untuk format yang benar.');
  const rows: { row: number; raw: Record<string, ReturnType<typeof cellVal>> }[] = [];
  ws.eachRow((r, i) => {
    if (i === 1) return;
    const raw: Record<string, ReturnType<typeof cellVal>> = {};
    for (const [col, key] of header) raw[key] = cellVal(r.getCell(col).value);
    if (Object.values(raw).some((v) => str(v) !== '')) rows.push({ row: i, raw });
  });
  if (rows.length > 5000) throw new AppError(400, 'Maksimal 5000 baris per impor — pecah file.');
  return rows;
}

masterRoutes.get('/customers/import-template.xlsx', async (_req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Pelanggan');
  ws.columns = COLS.map((c) => ({ header: c.label, key: c.key, width: c.width }));
  ws.addRow({ code: '', name: 'Contoh Pelanggan', phone: '081234567890', email: 'contoh@mail.com', address: 'Jl. Contoh No. 1, Jakarta', lat: -6.2088, lng: 106.8456, packageName: 'Home 20 Mbps', status: 'ACTIVE', area: 'Pusat', odp: 'ODP-A1', port: '3', vlan: '100', ip: '10.20.0.10', activatedAt: new Date() });
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const help = wb.addWorksheet('Petunjuk');
  [
    ['Kolom wajib: Nama dan Telepon (Alamat disarankan; kosong diisi "-").'],
    ['Kode: kosongkan untuk dibuatkan otomatis. Jika kode sudah ada di sistem, baris itu MEMPERBARUI data pelanggan tersebut.'],
    ['Tanpa Kode: baris dicocokkan dengan pelanggan yang Nama + Telepon-nya sama (diperbarui), jika tidak ada dibuat baru.'],
    ['Status: ACTIVE / SUSPENDED / TERMINATED / PROSPECT / INSTALLING (juga diterima: Aktif, Isolir, Berhenti). Kosong = ACTIVE.'],
    ['Paket: nama paket; jika belum ada di master, otomatis ditambahkan ke Master Paket.'],
    ['Gudang: kode atau nama gudang (opsional). IP dan ODP+Port tidak boleh dobel dengan pelanggan lain yang belum TERMINATED.'],
    ['Baris pertama harus header. Nama kolom boleh Bahasa Indonesia atau Inggris (mis. Telepon/Phone). Maks 5000 baris.'],
    ['Alur: unggah file → periksa pratinjau & daftar error → klik "Impor" untuk menyimpan. Baris yang error dilewati.'],
  ].forEach((r) => help.addRow(r));
  help.getColumn(1).width = 120;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="template-impor-pelanggan.xlsx"');
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
});

/** Ekspor dialirkan per batch (cursor) ke XLSX stream: memori tetap kecil walau jutaan baris. */
masterRoutes.get('/customers/export.xlsx', requireRole('MKT', 'NOC', 'FIN', 'GA'), async (req, res) => {
  const q = z.object({ q: z.string().optional(), status: z.string().optional() }).parse(req.query);
  const status = q.status ? q.status.split(',') : undefined;
  const where = { archivedAt: null, ...(status ? { status: { in: status as CustomerStatus[] } } : {}), ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' as const } }, { code: { contains: q.q, mode: 'insensitive' as const } }, { phone: { contains: q.q } }, { ip: { contains: q.q } }] } : {}) };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="pelanggan-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });
  const ws = wb.addWorksheet('Pelanggan', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLS.map((c) => ({ header: c.label, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).commit();
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.customer.findMany({ where, include: { area: { select: { name: true } } }, orderBy: { id: 'asc' }, take: 2000, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!batch.length) break;
    for (const c of batch) ws.addRow({ ...c, area: c.area?.name ?? '' }).commit();
    cursor = batch[batch.length - 1].id;
    if (batch.length < 2000) break;
  }
  ws.commit();
  await wb.commit();
});

masterRoutes.post('/customers/import', requireRole('MKT', 'NOC'), upload.single('file'), async (req, res) => {
  if (!req.file) throw new AppError(400, 'Pilih file .xlsx / .csv');
  const dryRun = req.query.dryRun === '1';
  const who = whoOf(req);
  const rows = await readSheet(req.file);

  const [existing, whs, pkgs] = await Promise.all([
    prisma.customer.findMany({ select: { id: true, code: true, name: true, phone: true, ip: true, odp: true, port: true, status: true, source: true } }),
    prisma.area.findMany(),
    prisma.package.findMany(),
  ]);
  const byCode = new Map(existing.map((c) => [c.code.toLowerCase(), c]));
  const byNamePhone = new Map(existing.map((c) => [`${c.name.toLowerCase()}|${c.phone}`, c]));
  const ipOwner = new Map(existing.filter((c) => c.ip && c.status !== 'TERMINATED').map((c) => [c.ip!, c.id]));
  const portOwner = new Map(existing.filter((c) => c.odp && c.port && c.status !== 'TERMINATED').map((c) => [`${c.odp}/${c.port}`, c.id]));
  const pkgNames = new Set(pkgs.map((p) => p.name.toLowerCase()));
  const newPkgs = new Set<string>();

  const errors: { row: number; message: string }[] = [];
  const plan: { row: number; id?: string; data: any }[] = [];
  const seenCodes = new Set<string>();

  for (const { row, raw } of rows) {
    try {
      const name = str(raw.name);
      let phone = typeof raw.phone === 'number' ? String(raw.phone) : str(raw.phone).replace(/[\s-]/g, '');
      if (/^8\d{7,12}$/.test(phone)) phone = `0${phone}`; // Excel membuang angka 0 di depan
      if (name.length < 2) throw new Error('Nama kosong/terlalu pendek');
      if (phone.length < 6) throw new Error('Telepon kosong/terlalu pendek');
      const statusRaw = str(raw.status).toLowerCase();
      const sKey = statusRaw.replace(/\s/g, '');
      const status: CustomerStatus | undefined = !statusRaw ? 'ACTIVE' : STATUS_MAP[sKey] ?? ((CUST_STATUS as readonly string[]).includes(statusRaw.toUpperCase()) ? (statusRaw.toUpperCase() as CustomerStatus) : undefined);
      if (!status) throw new Error(`Status "${str(raw.status)}" tidak dikenal`);
      const num = (v: ReturnType<typeof cellVal>, min: number, max: number, label: string) => {
        if (str(v) === '') return null;
        const n = Number(typeof v === 'number' ? v : str(v).replace(',', '.'));
        if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label} tidak valid`);
        return n;
      };
      const wcell = str(raw.area);
      const wh = wcell ? whs.find((w) => w.name.toLowerCase() === wcell.toLowerCase() || w.code?.toLowerCase() === wcell.toLowerCase()) : undefined;
      if (wcell && !wh) throw new Error(`Area "${wcell}" tidak ditemukan di Master Area`);
      const email = str(raw.email);
      if (email && !z.string().email().safeParse(email).success) throw new Error('Email tidak valid');
      let activatedAt: Date | null = null;
      if (raw.activatedAt instanceof Date) activatedAt = raw.activatedAt;
      else if (str(raw.activatedAt)) { const d = new Date(str(raw.activatedAt)); if (isNaN(d.getTime())) throw new Error('Tanggal "Aktif Sejak" tidak valid'); activatedAt = d; }
      const packageName = str(raw.packageName) || 'Tidak diketahui';
      const code = str(raw.code);
      const hit = (code && byCode.get(code.toLowerCase())) || (!code ? byNamePhone.get(`${name.toLowerCase()}|${phone}`) : undefined);
      if (hit && (hit as any).source === 'RADIUS') throw new Error('Pelanggan bersumber dari MSRadius (hanya dibaca) — data ditarik lewat sinkron, bukan impor Excel');
      if (code && seenCodes.has(code.toLowerCase())) throw new Error(`Kode ${code} muncul dua kali di file`);
      if (code) seenCodes.add(code.toLowerCase());
      const ip = str(raw.ip) || null, odp = str(raw.odp) || null, port = str(raw.port) || null;
      if (ip) { const v = internalIp.safeParse(ip); if (!v.success) throw new Error(`IP: ${v.error.issues[0].message}`); }
      if (str(raw.vlan)) { const v = vlanId.safeParse(str(raw.vlan)); if (!v.success) throw new Error(`VLAN: ${v.error.issues[0].message}`); }
      if (ip) { const o = ipOwner.get(ip); if (o && o !== hit?.id) throw new Error(`IP ${ip} sudah dipakai pelanggan lain`); }
      if (odp && port) { const o = portOwner.get(`${odp}/${port}`); if (o && o !== hit?.id) throw new Error(`Port ${odp}/${port} sudah dipakai pelanggan lain`); }
      if (status !== 'TERMINATED') { if (ip) ipOwner.set(ip, hit?.id ?? `new${row}`); if (odp && port) portOwner.set(`${odp}/${port}`, hit?.id ?? `new${row}`); }
      if (!pkgNames.has(packageName.toLowerCase())) newPkgs.add(packageName);
      plan.push({
        row,
        id: hit?.id,
        data: { code: code || undefined, name, phone, email: email || null, address: str(raw.address) || '-', lat: num(raw.lat, -90, 90, 'Latitude'), lng: num(raw.lng, -180, 180, 'Longitude'), packageName, status, areaId: wh?.id ?? null, warehouseId: wh?.warehouseId ?? null, odp, port, vlan: str(raw.vlan) || null, ip, activatedAt: activatedAt ?? (status === 'ACTIVE' ? undefined : null) },
      });
    } catch (e) {
      errors.push({ row, message: (e as Error).message });
    }
  }

  const summary = { total: rows.length, create: plan.filter((p) => !p.id).length, update: plan.filter((p) => p.id).length, errors: errors.slice(0, 200), errorCount: errors.length, newPackages: [...newPkgs], preview: plan.slice(0, 8).map((p) => ({ row: p.row, action: p.id ? 'update' : 'create', code: p.data.code ?? '(otomatis)', name: p.data.name, phone: p.data.phone, packageName: p.data.packageName, status: p.data.status })) };
  if (dryRun) return void res.json({ dryRun: true, ...summary });
  if (!plan.length) throw new AppError(400, 'Tidak ada baris valid untuk diimpor');

  await prisma.$transaction(
    async (tx) => {
      const fx = new Effects(tx);
      for (const name of newPkgs) await tx.package.upsert({ where: { name }, create: { name }, update: {} });
      // alokasi kode otomatis sekaligus (satu kenaikan counter)
      const creates = plan.filter((p) => !p.id);
      const needCode = creates.filter((p) => !p.data.code);
      if (needCode.length) {
        const d = new Date();
        const key = `CUST-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
        const c = await tx.counter.upsert({ where: { key }, create: { key, value: needCode.length }, update: { value: { increment: needCode.length } } });
        needCode.forEach((p, i) => (p.data.code = `${key}-${String(c.value - needCode.length + 1 + i).padStart(4, '0')}`));
      }
      if (creates.length) await tx.customer.createMany({ data: creates.map((p) => ({ ...p.data, activatedAt: p.data.activatedAt ?? null })) });
      for (const p of plan.filter((x) => x.id)) {
        const { code, activatedAt, ...rest } = p.data;
        await tx.customer.update({ where: { id: p.id! }, data: { ...rest, archivedAt: null, ...(code ? { code } : {}), ...(activatedAt !== undefined ? { activatedAt } : {}) } });
      }
      await writeAudit(fx, who, { action: 'IMPORT', entity: 'pelanggan', summary: `${who.name} impor Excel pelanggan: ${creates.length} baru, ${plan.length - creates.length} diperbarui, ${errors.length} baris dilewati (${req.file!.originalname})` });
    },
    { timeout: 120_000, maxWait: 15_000 },
  );
  res.json({ dryRun: false, ...summary, applied: plan.length });
});

/* ═════════════ Master paket / jasa ═════════════ */
masterRoutes.get('/packages', async (req, res) => {
  const all = req.query.all === '1';
  const [rows, used] = await Promise.all([
    prisma.package.findMany({ where: all ? {} : { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.customer.groupBy({ by: ['packageName'], _count: true }),
  ]);
  res.json(rows.map((p) => ({ ...p, customers: used.find((u) => u.packageName === p.name)?._count ?? 0 })));
});
const pkgRoles = requireRole('MKT'); // NOC tidak mengelola master data
const pkgBody = z.object({ name: z.string().trim().min(2).max(80), description: z.preprocess(nul, z.string().trim().max(200).nullable().optional()), active: z.boolean().optional(), sortOrder: z.coerce.number().int().min(0).max(9999).optional() });
masterRoutes.post('/packages', pkgRoles, async (req, res) => {
  const b = pkgBody.parse(req.body);
  const who = whoOf(req);
  res.status(201).json(await transact(async (fx) => {
    const p = await fx.tx.package.create({ data: b });
    await writeAudit(fx, who, { action: 'CREATE', entity: 'paket', entityId: p.id, summary: `${who.name} menambah paket ${p.name}` });
    return p;
  }));
});
masterRoutes.patch('/packages/:id', pkgRoles, async (req, res) => {
  const id = String(req.params.id);
  const b = pkgBody.partial().parse(req.body);
  const cur = await prisma.package.findUnique({ where: { id } });
  if (!cur) throw new AppError(404, 'Paket tidak ditemukan');
  const ch = changes(cur, b);
  res.json(await auditedUpdate(whoOf(req), 'paket', id, cur.name, ch, async (fx) => {
    const p = await fx.tx.package.update({ where: { id }, data: b });
    if (b.name && b.name !== cur.name) await fx.tx.customer.updateMany({ where: { packageName: cur.name }, data: { packageName: b.name } }); // ganti nama ikut ke pelanggan
    return p;
  }));
});
masterRoutes.delete('/packages/:id', pkgRoles, async (req, res) => {
  const id = String(req.params.id);
  const p = await prisma.package.findUnique({ where: { id } });
  if (!p) throw new AppError(404, 'Paket tidak ditemukan');
  const n = await prisma.customer.count({ where: { packageName: p.name } });
  if (n) throw new AppError(409, `Paket dipakai ${n} pelanggan — nonaktifkan saja (tidak muncul di pilihan baru)`);
  await auditedDelete(whoOf(req), 'paket', id, p.name, p as any, (fx) => fx.tx.package.delete({ where: { id } }));
  res.json({ ok: true });
});

/* ═════════════ Master merk & tipe aset ═════════════ */
const gaRoles = requireRole('GA');
masterRoutes.get('/asset-brands', async (_req, res) => {
  res.json(await prisma.assetBrand.findMany({ include: { models: { orderBy: { name: 'asc' } }, _count: { select: { assets: true } } }, orderBy: { name: 'asc' } }));
});
masterRoutes.post('/asset-brands', gaRoles, async (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body);
  const who = whoOf(req);
  res.status(201).json(await transact(async (fx) => {
    const b = await fx.tx.assetBrand.create({ data: { name } });
    await writeAudit(fx, who, { action: 'CREATE', entity: 'merk', entityId: b.id, summary: `${who.name} menambah merk ${name}` });
    return b;
  }));
});
masterRoutes.patch('/asset-brands/:id', gaRoles, async (req, res) => {
  const id = String(req.params.id);
  const { name } = z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body);
  const cur = await prisma.assetBrand.findUniqueOrThrow({ where: { id } }).catch(() => { throw new AppError(404, 'Merk tidak ditemukan'); });
  res.json(await auditedUpdate(whoOf(req), 'merk', id, cur.name, changes(cur, { name }), (fx) => fx.tx.assetBrand.update({ where: { id }, data: { name } })));
});
masterRoutes.delete('/asset-brands/:id', gaRoles, async (req, res) => {
  const id = String(req.params.id);
  const b = await prisma.assetBrand.findUnique({ where: { id }, include: { _count: { select: { assets: true } } } });
  if (!b) throw new AppError(404, 'Merk tidak ditemukan');
  if (b._count.assets) throw new AppError(409, `Merk dipakai ${b._count.assets} aset`);
  await auditedDelete(whoOf(req), 'merk', id, b.name, { id, name: b.name }, (fx) => fx.tx.assetBrand.delete({ where: { id } }));
  res.json({ ok: true });
});
masterRoutes.post('/asset-brands/:id/models', gaRoles, async (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
  const who = whoOf(req);
  const brand = await prisma.assetBrand.findUnique({ where: { id: String(req.params.id) } });
  if (!brand) throw new AppError(404, 'Merk tidak ditemukan');
  res.status(201).json(await transact(async (fx) => {
    const m = await fx.tx.assetModel.create({ data: { name, brandId: brand.id } });
    await writeAudit(fx, who, { action: 'CREATE', entity: 'tipe', entityId: m.id, summary: `${who.name} menambah tipe ${brand.name} ${name}` });
    return m;
  }));
});
masterRoutes.patch('/asset-models/:id', gaRoles, async (req, res) => {
  const id = String(req.params.id);
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
  const cur = await prisma.assetModel.findUnique({ where: { id } });
  if (!cur) throw new AppError(404, 'Tipe tidak ditemukan');
  res.json(await auditedUpdate(whoOf(req), 'tipe', id, cur.name, changes(cur, { name }), (fx) => fx.tx.assetModel.update({ where: { id }, data: { name } })));
});
masterRoutes.delete('/asset-models/:id', gaRoles, async (req, res) => {
  const id = String(req.params.id);
  const m = await prisma.assetModel.findUnique({ where: { id }, include: { _count: { select: { assets: true } } } });
  if (!m) throw new AppError(404, 'Tipe tidak ditemukan');
  if (m._count.assets) throw new AppError(409, `Tipe dipakai ${m._count.assets} aset`);
  await auditedDelete(whoOf(req), 'tipe', id, m.name, { id, name: m.name }, (fx) => fx.tx.assetModel.delete({ where: { id } }));
  res.json({ ok: true });
});

/* ═════════════ Admin: reset password (satuan / massal) + hapus user + audit ═════════════ */
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export function genPassword(len = 12): string {
  let p = '';
  const buf = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) p += alphabet[buf[i] % alphabet.length];
  return /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p) ? p : genPassword(len);
}

const pwOpts = z.object({
  password: z.string().min(8).max(72).optional(), // kosong → acak per user
  mustChange: z.boolean().default(true),
  notify: z.boolean().default(true),
  sendPassword: z.boolean().default(false), // sertakan password di email/Telegram (kurang aman)
});

async function resetPasswords(req: import('express').Request, ids: string[], o: z.infer<typeof pwOpts>) {
  const who = whoOf(req);
  const users = await prisma.user.findMany({ where: { id: { in: ids }, email: { not: 'system@l1v.local' } } });
  if (!users.length) throw new AppError(404, 'User tidak ditemukan');
  const plans = await Promise.all(users.map(async (u) => { const plain = o.password ?? genPassword(); return { u, plain, hash: await bcrypt.hash(plain, 10) }; }));
  await transact(async (fx) => {
    for (const { u, plain, hash } of plans) {
      await fx.tx.user.update({ where: { id: u.id }, data: { passwordHash: hash, mustChangePassword: o.mustChange } });
      if (o.notify)
        await fx.notify({
          userIds: [u.id],
          subject: `🔑 Password akun ${await getAppName()} diubah oleh Admin`,
          body: `Halo ${u.name},\n\nPassword akun Anda (${u.email}) telah diubah oleh ${who.name}.${o.sendPassword ? `\nPassword sementara: ${plain}` : '\nHubungi Admin untuk mendapatkan password baru.'}${o.mustChange ? '\nAnda diminta mengganti password saat login berikutnya.' : ''}\n${webUrl()}\n\nJika Anda tidak mengharapkan perubahan ini, segera hubungi Admin.`,
        });
    }
    await writeAudit(fx, who, { action: 'PASSWORD_RESET', entity: 'user', summary: `${who.name} mereset password ${plans.length} user: ${plans.map((p) => p.u.email).join(', ')}`.slice(0, 500) });
  });
  return plans.map((p) => ({ id: p.u.id, name: p.u.name, email: p.u.email, password: p.plain }));
}

masterRoutes.post('/users/:id/reset-password', requireRole('ADMIN'), async (req, res) => {
  const o = pwOpts.parse(req.body ?? {});
  const [r] = await resetPasswords(req, [String(req.params.id)], o);
  res.json({ ...r, password: o.password ? undefined : r.password }); // password acak ditampilkan SEKALI ke Admin
});
masterRoutes.post('/users/bulk-password', requireRole('ADMIN'), async (req, res) => {
  const b = pwOpts.extend({ userIds: z.array(z.string()).min(1).max(200) }).parse(req.body);
  const out = await resetPasswords(req, b.userIds, b);
  res.json({ count: out.length, users: out.map((u) => ({ ...u, password: b.password ? undefined : u.password })) });
});

masterRoutes.delete('/users/:id', requireRole('ADMIN'), async (req, res) => {
  const id = String(req.params.id);
  if (id === req.user!.id) throw new AppError(400, 'Tidak bisa menghapus akun sendiri');
  const u = await prisma.user.findUnique({ where: { id }, include: { _count: { select: { created: true, assigned: true } } } });
  if (!u) throw new AppError(404, 'User tidak ditemukan');
  if (u._count.created || u._count.assigned) throw new AppError(409, `User terkait ${u._count.created + u._count.assigned} WO — nonaktifkan saja`);
  await auditedDelete(whoOf(req), 'user', id, `${u.name} <${u.email}>`, { id, name: u.name, email: u.email, role: u.role }, async (fx) => {
    await fx.tx.warehouse.deleteMany({ where: { ownerId: id, stock: { none: {} }, assets: { none: {} }, customers: { none: {} } } });
    await fx.tx.user.delete({ where: { id } });
  });
  res.json({ ok: true });
});

masterRoutes.get('/admin/audit', requireRole('ADMIN'), async (req, res) => {
  const q = z.object({ entity: z.string().optional(), action: z.string().optional(), q: z.string().optional() }).parse(req.query);
  const pp = pageParams(req, { sorts: { createdAt: (d) => ({ createdAt: d }), action: (d) => ({ action: d }), entity: (d) => ({ entity: d }) }, defaultSort: { key: 'createdAt', dir: 'desc' }, legacyLimit: 200 });
  const term = q.q?.trim();
  const where = { ...(q.entity ? { entity: q.entity } : {}), ...(q.action ? { action: q.action } : {}), ...(term ? { OR: [{ summary: { contains: term, mode: 'insensitive' as const } }, { userName: { contains: term, mode: 'insensitive' as const } }] } : {}) };
  const [rows, total] = await Promise.all([prisma.auditLog.findMany({ where, orderBy: pp.orderBy, skip: pp.skip, take: pp.take }), countIf(pp, () => prisma.auditLog.count({ where }))]);
  sendPage(res, pp, rows, total);
});

