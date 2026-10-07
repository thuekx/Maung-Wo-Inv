import { z } from 'zod';
import { WoType } from '@prisma/client';
import { AppError } from './db';
import { config } from './config';
import { AVAILABLE, installAvailability, mobileWarehouse, moveAsset, moveStock, mustAsset, nextNumber, normSn, qcAssets } from './inventory';
import type { ActionDef, Ctx, Field, Workflow } from './wf-types';

/* ───────────────────────── helpers ───────────────────────── */

export const PACKAGES = ['Home 10 Mbps', 'Home 20 Mbps', 'Home 50 Mbps', 'Home 100 Mbps', 'Business 200 Mbps', 'Dedicated'];

const link = (ctx: Ctx) => `${config.webUrl}/work-orders/${ctx.wo.id}`;
const cname = (ctx: Ctx) => ctx.wo.customer?.name ?? '-';

const note = (required = false): Field => ({ name: 'note', label: 'Catatan', type: 'textarea', required });
const technicianF: Field = { name: 'technicianId', label: 'Teknisi', type: 'technician', required: true };
const scheduledF: Field = { name: 'scheduledAt', label: 'Jadwal kunjungan', type: 'datetime', required: true };
const photosF: Field = { name: 'photos', label: 'Foto (lokasi, perangkat, OPM)', type: 'photos', required: true };

const sn = z.array(z.string().trim().min(1)).transform((a) => [...new Set(a.map(normSn))]);
const materials = z
  .array(z.object({ itemId: z.string().min(1), qty: z.coerce.number().int().positive() }))
  .default([]);
const yes = (msg: string) => z.literal(true, { errorMap: () => ({ message: msg }) });
const optNote = z.string().optional();

async function customerOf(ctx: Ctx) {
  if (!ctx.wo.customerId) throw new AppError(400, 'WO tidak terhubung ke pelanggan');
  return ctx.wo.customerId;
}

async function setCustomer(ctx: Ctx, data: Record<string, any>) {
  await ctx.tx.customer.update({ where: { id: await customerOf(ctx) }, data });
}

/** Teknisi mengambil material dari gudang → Mobile Stock miliknya. */
async function pickup(ctx: Ctx, input: unknown) {
  const i = z.object({ sourceWarehouseId: z.string().min(1), serials: sn.default([]), materials }).parse(input);
  const techId = ctx.wo.assigneeId ?? ctx.actor.id;
  const mob = await mobileWarehouse(ctx.tx, techId);
  for (const s of i.serials) {
    const a = await mustAsset(ctx.tx, s);
    if (a.warehouseId !== i.sourceWarehouseId || !AVAILABLE.includes(a.status))
      throw new AppError(409, `SN ${a.serialNumber} tidak tersedia di gudang sumber`);
    await moveAsset(ctx.tx, a, { status: 'IN_STOCK', toWarehouseId: mob.id, reason: 'Ambil material ke mobile stock', woId: ctx.wo.id, actorId: ctx.actor.id });
  }
  for (const m of i.materials)
    await moveStock(ctx.tx, { itemId: m.itemId, qty: m.qty, from: i.sourceWarehouseId, to: mob.id, reason: 'Ambil material ke mobile stock', woId: ctx.wo.id, actorId: ctx.actor.id });
  ctx.data.pickup = { serials: i.serials, materials: i.materials, at: new Date() };
}

/** Pakai material habis pakai dari Mobile Stock (kabel dihitung per meter dari item SKU DROPCORE). */
async function consume(ctx: Ctx, cableMeters: number, lines: { itemId: string; qty: number }[]) {
  const mob = await mobileWarehouse(ctx.tx, ctx.wo.assigneeId ?? ctx.actor.id);
  const all = [...lines];
  if (cableMeters > 0) {
    const cable = await ctx.tx.item.findUnique({ where: { sku: 'DROPCORE' } });
    if (!cable) throw new AppError(500, 'Item DROPCORE belum ada di master item');
    all.push({ itemId: cable.id, qty: cableMeters });
  }
  for (const l of all)
    await moveStock(ctx.tx, { itemId: l.itemId, qty: l.qty, from: mob.id, to: null, reason: `Terpakai – ${ctx.wo.number}`, woId: ctx.wo.id, actorId: ctx.actor.id });
  return mob;
}

/** Perangkat ber-SN terpasang di pelanggan: harus ada di Mobile Stock teknisi. */
async function installSerials(ctx: Ctx, serials: string[], mobId: string) {
  for (const s of serials) {
    const a = await mustAsset(ctx.tx, s);
    if (a.warehouseId !== mobId || !AVAILABLE.includes(a.status))
      throw new AppError(409, `SN ${a.serialNumber} tidak ada di Mobile Stock teknisi — lakukan "Ambil material" dulu`);
    await moveAsset(ctx.tx, a, { status: 'INSTALLED', toWarehouseId: null, customerId: ctx.wo.customerId, reason: `Terpasang – ${ctx.wo.number}`, woId: ctx.wo.id, actorId: ctx.actor.id });
  }
}

const scheduleAction = (key: string, label: string, to: string): ActionDef => ({
  key,
  label,
  roles: ['FOC'],
  to,
  fields: [technicianF, scheduledF, note()],
  run: async (ctx, input) => {
    const i = z.object({ technicianId: z.string().min(1), scheduledAt: z.coerce.date(), note: optNote }).parse(input);
    const tech = await ctx.tx.user.findFirst({ where: { id: i.technicianId, role: 'FOC', active: true } });
    if (!tech) throw new AppError(400, 'Teknisi tidak valid');
    ctx.patch.assigneeId = tech.id;
    ctx.patch.scheduledAt = i.scheduledAt;
    if (ctx.wo.type === 'NEW_INSTALL') await setCustomer(ctx, { status: 'INSTALLING' });
    await ctx.fx.notify({
      userIds: [tech.id],
      woId: ctx.wo.id,
      subject: `[${ctx.wo.number}] Tugas baru untuk Anda`,
      body: `${ctx.wo.title}\nPelanggan: ${cname(ctx)}\nAlamat: ${ctx.wo.customer?.address ?? '-'}\nJadwal: ${i.scheduledAt.toLocaleString('id-ID')}\n${link(ctx)}`,
    });
  },
});

const startAction = (to: string, withPickup: boolean): ActionDef => ({
  key: 'start',
  label: withPickup ? 'Mulai & ambil material' : 'Mulai pekerjaan',
  roles: ['FOC'],
  assigneeOnly: true,
  to,
  fields: withPickup
    ? [
        { name: 'sourceWarehouseId', label: 'Ambil dari gudang', type: 'warehouse', required: true },
        { name: 'serials', label: 'SN perangkat yang diambil (ONT/Router)', type: 'serials' },
        { name: 'materials', label: 'Material habis pakai yang diambil', type: 'materials', itemCategory: 'CONSUMABLE' },
      ]
    : [note()],
  run: async (ctx, input) => {
    if (withPickup) await pickup(ctx, input);
  },
});

/* ───────────────────────── 1+2+3. PASANG BARU, INSTALASI, AKTIVASI ───────────────────────── */

const newInstall: Workflow = {
  type: 'NEW_INSTALL',
  prefix: 'WO-NI',
  label: 'Pasang Baru',
  description: 'Registrasi → validasi NOC → cek stok → instalasi FOC → aktivasi NOC → BA Digital & trigger invoice.',
  createRoles: ['MKT'],
  createFields: [
    { name: 'name', label: 'Nama pelanggan', type: 'text', required: true },
    { name: 'phone', label: 'No. telepon / WA', type: 'text', required: true },
    { name: 'email', label: 'Email pelanggan', type: 'text' },
    { name: 'address', label: 'Alamat pemasangan', type: 'textarea', required: true },
    { name: 'lat', label: 'Latitude (GPS)', type: 'number', required: true, help: 'contoh: -6.2088' },
    { name: 'lng', label: 'Longitude (GPS)', type: 'number', required: true, help: 'contoh: 106.8456' },
    { name: 'packageName', label: 'Paket langganan', type: 'select', required: true, options: PACKAGES },
    { name: 'warehouseId', label: 'Gudang / cabang terkait', type: 'warehouse', required: true },
    { name: 'notes', label: 'Catatan sales', type: 'textarea' },
  ],
  initial: 'NOC_VALIDATION',
  async create(tx, input) {
    const i = z
      .object({
        name: z.string().min(2),
        phone: z.string().min(6),
        email: z.string().email().optional().or(z.literal('')),
        address: z.string().min(5),
        lat: z.coerce.number().min(-90).max(90),
        lng: z.coerce.number().min(-180).max(180),
        packageName: z.string().min(1),
        warehouseId: z.string().min(1),
        notes: optNote,
      })
      .parse(input);
    const wh = await tx.warehouse.findFirst({ where: { id: i.warehouseId, kind: { not: 'MOBILE' }, active: true } });
    if (!wh) throw new AppError(400, 'Gudang tidak valid');
    const customer = await tx.customer.create({
      data: { code: await nextNumber(tx, 'CUST'), name: i.name, phone: i.phone, email: i.email || null, address: i.address, lat: i.lat, lng: i.lng, packageName: i.packageName, warehouseId: wh.id },
    });
    return { title: `Pasang baru – ${i.name}`, customerId: customer.id, data: { packageName: i.packageName, notes: i.notes } };
  },
  statuses: {
    NOC_VALIDATION: {
      label: 'Validasi Teknis (NOC)',
      owner: 'NOC',
      actions: [
        {
          key: 'validate',
          label: 'Validasi OK → alokasikan port/IP',
          roles: ['NOC'],
          to: 'STOCK_CHECK',
          fields: [
            { name: 'odp', label: 'ODP / Node', type: 'text', required: true },
            { name: 'port', label: 'Port ODP', type: 'text', required: true },
            { name: 'vlan', label: 'VLAN', type: 'text', required: true },
            { name: 'ip', label: 'IP / Subnet', type: 'text', required: true },
            note(),
          ],
          run: async (ctx, input) => {
            const i = z.object({ odp: z.string().min(1), port: z.string().min(1), vlan: z.string().min(1), ip: z.string().min(7), note: optNote }).parse(input);
            const dup = await ctx.tx.customer.findFirst({ where: { ip: i.ip, id: { not: ctx.wo.customerId! }, status: { not: 'TERMINATED' } } });
            if (dup) throw new AppError(409, `IP ${i.ip} sudah dipakai ${dup.name}`);
            const portDup = await ctx.tx.customer.findFirst({ where: { odp: i.odp, port: i.port, id: { not: ctx.wo.customerId! }, status: { not: 'TERMINATED' } } });
            if (portDup) throw new AppError(409, `Port ${i.odp}/${i.port} sudah dipakai ${portDup.name}`);
            await setCustomer(ctx, { odp: i.odp, port: i.port, vlan: i.vlan, ip: i.ip });
            ctx.data.validation = { odp: i.odp, port: i.port, vlan: i.vlan, ip: i.ip };
          },
        },
        { key: 'reject', label: 'Tolak (tidak ada coverage/port)', roles: ['NOC'], to: 'REJECTED', danger: true, fields: [note(true)] },
      ],
    },
    STOCK_CHECK: {
      label: 'Cek Stok (otomatis)',
      owner: 'PROC',
      actions: [],
      onEnter: async (ctx) => {
        const wh = ctx.wo.customer?.warehouseId;
        if (!wh) throw new AppError(400, 'Pelanggan belum punya gudang terkait');
        const short = (await installAvailability(ctx.tx, wh)).filter((r) => r.have < r.need);
        if (!short.length) return { to: 'READY_TO_SCHEDULE', note: 'Stok aman (pengecekan otomatis)' };
        const child = await ctx.createChild('STOCK_REQUEST', {
          toWarehouseId: wh,
          reason: `Otomatis dari ${ctx.wo.number} (${cname(ctx)})`,
          lines: short.map((s) => ({ itemId: s.item.id, qty: s.need - s.have })),
        });
        ctx.data.stockRequest = child.number;
        return { to: 'STOCK_PENDING', note: `Stok kurang: ${short.map((s) => `${s.item.name} (${s.have}/${s.need})`).join(', ')} → ${child.number}` };
      },
    },
    STOCK_PENDING: {
      label: 'Menunggu Stok (PROC)',
      owner: 'PROC',
      actions: [
        { key: 'recheck', label: 'Cek ulang stok', roles: ['PROC', 'GA'], to: 'STOCK_CHECK', fields: [] },
        { key: 'force_ready', label: 'Lanjutkan tanpa cek (override)', roles: ['PROC'], to: 'READY_TO_SCHEDULE', fields: [note(true)] },
      ],
    },
    READY_TO_SCHEDULE: { label: 'Siap Dijadwalkan (FOC)', owner: 'FOC', actions: [scheduleAction('schedule', 'Jadwalkan teknisi', 'SCHEDULED')] },
    SCHEDULED: {
      label: 'Terjadwal (FOC)',
      owner: 'FOC',
      actions: [scheduleAction('reschedule', 'Jadwalkan ulang', 'SCHEDULED'), startAction('IN_PROGRESS', true)],
    },
    IN_PROGRESS: {
      label: 'Instalasi Berjalan (FOC)',
      owner: 'FOC',
      actions: [
        {
          key: 'submit_report',
          label: 'Kirim laporan instalasi',
          roles: ['FOC'],
          assigneeOnly: true,
          to: 'PHYSICAL_DONE',
          fields: [
            { name: 'serials', label: 'Scan SN ONT / Router terpasang', type: 'serials', required: true },
            { name: 'cableMeters', label: 'Kabel terpakai (meter)', type: 'number', required: true },
            { name: 'materials', label: 'Material habis pakai (fast connector, sleeve, dll)', type: 'materials', itemCategory: 'CONSUMABLE' },
            { name: 'opmDbm', label: 'Redaman OPM (dBm)', type: 'number', required: true, help: 'contoh: -19.5' },
            photosF,
            note(),
          ],
          run: async (ctx, input) => {
            const i = z
              .object({ serials: sn.pipe(z.array(z.string()).min(1, 'Scan minimal 1 SN perangkat')), cableMeters: z.coerce.number().int().min(0), materials, opmDbm: z.coerce.number().min(-40).max(0), photos: z.array(z.string()).min(1, 'Minimal 1 foto'), note: optNote })
              .parse(input);
            const mob = await consume(ctx, i.cableMeters, i.materials);
            await installSerials(ctx, i.serials, mob.id);
            ctx.data.report = { ...i, at: new Date() };
          },
        },
      ],
    },
    PHYSICAL_DONE: {
      label: 'Instalasi Fisik Selesai – Menunggu Aktivasi (NOC)',
      owner: 'NOC',
      actions: [
        {
          key: 'service_active',
          label: 'Aktivasi selesai → Service Active',
          roles: ['NOC'],
          to: 'AWAITING_BA',
          fields: [
            { name: 'ontAuthorized', label: 'ONT/Router sudah di-authorize di OLT/Mikrotik', type: 'bool', required: true },
            { name: 'profile', label: 'Profil bandwidth', type: 'text', required: true },
            { name: 'pingMs', label: 'Ping (ms)', type: 'number', required: true },
            { name: 'latencyMs', label: 'Latency (ms)', type: 'number', required: true },
            { name: 'downMbps', label: 'Speedtest download (Mbps)', type: 'number', required: true },
            { name: 'upMbps', label: 'Speedtest upload (Mbps)', type: 'number', required: true },
            { name: 'stable', label: 'Stability check lulus', type: 'bool', required: true },
            note(),
          ],
          run: async (ctx, input) => {
            const i = z
              .object({
                ontAuthorized: yes('ONT/Router harus sudah di-authorize'),
                profile: z.string().min(1),
                pingMs: z.coerce.number().min(0),
                latencyMs: z.coerce.number().min(0),
                downMbps: z.coerce.number().min(0),
                upMbps: z.coerce.number().min(0),
                stable: yes('Stability check harus lulus'),
                note: optNote,
              })
              .parse(input);
            const c = ctx.wo.customer!;
            await setCustomer(ctx, { status: 'ACTIVE', activatedAt: new Date() });
            ctx.data.activation = { ...i, at: new Date() };
            await ctx.fx.emit('service.activated', { customerCode: c.code, customerName: c.name, package: c.packageName, ip: c.ip, vlan: c.vlan, woNumber: ctx.wo.number, activatedAt: new Date() });
            await ctx.fx.notify({
              roles: ['FIN'],
              woId: ctx.wo.id,
              subject: `[${ctx.wo.number}] Layanan aktif – siapkan invoice ${c.name}`,
              body: `NOC menyelesaikan aktivasi ${c.code} (${c.name}), paket ${c.packageName}. BA Digital segera dikirim Marketing — mohon siapkan pencatatan/invoice di sistem billing.\n${link(ctx)}`,
            });
          },
        },
      ],
    },
    AWAITING_BA: {
      label: 'Service Aktif – BA Digital (MKT)',
      owner: 'MKT',
      actions: [
        {
          key: 'send_ba',
          label: 'Kirim BA Digital ke pelanggan',
          roles: ['MKT'],
          to: 'CLOSED',
          fields: [{ name: 'recipientEmail', label: 'Email penerima BA (default: email pelanggan)', type: 'text' }, note()],
          run: async (ctx, input) => {
            const i = z.object({ recipientEmail: z.string().email().optional().or(z.literal('')), note: optNote }).parse(input);
            const c = ctx.wo.customer!;
            const baNumber = `BA-${ctx.wo.number}`;
            const to = i.recipientEmail || c.email;
            if (to)
              await ctx.fx.notify({
                emails: [to],
                woId: ctx.wo.id,
                subject: `Berita Acara Aktivasi Layanan ${baNumber}`,
                body: `Yth. ${c.name},\n\nLayanan internet Anda telah aktif.\nNo. BA: ${baNumber}\nPaket: ${c.packageName}\nAlamat: ${c.address}\n\nTerima kasih telah berlangganan.`,
              });
            ctx.data.ba = { number: baNumber, sentTo: to ?? null, at: new Date() };
            await ctx.fx.emit('invoice.prepare', { customerCode: c.code, customerName: c.name, package: c.packageName, baNumber, woNumber: ctx.wo.number, activatedAt: c.activatedAt });
            await ctx.fx.notify({
              roles: ['FIN'],
              woId: ctx.wo.id,
              subject: `[${ctx.wo.number}] BA terkirim – mulai cycle penagihan ${c.name}`,
              body: `BA ${baNumber} sudah dikirim ke pelanggan. Sinyal "invoice.prepare" telah dikirim ke aplikasi billing.\n${link(ctx)}`,
            });
          },
        },
      ],
    },
    CLOSED: { label: 'Selesai', owner: 'MKT', final: true, actions: [] },
    REJECTED: { label: 'Ditolak NOC', owner: 'MKT', final: true, actions: [] },
  },
};

/* ───────────────────────── 4. TROUBLE TICKET ───────────────────────── */

const trouble: Workflow = {
  type: 'TROUBLE',
  prefix: 'TT',
  label: 'Trouble Ticket',
  description: 'Tiket gangguan: diagnosa remote NOC → (jika fisik) perbaikan FOC → verifikasi NOC → konfirmasi MKT.',
  createRoles: ['MKT', 'NOC'],
  createFields: [
    { name: 'customerId', label: 'Pelanggan', type: 'customer', required: true, customerStatus: ['ACTIVE'] },
    { name: 'source', label: 'Sumber', type: 'select', options: ['Komplain pelanggan', 'Alarm monitoring'], required: true },
    { name: 'severity', label: 'Prioritas', type: 'select', options: ['Low', 'Medium', 'High', 'Critical'], required: true },
    { name: 'description', label: 'Keluhan / gejala', type: 'textarea', required: true },
  ],
  initial: 'NOC_DIAGNOSE',
  async create(tx, input) {
    const i = z.object({ customerId: z.string().min(1), source: z.string(), severity: z.string(), description: z.string().min(3) }).parse(input);
    const c = await tx.customer.findUnique({ where: { id: i.customerId } });
    if (!c || !['ACTIVE', 'SUSPENDED'].includes(c.status)) throw new AppError(400, 'Pelanggan tidak aktif');
    return { title: `Gangguan – ${c.name}`, customerId: c.id, data: { source: i.source, severity: i.severity, description: i.description } };
  },
  statuses: {
    NOC_DIAGNOSE: {
      label: 'Diagnosa Remote (NOC)',
      owner: 'NOC',
      actions: [
        {
          key: 'resolve_remote',
          label: 'Selesai remote → tutup tiket',
          roles: ['NOC'],
          to: 'CLOSED',
          fields: [{ name: 'rootCause', label: 'Akar masalah', type: 'text', required: true }, { name: 'fix', label: 'Tindakan', type: 'textarea', required: true }],
          run: async (ctx, input) => {
            ctx.data.resolution = z.object({ rootCause: z.string().min(2), fix: z.string().min(2) }).parse(input);
            await ctx.fx.notify({ roles: ['MKT'], woId: ctx.wo.id, subject: `[${ctx.wo.number}] Gangguan teratasi remote`, body: `${cname(ctx)} — mohon konfirmasi ke pelanggan.\n${link(ctx)}` });
          },
        },
        {
          key: 'escalate_field',
          label: 'Masalah fisik → terbitkan WO ke FOC',
          roles: ['NOC'],
          to: 'FIELD_DISPATCH',
          fields: [
            { name: 'cause', label: 'Dugaan masalah fisik', type: 'select', required: true, options: ['Kabel putus', 'Redaman tinggi', 'Adaptor mati', 'ONT/Router rusak', 'Lainnya'] },
            note(true),
          ],
          run: async (ctx, input) => {
            ctx.data.escalation = z.object({ cause: z.string().min(1), note: z.string().min(2) }).parse(input);
          },
        },
      ],
    },
    FIELD_DISPATCH: { label: 'WO Perbaikan – Menunggu Jadwal (FOC)', owner: 'FOC', actions: [scheduleAction('schedule', 'Jadwalkan teknisi', 'FIELD_SCHEDULED')] },
    FIELD_SCHEDULED: { label: 'Perbaikan Terjadwal (FOC)', owner: 'FOC', actions: [scheduleAction('reschedule', 'Jadwalkan ulang', 'FIELD_SCHEDULED'), startAction('FIELD_IN_PROGRESS', false)] },
    FIELD_IN_PROGRESS: {
      label: 'Perbaikan Berjalan (FOC)',
      owner: 'FOC',
      actions: [
        {
          key: 'submit_report',
          label: 'Kirim laporan perbaikan',
          roles: ['FOC'],
          assigneeOnly: true,
          to: 'NOC_VERIFY',
          fields: [
            { name: 'serialsNew', label: 'SN perangkat BARU terpasang', type: 'serials' },
            { name: 'serialsOld', label: 'SN perangkat LAMA yang diambil', type: 'serials' },
            { name: 'cableMeters', label: 'Kabel terpakai (meter)', type: 'number' },
            { name: 'materials', label: 'Material habis pakai', type: 'materials', itemCategory: 'CONSUMABLE' },
            { name: 'opmDbm', label: 'Redaman OPM setelah perbaikan (dBm)', type: 'number' },
            photosF,
            note(true),
          ],
          run: async (ctx, input) => {
            const i = z
              .object({ serialsNew: sn.default([]), serialsOld: sn.default([]), cableMeters: z.coerce.number().int().min(0).default(0), materials, opmDbm: z.coerce.number().min(-40).max(0).optional(), photos: z.array(z.string()).min(1, 'Minimal 1 foto'), note: z.string().min(2, 'Isi catatan perbaikan') })
              .parse(input);
            const mob = await consume(ctx, i.cableMeters, i.materials);
            await installSerials(ctx, i.serialsNew, mob.id);
            for (const s of i.serialsOld) {
              const a = await mustAsset(ctx.tx, s);
              if (a.customerId !== ctx.wo.customerId || a.status !== 'INSTALLED') throw new AppError(409, `SN lama ${a.serialNumber} tidak tercatat terpasang di pelanggan ini`);
              await moveAsset(ctx.tx, a, { status: 'RETURNED_PENDING_QC', toWarehouseId: mob.id, reason: `Diganti – ${ctx.wo.number}`, woId: ctx.wo.id, actorId: ctx.actor.id });
            }
            ctx.data.report = { ...i, at: new Date() };
          },
        },
      ],
    },
    NOC_VERIFY: {
      label: 'Verifikasi Koneksi (NOC)',
      owner: 'NOC',
      actions: [
        { key: 'verify_up', label: 'Koneksi UP / normal', roles: ['NOC'], to: 'MKT_CONFIRM', fields: [{ name: 'pingMs', label: 'Ping (ms)', type: 'number' }, note()] },
        { key: 'not_up', label: 'Belum normal → kembali ke FOC', roles: ['NOC'], to: 'FIELD_DISPATCH', danger: true, fields: [note(true)] },
      ],
    },
    MKT_CONFIRM: {
      label: 'Konfirmasi ke Pelanggan (MKT)',
      owner: 'MKT',
      actions: [{ key: 'confirm', label: 'Pelanggan sudah konfirmasi → tutup', roles: ['MKT'], to: 'CLOSED', fields: [note()] }],
    },
    CLOSED: { label: 'Selesai', owner: 'MKT', final: true, actions: [] },
  },
};

/* ───────────────────────── 6. SUSPEND / UNSUSPEND ───────────────────────── */

const customerPick = (st: ('ACTIVE' | 'SUSPENDED')[]): Field => ({ name: 'customerId', label: 'Pelanggan', type: 'customer', required: true, customerStatus: st });

const suspend: Workflow = {
  type: 'SUSPEND',
  prefix: 'WO-SP',
  label: 'Suspend / Isolir',
  description: 'Otomatis dari billing (telat bayar) atau manual MKT (cuti) → NOC isolir profil jaringan.',
  createRoles: ['MKT', 'FIN'],
  createFields: [customerPick(['ACTIVE']), { name: 'reason', label: 'Alasan', type: 'select', required: true, options: ['Tunggakan pembayaran', 'Cuti berlangganan', 'Lainnya'] }, note()],
  initial: 'NOC_ISOLATE',
  uniqueOpenPerCustomer: true,
  async create(tx, input) {
    const i = z.object({ customerId: z.string().min(1), reason: z.string().min(1), note: optNote, ref: optNote }).parse(input);
    const c = await tx.customer.findUnique({ where: { id: i.customerId } });
    if (!c || c.status !== 'ACTIVE') throw new AppError(400, 'Hanya pelanggan ACTIVE yang bisa di-suspend');
    return { title: `Suspend – ${c.name}`, customerId: c.id, data: { reason: i.reason, note: i.note, ref: i.ref } };
  },
  statuses: {
    NOC_ISOLATE: {
      label: 'Isolasi Layanan (NOC)',
      owner: 'NOC',
      actions: [
        {
          key: 'isolate',
          label: 'Isolasi selesai (profil Isolated)',
          roles: ['NOC'],
          to: 'DONE',
          fields: [{ name: 'profile', label: 'Profil isolir diterapkan', type: 'text', required: true }, note()],
          run: async (ctx, input) => {
            ctx.data.isolation = z.object({ profile: z.string().min(1), note: optNote }).parse(input);
            await setCustomer(ctx, { status: 'SUSPENDED' });
            await ctx.fx.emit('service.suspended', { customerCode: ctx.wo.customer!.code, woNumber: ctx.wo.number });
            await ctx.fx.notify({ roles: ['MKT', 'FIN'], woId: ctx.wo.id, subject: `[${ctx.wo.number}] ${cname(ctx)} ter-isolir`, body: `Layanan pelanggan telah diisolir NOC.\n${link(ctx)}` });
          },
        },
      ],
    },
    DONE: { label: 'Selesai (Suspended)', owner: 'NOC', final: true, actions: [] },
  },
};

const unsuspend: Workflow = {
  type: 'UNSUSPEND',
  prefix: 'WO-US',
  label: 'Unsuspend',
  description: 'Pelunasan tercatat di billing → sinyal ke WO App → NOC mengembalikan profil normal.',
  createRoles: ['FIN', 'MKT'],
  createFields: [customerPick(['SUSPENDED']), note()],
  initial: 'NOC_RESTORE',
  uniqueOpenPerCustomer: true,
  async create(tx, input) {
    const i = z.object({ customerId: z.string().min(1), note: optNote, ref: optNote }).parse(input);
    const c = await tx.customer.findUnique({ where: { id: i.customerId } });
    if (!c || c.status !== 'SUSPENDED') throw new AppError(400, 'Pelanggan tidak sedang suspended');
    return { title: `Unsuspend – ${c.name}`, customerId: c.id, data: { note: i.note, ref: i.ref } };
  },
  statuses: {
    NOC_RESTORE: {
      label: 'Pemulihan Akses (NOC)',
      owner: 'NOC',
      actions: [
        {
          key: 'restore',
          label: 'Profil dikembalikan ke Active',
          roles: ['NOC'],
          to: 'DONE',
          fields: [{ name: 'profile', label: 'Profil bandwidth dipulihkan', type: 'text', required: true }, note()],
          run: async (ctx, input) => {
            ctx.data.restore = z.object({ profile: z.string().min(1), note: optNote }).parse(input);
            await setCustomer(ctx, { status: 'ACTIVE' });
            await ctx.fx.emit('service.restored', { customerCode: ctx.wo.customer!.code, woNumber: ctx.wo.number });
            await ctx.fx.notify({ roles: ['MKT', 'FIN'], woId: ctx.wo.id, subject: `[${ctx.wo.number}] ${cname(ctx)} aktif kembali`, body: `Akses pelanggan telah dipulihkan.\n${link(ctx)}` });
          },
        },
      ],
    },
    DONE: { label: 'Selesai (Active)', owner: 'NOC', final: true, actions: [] },
  },
};

/* ───────────────────────── 7. TERMINATE & ASSET RECOVERY ───────────────────────── */

const terminate: Workflow = {
  type: 'TERMINATE',
  prefix: 'WO-TM',
  label: 'Terminate & Penarikan Aset',
  description: 'Pengajuan MKT/FIN → NOC hapus konfigurasi → FOC dismantle & scan SN → GA QC → FIN tutup akun.',
  createRoles: ['MKT', 'FIN'],
  createFields: [customerPick(['ACTIVE', 'SUSPENDED']), { name: 'reason', label: 'Alasan', type: 'select', required: true, options: ['Berhenti berlangganan', 'Bad debt (tunggakan kronis)', 'Pindah lokasi', 'Lainnya'] }, note()],
  initial: 'NOC_DEACTIVATE',
  uniqueOpenPerCustomer: true,
  async create(tx, input) {
    const i = z.object({ customerId: z.string().min(1), reason: z.string().min(1), note: optNote, ref: optNote }).parse(input);
    const c = await tx.customer.findUnique({ where: { id: i.customerId } });
    if (!c || !['ACTIVE', 'SUSPENDED'].includes(c.status)) throw new AppError(400, 'Pelanggan tidak bisa di-terminate pada status ini');
    await tx.customer.update({ where: { id: c.id }, data: { status: 'TERMINATING' } });
    return { title: `Terminate – ${c.name}`, customerId: c.id, data: { reason: i.reason, note: i.note, ref: i.ref, prevStatus: c.status } };
  },
  async onCancel(ctx) {
    await setCustomer(ctx, { status: ctx.wo.data && (ctx.wo.data as any).prevStatus === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE' });
  },
  statuses: {
    NOC_DEACTIVATE: {
      label: 'Deaktivasi Jaringan (NOC)',
      owner: 'NOC',
      actions: [
        {
          key: 'deactivate',
          label: 'Konfigurasi dihapus',
          roles: ['NOC'],
          to: 'DISMANTLE_DISPATCH',
          fields: [
            { name: 'vlanRemoved', label: 'VLAN dihapus', type: 'bool', required: true },
            { name: 'ipReleased', label: 'IP dilepas', type: 'bool', required: true },
            { name: 'ontUnauthorized', label: 'ONT di-unauthorize dari OLT', type: 'bool', required: true },
            note(),
          ],
          run: async (ctx, input) => {
            z.object({ vlanRemoved: yes('VLAN harus dihapus'), ipReleased: yes('IP harus dilepas'), ontUnauthorized: yes('ONT harus di-unauthorize'), note: optNote }).parse(input);
            const c = ctx.wo.customer!;
            ctx.data.released = { ip: c.ip, vlan: c.vlan, odp: c.odp, port: c.port };
            await setCustomer(ctx, { ip: null, vlan: null, port: null });
            await ctx.fx.emit('service.deactivated', { customerCode: c.code, woNumber: ctx.wo.number });
          },
        },
      ],
    },
    DISMANTLE_DISPATCH: { label: 'Penarikan Aset – Menunggu Jadwal (FOC)', owner: 'FOC', actions: [scheduleAction('schedule', 'Jadwalkan teknisi', 'DISMANTLE_SCHEDULED')] },
    DISMANTLE_SCHEDULED: { label: 'Penarikan Terjadwal (FOC)', owner: 'FOC', actions: [scheduleAction('reschedule', 'Jadwalkan ulang', 'DISMANTLE_SCHEDULED'), startAction('DISMANTLE_IN_PROGRESS', false)] },
    DISMANTLE_IN_PROGRESS: {
      label: 'Penarikan Berjalan (FOC)',
      owner: 'FOC',
      actions: [
        {
          key: 'submit_report',
          label: 'Kirim laporan penarikan',
          roles: ['FOC'],
          assigneeOnly: true,
          to: 'QC_PENDING',
          fields: [
            { name: 'serials', label: 'Scan SN perangkat yang ditarik', type: 'serials' },
            { name: 'missingReason', label: 'Alasan jika ada perangkat tidak bisa ditarik', type: 'textarea' },
            photosF,
            note(),
          ],
          run: async (ctx, input) => {
            const i = z.object({ serials: sn.default([]), missingReason: optNote, photos: z.array(z.string()).min(1, 'Minimal 1 foto'), note: optNote }).parse(input);
            const mob = await mobileWarehouse(ctx.tx, ctx.wo.assigneeId ?? ctx.actor.id);
            for (const s of i.serials) {
              const a = await mustAsset(ctx.tx, s);
              if (a.customerId !== ctx.wo.customerId || a.status !== 'INSTALLED') throw new AppError(409, `SN ${a.serialNumber} tidak tercatat terpasang di pelanggan ini`);
              await moveAsset(ctx.tx, a, { status: 'RETURNED_PENDING_QC', toWarehouseId: mob.id, reason: `Ditarik – ${ctx.wo.number}`, woId: ctx.wo.id, actorId: ctx.actor.id });
            }
            const left = await ctx.tx.asset.findMany({ where: { customerId: ctx.wo.customerId, status: 'INSTALLED' } });
            if (left.length && !i.missingReason)
              throw new AppError(400, `Perangkat belum di-scan: ${left.map((a) => a.serialNumber).join(', ')}. Scan atau isi alasan.`);
            for (const a of left) {
              await moveAsset(ctx.tx, a, { status: 'SCRAP', toWarehouseId: null, reason: `Tidak dapat ditarik: ${i.missingReason}`, woId: ctx.wo.id, actorId: ctx.actor.id });
              await ctx.tx.asset.update({ where: { id: a.id }, data: { condition: `Tidak ditarik: ${i.missingReason}` } });
            }
            ctx.data.report = { ...i, missing: left.map((a) => a.serialNumber), at: new Date() };
          },
        },
      ],
    },
    QC_PENDING: {
      label: 'Quality Check Aset (GA)',
      owner: 'GA',
      actions: [
        {
          key: 'qc',
          label: 'Simpan hasil QC',
          roles: ['GA', 'PROC'],
          to: 'FIN_CLOSE',
          fields: [{ name: 'results', label: 'Hasil QC per perangkat', type: 'qc', required: true }],
          run: async (ctx, input) => {
            const i = z
              .object({ results: z.array(z.object({ serial: z.string(), result: z.enum(['GOOD', 'DAMAGED', 'SCRAP']), warehouseId: z.string().optional(), note: z.string().optional() })) })
              .parse(input);
            const pending = await ctx.tx.asset.findMany({ where: { woId: ctx.wo.id, status: 'RETURNED_PENDING_QC' } });
            const done = new Set(i.results.map((r) => normSn(r.serial)));
            const left = pending.filter((a) => !done.has(a.serialNumber));
            if (left.length) throw new AppError(400, `QC belum lengkap: ${left.map((a) => a.serialNumber).join(', ')}`);
            await qcAssets(ctx.tx, i.results, ctx.actor.id, ctx.wo.id);
            ctx.data.qc = i.results;
          },
        },
      ],
    },
    FIN_CLOSE: {
      label: 'Penutupan Akun (FIN)',
      owner: 'FIN',
      actions: [
        {
          key: 'close_account',
          label: 'Akun ditutup di billing',
          roles: ['FIN'],
          to: 'CLOSED',
          fields: [note()],
          run: async (ctx) => {
            await setCustomer(ctx, { status: 'TERMINATED' });
            await ctx.fx.emit('account.closed', { customerCode: ctx.wo.customer!.code, woNumber: ctx.wo.number });
            await ctx.fx.notify({ roles: ['MKT'], woId: ctx.wo.id, subject: `[${ctx.wo.number}] Akun ${cname(ctx)} resmi ditutup`, body: link(ctx) });
          },
        },
      ],
    },
    CLOSED: { label: 'Selesai (Terminated)', owner: 'FIN', final: true, actions: [] },
  },
};

/* ───────────────────────── 5. PERMINTAAN STOK / PO ───────────────────────── */

const stockRequest: Workflow = {
  type: 'STOCK_REQUEST',
  prefix: 'WO-SR',
  label: 'Permintaan Barang',
  description: 'FOC/NOC/GA meminta barang → PROC mutasi antar-gudang atau terbitkan PO → penerimaan & barcoding.',
  createRoles: ['FOC', 'NOC', 'GA', 'PROC'],
  createFields: [
    { name: 'toWarehouseId', label: 'Gudang tujuan', type: 'warehouse', required: true },
    { name: 'lines', label: 'Barang yang diminta', type: 'materials', required: true },
    { name: 'reason', label: 'Alasan / kebutuhan', type: 'textarea', required: true },
  ],
  initial: 'PROC_REVIEW',
  async create(tx, input) {
    const i = z.object({ toWarehouseId: z.string().min(1), lines: materials.pipe(z.array(z.any()).min(1, 'Minimal 1 barang')), reason: z.string().min(2) }).parse(input);
    const wh = await tx.warehouse.findUnique({ where: { id: i.toWarehouseId } });
    if (!wh) throw new AppError(400, 'Gudang tujuan tidak valid');
    return { title: `Permintaan barang → ${wh.name}`, data: { toWarehouseId: wh.id, lines: i.lines, reason: i.reason } };
  },
  statuses: {
    PROC_REVIEW: {
      label: 'Review Procurement',
      owner: 'PROC',
      actions: [
        {
          key: 'transfer',
          label: 'Stok ada di gudang lain → mutasi',
          roles: ['PROC'],
          to: 'AWAITING_RECEIPT',
          fields: [
            { name: 'fromWarehouseId', label: 'Gudang asal', type: 'warehouse', required: true },
            { name: 'serials', label: 'SN perangkat yang dikirim (untuk item ber-SN)', type: 'serials' },
            note(),
          ],
          run: async (ctx, input) => {
            const i = z.object({ fromWarehouseId: z.string().min(1), serials: sn.default([]), note: optNote }).parse(input);
            const to = (ctx.wo.data as any).toWarehouseId as string;
            if (i.fromWarehouseId === to) throw new AppError(400, 'Gudang asal dan tujuan sama');
            const lines = (ctx.wo.data as any).lines as { itemId: string; qty: number }[];
            const items = await ctx.tx.item.findMany({ where: { id: { in: lines.map((l) => l.itemId) } } });
            const assets = [];
            for (const s of i.serials) assets.push(await mustAsset(ctx.tx, s));
            for (const l of lines) {
              const item = items.find((x) => x.id === l.itemId)!;
              if (item.tracked) {
                const mine = assets.filter((a) => a.itemId === item.id);
                if (mine.length !== l.qty) throw new AppError(400, `${item.name}: butuh ${l.qty} SN, diisi ${mine.length}`);
                for (const a of mine) {
                  if (a.warehouseId !== i.fromWarehouseId || !AVAILABLE.includes(a.status)) throw new AppError(409, `SN ${a.serialNumber} tidak tersedia di gudang asal`);
                  await moveAsset(ctx.tx, a, { status: a.status, toWarehouseId: to, reason: `Mutasi ${ctx.wo.number}`, woId: ctx.wo.id, actorId: ctx.actor.id });
                }
              } else {
                await moveStock(ctx.tx, { itemId: item.id, qty: l.qty, from: i.fromWarehouseId, to, reason: `Mutasi ${ctx.wo.number}`, woId: ctx.wo.id, actorId: ctx.actor.id });
              }
            }
            ctx.data.transfer = { from: i.fromWarehouseId, at: new Date() };
          },
        },
        {
          key: 'create_po',
          label: 'Stok habis → terbitkan PO ke vendor',
          roles: ['PROC'],
          to: 'PO_ISSUED',
          fields: [{ name: 'vendor', label: 'Vendor', type: 'text', required: true }, note()],
          run: async (ctx, input) => {
            const i = z.object({ vendor: z.string().min(2), note: optNote }).parse(input);
            const d = ctx.wo.data as any;
            const po = await ctx.tx.purchaseOrder.create({
              data: {
                number: await nextNumber(ctx.tx, 'PO'),
                vendor: i.vendor,
                woId: ctx.wo.id,
                toWarehouseId: d.toWarehouseId,
                note: i.note,
                createdById: ctx.actor.id,
                lines: { create: (d.lines as { itemId: string; qty: number }[]).map((l) => ({ itemId: l.itemId, qty: l.qty })) },
              },
            });
            ctx.data.po = po.number;
          },
        },
      ],
    },
    AWAITING_RECEIPT: {
      label: 'Barang Dikirim – Menunggu Penerimaan',
      owner: 'GA',
      actions: [{ key: 'receive', label: 'Barang diterima', roles: ['FOC', 'NOC', 'GA', 'PROC'], to: 'CLOSED', fields: [note()] }],
    },
    PO_ISSUED: {
      label: 'PO Terbit – Menunggu Barang (PROC)',
      owner: 'PROC',
      actions: [{ key: 'po_received', label: 'PO diterima', roles: [], system: true, to: 'CLOSED', fields: [] }],
    },
    CLOSED: { label: 'Selesai', owner: 'PROC', final: true, actions: [] },
  },
};

export const workflows: Record<WoType, Workflow> = {
  NEW_INSTALL: newInstall,
  TROUBLE: trouble,
  SUSPEND: suspend,
  UNSUSPEND: unsuspend,
  TERMINATE: terminate,
  STOCK_REQUEST: stockRequest,
};

/** Versi serializable untuk frontend. */
export function workflowMeta() {
  return Object.values(workflows).map((w) => ({
    type: w.type,
    label: w.label,
    description: w.description,
    createRoles: w.createRoles,
    createFields: w.createFields,
    statuses: Object.fromEntries(
      Object.entries(w.statuses).map(([k, s]) => [
        k,
        { label: s.label, owner: s.owner, final: !!s.final, actions: s.actions.filter((a) => !a.system).map((a) => ({ key: a.key, label: a.label, roles: a.roles, fields: a.fields, danger: !!a.danger, assigneeOnly: !!a.assigneeOnly })) },
      ]),
    ),
  }));
}
