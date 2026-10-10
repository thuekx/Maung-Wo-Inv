import { z } from 'zod';
import { WoType } from './orm';
import { AppError, fieldError } from './db';
import { config } from './config';
import { AVAILABLE, installAvailability, mobileWarehouse, moveAsset, moveStock, mustAsset, nextNumber, normSn, qcAssets } from './inventory';
import { aliasForArea, baNumber } from './docnum';
import { assertNetworkFree, internalIp, odpName, portName, publicIp, vlanId } from './network';
import { inTeam, isLead, type ActionDef, type Ctx, type Field, type Workflow } from './wf-types';

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
const optNote = z.string().max(1000, 'Maksimal 1000 karakter').optional();
const blankToUndef = (v: unknown) => (v === '' || v === null ? undefined : v);
const optText = z.preprocess(blankToUndef, z.string().trim().max(60, 'Maksimal 60 karakter').optional());
const optNum = (min: number, max: number) => z.preprocess(blankToUndef, z.coerce.number().min(min).max(max).optional());

/** Isian data teknis laporan lapangan (instalasi / troubleshooting / maintenance) — dibawa ke laporan PDF. */
const techFields = (opts: { redamanRequired?: boolean } = {}): Field[] => [
  { name: 'odp', label: 'ODP', type: 'text', help: 'Terisi dari validasi; ubah hanya bila aktual di lapangan berbeda (dicek duplikat)' },
  { name: 'port', label: 'Port ODP', type: 'text', help: 'Terisi dari validasi; ubah hanya bila aktual berbeda' },
  { name: 'pop', label: 'POP', type: 'text' },
  { name: 'mainSplitter', label: 'Main splitter', type: 'text' },
  { name: 'lat', label: 'Latitude (koordinat lokasi)', type: 'number', help: 'Tekan "Gunakan lokasi sekarang" atau pilih dari peta' },
  { name: 'lng', label: 'Longitude (koordinat lokasi)', type: 'number' },
  { name: 'signalDbm', label: 'Signal (dBm)', type: 'number', help: 'Mis. level terima ONT: -18.5' },
  { name: 'opmDbm', label: 'Redaman OPM (dBm)', type: 'number', required: opts.redamanRequired, help: 'contoh: -19.5' },
];
const techZ = { odp: odpName, port: portName, pop: optText, mainSplitter: optText, lat: optNum(-90, 90), lng: optNum(-180, 180), signalDbm: optNum(-60, 20) };

/** Terapkan data teknis ke pelanggan (ODP/port/POP/koordinat) dan kembalikan nilai akhir untuk laporan. */
async function applyTech(ctx: Ctx, i: { odp?: string; port?: string; pop?: string; lat?: number; lng?: number }) {
  const cur = ctx.wo.customer;
  const out = { odp: i.odp ?? cur?.odp ?? undefined, port: i.port ?? cur?.port ?? undefined, pop: i.pop ?? cur?.pop ?? undefined };
  if (cur) {
    if ((i.odp && i.odp !== cur.odp) || (i.port && i.port !== cur.port)) {
      await assertNetworkFree(ctx.tx, { odp: out.odp, port: out.port }, cur.id);
      ctx.data.fieldChange = { from: { odp: cur.odp, port: cur.port }, to: { odp: out.odp, port: out.port }, by: ctx.actor.name, at: new Date() };
      await ctx.fx.notify({ roles: ['NOC'], woId: ctx.wo.id, subject: `[${ctx.wo.number}] ODP/port dikoreksi teknisi`, body: `Pelanggan ${cname(ctx)}\nRencana: ${cur.odp ?? '-'}/${cur.port ?? '-'} → Aktual: ${out.odp ?? '-'}/${out.port ?? '-'}\n${link(ctx)}` });
    }
    await setCustomer(ctx, { odp: out.odp ?? null, port: out.port ?? null, pop: out.pop ?? null, ...(i.lat != null && i.lng != null ? { lat: i.lat, lng: i.lng } : {}) });
  }
  return out;
}

async function customerOf(ctx: Ctx) {
  if (!ctx.wo.customerId) throw new AppError(400, 'WO tidak terhubung ke pelanggan');
  return ctx.wo.customerId;
}

async function setCustomer(ctx: Ctx, data: Record<string, any>) {
  await ctx.tx.customer.update({ where: { id: await customerOf(ctx) }, data });
}

/**
 * Pemilik Stok Berjalan yang dipakai WO ini: yang mengambil material saat "Mulai" (tersimpan di data.pickup.techId),
 * bila belum ada pengambilan = anggota tim yang sedang bertindak, atau teknisi utama.
 */
function stockOwner(ctx: Ctx) {
  const picked = (ctx.wo.data as any)?.pickup?.techId as string | undefined;
  return picked ?? (inTeam(ctx.wo, ctx.actor.id) ? ctx.actor.id : ctx.wo.assigneeId ?? ctx.actor.id);
}

const teamNames = async (ctx: Ctx, ids: string[]) => (await ctx.tx.user.findMany({ where: { id: { in: ids } }, select: { name: true } })).map((u) => u.name);

/** Teknisi mengambil material dari gudang → Stok Berjalan miliknya. */
async function pickup(ctx: Ctx, input: unknown) {
  const i = z.object({ sourceWarehouseId: z.string().min(1), serials: sn.default([]), materials }).parse(input);
  const techId = inTeam(ctx.wo, ctx.actor.id) ? ctx.actor.id : ctx.wo.assigneeId ?? ctx.actor.id;
  const mob = await mobileWarehouse(ctx.tx, techId);
  for (const s of i.serials) {
    const a = await mustAsset(ctx.tx, s);
    if (a.warehouseId !== i.sourceWarehouseId || !AVAILABLE.includes(a.status))
      throw new AppError(409, `SN ${a.serialNumber} tidak tersedia di gudang sumber`);
    await moveAsset(ctx.tx, a, { status: 'IN_STOCK', toWarehouseId: mob.id, reason: 'Ambil material ke stok berjalan', woId: ctx.wo.id, actorId: ctx.actor.id });
  }
  for (const m of i.materials)
    await moveStock(ctx.tx, { itemId: m.itemId, qty: m.qty, from: i.sourceWarehouseId, to: mob.id, reason: 'Ambil material ke stok berjalan', woId: ctx.wo.id, actorId: ctx.actor.id });
  ctx.data.pickup = { serials: i.serials, materials: i.materials, techId, at: new Date() };
}

/**
 * Pakai material habis pakai dari Stok Berjalan. Kabel (item ber-core) harus lewat daftar material seperti barang lain;
 * parameter `cableMeters` hanya dipertahankan untuk klien API lama (dipetakan ke item DROPCORE).
 * `pickedOnly`: hanya boleh memakai item & jumlah yang diambil teknisi saat "Mulai & ambil material" (laporan instalasi).
 */
async function consume(ctx: Ctx, cableMeters: number, lines: { itemId: string; qty: number }[], opts: { pickedOnly?: boolean } = {}) {
  const mob = await mobileWarehouse(ctx.tx, stockOwner(ctx));
  const used = new Map<string, number>();
  for (const l of lines) used.set(l.itemId, (used.get(l.itemId) ?? 0) + l.qty);
  if (cableMeters > 0) {
    const cable = await ctx.tx.item.findUnique({ where: { sku: 'DROPCORE' } });
    if (!cable) throw new AppError(500, 'Item DROPCORE belum ada di master item');
    used.set(cable.id, (used.get(cable.id) ?? 0) + cableMeters);
  }
  if (opts.pickedOnly) {
    const picked = new Map<string, number>();
    for (const m of ((ctx.wo.data as any)?.pickup?.materials ?? []) as { itemId: string; qty: number }[]) picked.set(m.itemId, (picked.get(m.itemId) ?? 0) + m.qty);
    for (const [itemId, qty] of used) {
      const it = await ctx.tx.item.findUnique({ where: { id: itemId } });
      const have = picked.get(itemId);
      if (have === undefined) throw fieldError('materials', `${it?.name ?? itemId} tidak diambil saat "Mulai & ambil material" — hanya material yang sudah diambil yang bisa dilaporkan terpakai`, 409);
      if (qty > have) throw fieldError('materials', `${it?.name ?? itemId}: dilaporkan ${qty} ${it?.unit ?? ''}, tetapi yang diambil hanya ${have}`, 409);
    }
    ctx.data.reconciliation = {
      items: [...picked].map(([itemId, qty]) => ({ itemId, picked: qty, used: used.get(itemId) ?? 0, leftover: qty - (used.get(itemId) ?? 0) })),
      note: 'Sisa tetap tercatat di Stok Berjalan teknisi (menjadi tanggung jawab peminta) sampai dikembalikan dan diterima gudang',
    };
  }
  for (const [itemId, qty] of used)
    await moveStock(ctx.tx, { itemId, qty, from: mob.id, to: null, reason: `Terpakai – ${ctx.wo.number}`, woId: ctx.wo.id, actorId: ctx.actor.id });
  return mob;
}

/** Perangkat ber-SN terpasang di pelanggan: harus ada di Stok Berjalan teknisi. */
async function installSerials(ctx: Ctx, serials: string[], mobId: string) {
  for (const s of serials) {
    const a = await mustAsset(ctx.tx, s);
    if (a.warehouseId !== mobId || !AVAILABLE.includes(a.status))
      throw new AppError(409, `SN ${a.serialNumber} tidak ada di Stok Berjalan teknisi — lakukan "Ambil material" dulu`);
    await moveAsset(ctx.tx, a, { status: 'INSTALLED', toWarehouseId: null, customerId: ctx.wo.customerId, reason: `Terpasang – ${ctx.wo.number}`, woId: ctx.wo.id, actorId: ctx.actor.id });
  }
}

const technicianIdsF: Field = { name: 'technicianIds', label: 'Tim pelaksana (pilih 1 atau lebih)', type: 'technicians', required: true, help: 'Supervisor tidak dapat menugaskan Manager; boleh menugaskan diri sendiri atau supervisor lain. Salah satu anggota tim yang mengirim laporan dan namanya tercantum di kolom Tim Pelaksana.' };

/** Validasi & ambil tim: teknisi FOC aktif; supervisor tidak boleh menugaskan manager. */
async function resolveTeam(ctx: { tx: Ctx['tx']; actor: Ctx['actor'] }, input: { technicianIds?: string[]; technicianId?: string }) {
  const ids = [...new Set((input.technicianIds?.length ? input.technicianIds : input.technicianId ? [input.technicianId] : []).filter(Boolean))];
  if (!ids.length) throw fieldError('technicianIds', 'Pilih minimal 1 teknisi');
  const techs = await ctx.tx.user.findMany({ where: { id: { in: ids }, role: 'FOC', active: true } });
  if (techs.length !== ids.length) throw fieldError('technicianIds', 'Ada teknisi yang tidak valid / nonaktif');
  if (ctx.actor.role !== 'ADMIN' && ctx.actor.subRole === 'SUPERVISOR' && techs.some((t) => t.subRole === 'MANAGER'))
    throw fieldError('technicianIds', 'Supervisor tidak dapat menugaskan Manager FOC');
  return ids.map((id) => techs.find((t) => t.id === id)!);
}

const teamInput = z.object({ technicianIds: z.array(z.string()).optional(), technicianId: z.string().optional(), scheduledAt: z.coerce.date(), note: optNote });

const scheduleAction = (key: string, label: string, to: string): ActionDef => ({
  key,
  label,
  roles: ['FOC'],
  leadOnly: true,
  to,
  fields: [technicianIdsF, scheduledF, note()],
  run: async (ctx, input) => {
    const i = teamInput.parse(input);
    const team = await resolveTeam(ctx, i);
    ctx.patch.assigneeId = team[0].id;
    ctx.patch.teamIds = team.map((t) => t.id);
    ctx.patch.scheduledAt = i.scheduledAt;
    ctx.data.team = team.map((t) => t.name);
    if (ctx.wo.type === 'NEW_INSTALL') await setCustomer(ctx, { status: 'INSTALLING' });
    await ctx.fx.notify({
      userIds: team.map((t) => t.id),
      woId: ctx.wo.id,
      subject: `[${ctx.wo.number}] Tugas baru untuk Anda`,
      body: `${ctx.wo.title}\nPelanggan: ${cname(ctx)}\nAlamat: ${ctx.wo.customer?.address ?? '-'}\nTim: ${team.map((t) => t.name).join(', ')}\nJadwal: ${i.scheduledAt.toLocaleString('id-ID')}\n${link(ctx)}`,
    });
  },
});

/**
 * Ganti tim saat pekerjaan sudah berjalan. Syarat: laporan progres lapangan harus sudah ada setelah pekerjaan dimulai
 * (atau setelah pergantian tim terakhir) — selama belum ada laporan, tim tidak dapat diganti.
 */
const changeTeamAction = (to: string): ActionDef => ({
  key: 'change_team',
  label: 'Ganti tim pelaksana',
  roles: ['FOC'],
  leadOnly: true,
  to,
  fields: [technicianIdsF, note(true)],
  run: async (ctx, input) => {
    const i = z.object({ technicianIds: z.array(z.string()).optional(), technicianId: z.string().optional(), note: z.string().min(3, 'Isi alasan penggantian tim') }).parse(input);
    const last = await ctx.tx.woEvent.findFirst({ where: { woId: ctx.wo.id, action: { in: ['progress', 'start', 'change_team'] } }, orderBy: { createdAt: 'desc' } });
    if (last?.action !== 'progress') throw new AppError(409, 'Kirim laporan progres lapangan terlebih dahulu (kartu "Update progres lapangan"), baru tim dapat diganti');
    const team = await resolveTeam(ctx, i);
    const before = await teamNames(ctx, ctx.wo.teamIds.length ? ctx.wo.teamIds : ctx.wo.assigneeId ? [ctx.wo.assigneeId] : []);
    ctx.patch.assigneeId = team[0].id;
    ctx.patch.teamIds = team.map((t) => t.id);
    ctx.data.team = team.map((t) => t.name);
    ctx.data.teamHistory = [...(((ctx.wo.data as any)?.teamHistory ?? []) as unknown[]), { at: new Date(), by: ctx.actor.name, from: before, to: team.map((t) => t.name), reason: i.note }];
    await ctx.fx.notify({
      userIds: [...new Set([...team.map((t) => t.id), ...ctx.wo.teamIds])],
      woId: ctx.wo.id,
      subject: `[${ctx.wo.number}] Tim pelaksana diganti`,
      body: `${ctx.wo.title}\nTim baru: ${team.map((t) => t.name).join(', ')}\nAlasan: ${i.note}\n${link(ctx)}`,
    });
    return ctx.wo.status;
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
  description: 'Registrasi → validasi teknis FOC (supervisor/manager) → cek stok → instalasi FOC → aktivasi NOC → BA Digital & trigger invoice.',
  createRoles: ['MKT'],
  createFields: [
    { name: 'customerCode', label: 'ID pelanggan MSRadius (opsional)', type: 'text', help: 'Isi bila ID/kode sudah dibuat di MSRadius; kosong = dibuat otomatis. Setelah akun aktif di MSRadius, tarik datanya dari halaman pelanggan (tombol "Tarik dari MSRadius").' },
    { name: 'name', label: 'Nama pelanggan', type: 'text', required: true },
    { name: 'phone', label: 'No. telepon / WA', type: 'text', required: true },
    { name: 'email', label: 'Email pelanggan', type: 'text' },
    { name: 'address', label: 'Alamat pemasangan', type: 'textarea', required: true },
    { name: 'lat', label: 'Latitude (GPS)', type: 'number', help: 'Opsional. contoh: -6.2088' },
    { name: 'lng', label: 'Longitude (GPS)', type: 'number', help: 'Opsional. contoh: 106.8456' },
    { name: 'packageName', label: 'Paket langganan', type: 'package', required: true },
    { name: 'areaId', label: 'Area', type: 'area', required: true, help: 'Area layanan (dari MSRadius / Master Area); menentukan gudang yang menyuplai pemasangan' },
    { name: 'notes', label: 'Catatan sales', type: 'textarea' },
  ],
  initial: 'FOC_VALIDATION',
  async create(tx, input) {
    const i = z
      .object({
        customerCode: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9._/-]+$/, 'Hanya huruf, angka, . _ / -').optional()),
        name: z.string().trim().min(2).max(120, 'Maksimal 120 karakter'),
        phone: z.string().trim().min(6).max(20, 'Maksimal 20 karakter').regex(/^[0-9+][0-9 +()-]*$/, 'Hanya angka, spasi, + ( ) -'),
        email: z.string().email('Format email tidak valid').max(120).optional().or(z.literal('')),
        address: z.string().trim().min(5).max(300, 'Maksimal 300 karakter'),
        lat: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().min(-90).max(90).optional()),
        lng: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().min(-180).max(180).optional()),
        packageName: z.string().min(1),
        areaId: z.string().min(1).optional(),
        warehouseId: z.string().min(1).optional(), // lama (API billing): langsung gudang
        notes: optNote,
      })
      .parse(input);
    if (!i.areaId && !i.warehouseId) throw fieldError('areaId', 'Pilih area');
    const area = i.areaId ? await tx.area.findFirst({ where: { id: i.areaId, active: true } }) : null;
    if (i.areaId && !area) throw fieldError('areaId', 'Area tidak ditemukan / nonaktif');
    if (area && !area.warehouseId) throw fieldError('areaId', `Area "${area.name}" belum dihubungkan ke gudang (Master Data → Area)`);
    const wh = await tx.warehouse.findFirst({ where: { id: area?.warehouseId ?? i.warehouseId!, kind: { not: 'MOBILE' }, active: true } });
    if (!wh) throw new AppError(400, 'Gudang tidak valid');
    if (!(await tx.package.findFirst({ where: { name: i.packageName, active: true } }))) throw new AppError(400, `Paket "${i.packageName}" tidak ada di Master Paket / sudah nonaktif`);
    const code = i.customerCode ?? (await nextNumber(tx, 'CUST'));
    if (i.customerCode && (await tx.customer.findUnique({ where: { code } }))) throw fieldError('customerCode', `Kode pelanggan ${code} sudah ada — cari di menu Pelanggan`, 409);
    const customer = await tx.customer.create({
      data: { code: code, name: i.name, phone: i.phone, email: i.email || null, address: i.address, lat: i.lat, lng: i.lng, packageName: i.packageName, warehouseId: wh.id, areaId: area?.id ?? null },
    });
    return { title: `Pasang baru – ${i.name}`, customerId: customer.id, data: { packageName: i.packageName, notes: i.notes } };
  },
  statuses: {
    FOC_VALIDATION: {
      label: 'Validasi Teknis (FOC)',
      owner: 'FOC',
      actions: [
        {
          key: 'validate',
          label: 'Validasi OK → catat ODP / port / POP',
          roles: ['FOC'],
          leadOnly: true,
          to: 'STOCK_CHECK',
          fields: [
            { name: 'odp', label: 'ODP / Node', type: 'text', required: true, help: 'Maks. 40 karakter. Teknisi boleh mengoreksi ODP/port aktual saat instalasi' },
            { name: 'port', label: 'Port ODP', type: 'text', required: true, help: 'Maks. 20 karakter' },
            { name: 'pop', label: 'POP', type: 'text', required: true, help: 'POP yang melayani lokasi pelanggan' },
            note(),
          ],
          run: async (ctx, input) => {
            const i = z.object({ odp: odpName.pipe(z.string()), port: portName.pipe(z.string()), pop: optText.pipe(z.string()), note: optNote }).parse(input);
            await assertNetworkFree(ctx.tx, { odp: i.odp, port: i.port }, ctx.wo.customerId!);
            await setCustomer(ctx, { odp: i.odp, port: i.port, pop: i.pop });
            ctx.data.validation = { odp: i.odp, port: i.port, pop: i.pop };
          },
        },
        { key: 'reject', label: 'Tolak (tidak ada coverage/port)', roles: ['FOC'], leadOnly: true, to: 'REJECTED', danger: true, fields: [note(true)] },
      ],
    },
    STOCK_CHECK: {
      label: 'Cek Stok (otomatis)',
      owner: 'GA',
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
      label: 'Menunggu Stok (GA/Procurement)',
      owner: 'GA',
      actions: [
        { key: 'recheck', label: 'Cek ulang stok', roles: ['GA'], to: 'STOCK_CHECK', fields: [] },
        { key: 'force_ready', label: 'Lanjutkan tanpa cek (override)', roles: ['GA'], to: 'READY_TO_SCHEDULE', fields: [note(true)] },
      ],
    },
    READY_TO_SCHEDULE: { label: 'Siap Dijadwalkan (FOC)', owner: 'FOC', actions: [scheduleAction('schedule', 'Jadwalkan teknisi', 'SCHEDULED')] },
    SCHEDULED: {
      label: 'Terjadwal (FOC)',
      owner: 'FOC',
      actions: [scheduleAction('reschedule', 'Jadwalkan ulang / ganti tim', 'SCHEDULED'), startAction('IN_PROGRESS', true)],
    },
    IN_PROGRESS: {
      label: 'Instalasi Berjalan (FOC)',
      owner: 'FOC',
      actions: [
        changeTeamAction('IN_PROGRESS'),
        {
          key: 'submit_report',
          label: 'Kirim laporan instalasi',
          roles: ['FOC'],
          assigneeOnly: true,
          to: 'PHYSICAL_DONE',
          fields: [
            { name: 'serials', label: 'Scan SN ONT / Router terpasang', type: 'serials', required: true },
            { name: 'materials', label: 'Material terpakai (kabel dalam meter, fast connector, sleeve, dll)', type: 'materials', required: true, pickedOnly: true, help: 'Hanya material yang diambil saat "Mulai & ambil material". Sisa otomatis tetap di Stok Berjalan Anda.' },
            ...techFields({ redamanRequired: true }),
            photosF,
            note(),
          ],
          run: async (ctx, input) => {
            const i = z
              .object({ serials: sn.pipe(z.array(z.string()).min(1, 'Scan minimal 1 SN perangkat')), cableMeters: z.coerce.number().int().min(0).default(0), materials, ...techZ, opmDbm: z.coerce.number().min(-40).max(0), photos: z.array(z.string()).min(1, 'Minimal 1 foto'), note: optNote })
              .parse(input);
            const tech = await applyTech(ctx, i);
            const mob = await consume(ctx, i.cableMeters, i.materials, { pickedOnly: true });
            await installSerials(ctx, i.serials, mob.id);
            const pk = ((ctx.wo.data as any)?.pickup?.serials ?? []) as string[];
            if (ctx.data.reconciliation) (ctx.data.reconciliation as any).serials = { picked: pk, installed: i.serials, leftover: pk.filter((x) => !i.serials.includes(x)) };
            ctx.data.report = { ...i, ...tech, team: await teamNames(ctx, ctx.wo.teamIds), submittedBy: ctx.actor.name, at: new Date() };
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
            { name: 'vlan', label: 'VLAN', type: 'text', required: true, help: 'Angka 1–4094' },
            { name: 'ip', label: 'IP internal / Subnet', type: 'text', required: true, help: 'Wajib IP privat RFC 1918 (10.x.x.x, 172.16–31.x.x, 192.168.x.x), mis. 10.20.30.40 atau 10.20.30.0/30. Terisi dari MSRadius bila ada' },
            { name: 'publicIp', label: 'IP Publik (opsional)', type: 'text', help: 'Hanya bila pelanggan memakai IP publik; dicek duplikat hanya jika diisi' },
            { name: 'pingMs', label: 'Ping / Latency (ms)', type: 'number', required: true },
            { name: 'jitterMs', label: 'Jitter (ms) — opsional', type: 'number' },
            { name: 'downMbps', label: 'Speedtest download (Mbps)', type: 'number', required: true },
            { name: 'upMbps', label: 'Speedtest upload (Mbps)', type: 'number', required: true },
            { name: 'stable', label: 'Stability check lulus', type: 'bool', required: true },
            { name: 'photos', label: 'Bukti hasil speedtest (tangkapan layar / foto)', type: 'photos', plain: true, help: 'Dilampirkan pada Berita Acara (BAA). Boleh lebih dari satu gambar.' },
            note(),
          ],
          run: async (ctx, input) => {
            const i = z
              .object({
                ontAuthorized: yes('ONT/Router harus sudah di-authorize'),
                profile: z.string().min(1),
                vlan: vlanId.pipe(z.string()),
                ip: internalIp.pipe(z.string()),
                publicIp,
                pingMs: z.coerce.number().min(0),
                jitterMs: optNum(0, 100000),
                downMbps: z.coerce.number().min(0),
                upMbps: z.coerce.number().min(0),
                stable: yes('Stability check harus lulus'),
                photos: z.array(z.string()).max(10, 'Maksimal 10 gambar').default([]),
                note: optNote,
              })
              .parse(input);
            const c = ctx.wo.customer!;
            await assertNetworkFree(ctx.tx, { ip: i.ip, publicIp: i.publicIp }, c.id);
            await setCustomer(ctx, { status: 'ACTIVE', activatedAt: new Date(), vlan: i.vlan, ip: i.ip, publicIp: i.publicIp ?? null });
            ctx.data.activation = { ...i, at: new Date() };
            // Finance tidak terhubung langsung ke billing: hanya pengingat (Telegram + email) agar invoice segera disiapkan.
            await ctx.fx.notify({
              roles: ['FIN'],
              woId: ctx.wo.id,
              subject: `🔔 [${ctx.wo.number}] Pelanggan sudah AKTIF – segera siapkan invoice`,
              body: `Pelanggan ${c.name} (${c.code}) telah selesai diaktivasi NOC.\nPaket: ${c.packageName}\nTanggal aktif: ${new Date().toLocaleDateString('id-ID')}\n\nMohon segera siapkan invoice di sistem billing.\n${link(ctx)}`,
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
            const baNo = baNumber(await aliasForArea(ctx.tx, c.areaId), ctx.wo.number);
            const to = i.recipientEmail || c.email;
            if (to)
              await ctx.fx.notify({
                emails: [to],
                woId: ctx.wo.id,
                subject: `Berita Acara Aktivasi Layanan ${baNo}`,
                body: `Yth. ${c.name},\n\nLayanan internet Anda telah aktif.\nNo. BA: ${baNo}\nPaket: ${c.packageName}\nAlamat: ${c.address}\n\nTerima kasih telah berlangganan.`,
              });
            ctx.data.ba = { number: baNo, sentTo: to ?? null, at: new Date() };
            await ctx.fx.notify({
              roles: ['FIN'],
              woId: ctx.wo.id,
              subject: `🔔 [${ctx.wo.number}] BA terkirim – pastikan invoice ${c.name} sudah disiapkan`,
              body: `BA ${baNo} sudah dikirim ke pelanggan ${c.name} (${c.code}), paket ${c.packageName}.\nPengingat: mulai cycle penagihan dan pastikan invoice pertama sudah disiapkan di sistem billing.\n${link(ctx)}`,
            });
          },
        },
      ],
    },
    CLOSED: { label: 'Selesai', owner: 'MKT', final: true, actions: [] },
    REJECTED: { label: 'Ditolak (validasi teknis)', owner: 'MKT', final: true, actions: [] },
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
    FIELD_SCHEDULED: { label: 'Perbaikan Terjadwal (FOC)', owner: 'FOC', actions: [scheduleAction('reschedule', 'Jadwalkan ulang / ganti tim', 'FIELD_SCHEDULED'), startAction('FIELD_IN_PROGRESS', false)] },
    FIELD_IN_PROGRESS: {
      label: 'Perbaikan Berjalan (FOC)',
      owner: 'FOC',
      actions: [
        changeTeamAction('FIELD_IN_PROGRESS'),
        {
          key: 'submit_report',
          label: 'Kirim laporan perbaikan',
          roles: ['FOC'],
          assigneeOnly: true,
          to: 'NOC_VERIFY',
          fields: [
            { name: 'serialsNew', label: 'SN perangkat BARU terpasang', type: 'serials' },
            { name: 'serialsOld', label: 'SN perangkat LAMA yang diambil', type: 'serials' },
            { name: 'materials', label: 'Material terpakai (kabel dalam meter, dll)', type: 'materials', help: 'Diambil dari Stok Berjalan Anda; kabel yang belum diambil/diminta tidak bisa dipakai.' },
            ...techFields(),
            photosF,
            { name: 'note', label: 'Langkah-langkah troubleshooting yang dilakukan', type: 'textarea', required: true, help: 'Isi urut: temuan, tindakan, hasil. Tercetak di Laporan Troubleshooting.' },
          ],
          run: async (ctx, input) => {
            const i = z
              .object({ serialsNew: sn.default([]), serialsOld: sn.default([]), cableMeters: z.coerce.number().int().min(0).default(0), materials, ...techZ, opmDbm: optNum(-40, 0), photos: z.array(z.string()).min(1, 'Minimal 1 foto'), note: z.string().min(2, 'Isi langkah-langkah troubleshooting') })
              .parse(input);
            const tech = await applyTech(ctx, i);
            const mob = await consume(ctx, i.cableMeters, i.materials);
            await installSerials(ctx, i.serialsNew, mob.id);
            for (const s of i.serialsOld) {
              const a = await mustAsset(ctx.tx, s);
              if (a.customerId !== ctx.wo.customerId || a.status !== 'INSTALLED') throw new AppError(409, `SN lama ${a.serialNumber} tidak tercatat terpasang di pelanggan ini`);
              await moveAsset(ctx.tx, a, { status: 'RETURNED_PENDING_QC', toWarehouseId: mob.id, reason: `Diganti – ${ctx.wo.number}`, woId: ctx.wo.id, actorId: ctx.actor.id });
            }
            ctx.data.report = { ...i, ...tech, team: await teamNames(ctx, ctx.wo.teamIds), submittedBy: ctx.actor.name, at: new Date() };
          },
        },
      ],
    },
    NOC_VERIFY: {
      label: 'Verifikasi Koneksi (NOC)',
      owner: 'NOC',
      actions: [
        { key: 'verify_up', label: 'Koneksi UP / normal', roles: ['NOC'], to: 'MKT_CONFIRM', fields: [{ name: 'pingMs', label: 'Ping / Latency (ms)', type: 'number' }, note()] },
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
          },
        },
      ],
    },
    DISMANTLE_DISPATCH: { label: 'Penarikan Aset – Menunggu Jadwal (FOC)', owner: 'FOC', actions: [scheduleAction('schedule', 'Jadwalkan teknisi', 'DISMANTLE_SCHEDULED')] },
    DISMANTLE_SCHEDULED: { label: 'Penarikan Terjadwal (FOC)', owner: 'FOC', actions: [scheduleAction('reschedule', 'Jadwalkan ulang / ganti tim', 'DISMANTLE_SCHEDULED'), startAction('DISMANTLE_IN_PROGRESS', false)] },
    DISMANTLE_IN_PROGRESS: {
      label: 'Penarikan Berjalan (FOC)',
      owner: 'FOC',
      actions: [
        changeTeamAction('DISMANTLE_IN_PROGRESS'),
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
            const mob = await mobileWarehouse(ctx.tx, stockOwner(ctx));
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
          roles: ['GA'],
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
  description: 'FOC/NOC/GA meminta barang → GA/Procurement mutasi antar-gudang atau terbitkan PO → penerimaan & barcoding.',
  createRoles: ['FOC', 'NOC', 'GA'],
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
      label: 'Review GA/Procurement',
      owner: 'GA',
      actions: [
        {
          key: 'in_stock',
          label: 'Stok tersedia di gudang tujuan → selesai',
          roles: ['GA'],
          to: 'CLOSED',
          fields: [note()],
          run: async (ctx) => {
            const d = ctx.wo.data as any;
            const lines = d.lines as { itemId: string; qty: number }[];
            const items = await ctx.tx.item.findMany({ where: { id: { in: lines.map((l) => l.itemId) } } });
            const short: string[] = [];
            for (const l of lines) {
              const it = items.find((x) => x.id === l.itemId)!;
              const have = it.tracked
                ? await ctx.tx.asset.count({ where: { itemId: it.id, warehouseId: d.toWarehouseId, status: { in: AVAILABLE } } })
                : (await ctx.tx.stockLevel.findUnique({ where: { warehouseId_itemId: { warehouseId: d.toWarehouseId, itemId: it.id } } }))?.qty ?? 0;
              if (have < l.qty) short.push(`${it.name} (diminta ${l.qty}, tersedia ${have})`);
            }
            if (short.length) throw new AppError(409, `Stok di gudang tujuan belum cukup: ${short.join(', ')} — gunakan mutasi atau Purchase Request`);
            ctx.data.stockOk = { at: new Date(), by: ctx.actor.name };
          },
        },
        {
          key: 'transfer',
          label: 'Stok ada di gudang lain → mutasi',
          roles: ['GA'],
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
          key: 'create_pr',
          label: 'Stok habis → buat Purchase Request (draft)',
          roles: ['GA'],
          to: 'PO_ISSUED',
          fields: [note()],
          run: async (ctx, input) => {
            const i = z.object({ note: optNote }).parse(input);
            const d = ctx.wo.data as any;
            const lines = d.lines as { itemId: string; qty: number }[];
            const items = await ctx.tx.item.findMany({ where: { id: { in: lines.map((l) => l.itemId) } } });
            const pr = await ctx.tx.purchaseRequest.create({
              data: {
                subject: `Pengadaan stok – ${ctx.wo.number}`,
                note: i.note ?? d.reason ?? null,
                woId: ctx.wo.id,
                createdById: ctx.actor.id,
                taxPct: ((await ctx.tx.setting.findUnique({ where: { key: 'docs' } }))?.value as any)?.taxPct ?? 11,
                lines: { create: lines.map((l, k) => { const it = items.find((x) => x.id === l.itemId)!; return { sort: k, description: it.name, qty: l.qty, unit: it.unit, itemId: it.id }; }) },
              },
            });
            ctx.data.pr = pr.id;
          },
        },
      ],
    },
    AWAITING_RECEIPT: {
      label: 'Barang Dikirim – Menunggu Penerimaan',
      owner: 'GA',
      actions: [{ key: 'receive', label: 'Barang diterima', roles: ['FOC', 'NOC', 'GA'], to: 'CLOSED', fields: [note()] }],
    },
    PO_ISSUED: {
      label: 'PR/PO Berjalan – Menunggu Barang (GA/Procurement)',
      owner: 'GA',
      actions: [
        { key: 'po_received', label: 'PO diterima', roles: [], system: true, to: 'CLOSED', fields: [] },
        { key: 'back_review', label: 'PR ditolak/dibatalkan → kembali ke review', roles: ['GA'], to: 'PROC_REVIEW', fields: [note(true)] },
      ],
    },
    CLOSED: { label: 'Selesai', owner: 'GA', final: true, actions: [] },
  },
};


/* ───────────────────────── MAINTENANCE / TROUBLESHOOT MANDIRI ───────────────────────── */

const MAINT_CATEGORIES = ['Kabel putus / tertabrak', 'Maintenance rutin (UPS, perangkat, dll)', 'Pemotongan / pembersihan pohon', 'Relokasi / perapian jalur', 'Lainnya'];

const maintenance: Workflow = {
  type: 'MAINTENANCE',
  prefix: 'WO-MT',
  label: 'Maintenance / Troubleshoot',
  description: 'Kegiatan perbaikan/perawatan jaringan di luar tiket pelanggan (kabel tertabrak, maintenance rutin, pemotongan pohon, dll). Supervisor/manager FOC menugaskan tim → mulai → progres → laporan troubleshooting.',
  createRoles: ['FOC'],
  createFields: [
    { name: 'title', label: 'Kegiatan', type: 'text', required: true, help: 'Mis. "Kabel FO tertabrak truk di Jl. Merdeka"' },
    { name: 'category', label: 'Kategori', type: 'select', required: true, options: MAINT_CATEGORIES },
    { name: 'areaId', label: 'Area', type: 'area', required: true, help: 'Menentukan singkatan area pada nomor laporan' },
    { name: 'location', label: 'Lokasi kegiatan', type: 'text', required: true },
    { name: 'description', label: 'Uraian / penyebab', type: 'textarea', required: true },
    technicianIdsF,
    scheduledF,
  ],
  initial: 'SCHEDULED',
  initialFor: () => 'SCHEDULED',
  async create(tx, input, actor) {
    if (!isLead(actor)) throw new AppError(403, 'Maintenance mandiri hanya dibuat oleh supervisor/manager FOC');
    const i = z
      .object({ title: z.string().trim().min(3).max(150), category: z.enum(MAINT_CATEGORIES as [string, ...string[]]), areaId: z.string().min(1), location: z.string().trim().min(2).max(200), description: z.string().trim().min(3).max(1000), technicianIds: z.array(z.string()).optional(), technicianId: z.string().optional(), scheduledAt: z.coerce.date() })
      .parse(input);
    if (!(await tx.area.findFirst({ where: { id: i.areaId, active: true } }))) throw fieldError('areaId', 'Area tidak ditemukan / nonaktif');
    const team = await resolveTeam({ tx, actor }, i);
    return {
      title: `Maintenance – ${i.title}`,
      data: { category: i.category, areaId: i.areaId, location: i.location, description: i.description, team: team.map((t) => t.name) },
      assigneeId: team[0].id,
      teamIds: team.map((t) => t.id),
      scheduledAt: i.scheduledAt,
      note: i.description,
    };
  },
  statuses: {
    SCHEDULED: {
      label: 'Terjadwal (FOC)',
      owner: 'FOC',
      actions: [scheduleAction('reschedule', 'Jadwalkan ulang / ganti tim', 'SCHEDULED'), startAction('IN_PROGRESS', false)],
    },
    IN_PROGRESS: {
      label: 'Pekerjaan Berjalan (FOC)',
      owner: 'FOC',
      actions: [
        changeTeamAction('IN_PROGRESS'),
        {
          key: 'submit_report',
          label: 'Kirim laporan troubleshooting',
          roles: ['FOC'],
          assigneeOnly: true,
          to: 'CLOSED',
          fields: [
            { name: 'materials', label: 'Material terpakai (dari Stok Berjalan Anda)', type: 'materials', help: 'Hanya yang ada di Stok Berjalan Anda; ajukan permintaan barang bila belum ada.' },
            ...techFields().filter((f) => !['odp', 'port'].includes(f.name)),
            { name: 'odp', label: 'ODP (bila relevan)', type: 'text' },
            photosF,
            { name: 'note', label: 'Langkah-langkah troubleshooting yang dilakukan', type: 'textarea', required: true, help: 'Isi urut: temuan, tindakan, hasil. Tercetak di Laporan Troubleshooting.' },
          ],
          run: async (ctx, input) => {
            const i = z.object({ cableMeters: z.coerce.number().int().min(0).default(0), materials, odp: optText, pop: optText, mainSplitter: optText, lat: optNum(-90, 90), lng: optNum(-180, 180), signalDbm: optNum(-60, 20), opmDbm: optNum(-40, 0), photos: z.array(z.string()).min(1, 'Minimal 1 foto'), note: z.string().min(2, 'Isi langkah-langkah troubleshooting') }).parse(input);
            await consume(ctx, i.cableMeters, i.materials);
            ctx.data.report = { ...i, team: await teamNames(ctx, ctx.wo.teamIds), submittedBy: ctx.actor.name, at: new Date() };
          },
        },
      ],
    },
    CLOSED: { label: 'Selesai', owner: 'FOC', final: true, actions: [] },
  },
};

/* ───────────────────────── SERAH-TERIMA SISA MATERIAL (STOCK_RETURN) ───────────────────────── */

/** Selisih (diajukan − diterima) untuk material & SN. */
function outstandingOf(d: any) {
  const recvQty = new Map<string, number>();
  for (const r of (d.received?.items ?? []) as { itemId: string; qty: number }[]) recvQty.set(r.itemId, (recvQty.get(r.itemId) ?? 0) + r.qty);
  const items = ((d.items ?? []) as { itemId: string; qty: number }[]).map((l) => ({ itemId: l.itemId, qty: l.qty - (recvQty.get(l.itemId) ?? 0) })).filter((l) => l.qty > 0);
  const gotSn = new Set((d.received?.serials ?? []) as string[]);
  const serials = ((d.serials ?? []) as string[]).filter((x) => !gotSn.has(x));
  return { items, serials };
}

const stockReturn: Workflow = {
  type: 'STOCK_RETURN',
  prefix: 'WO-RT',
  label: 'Serah-terima Sisa Material',
  description: 'Teknisi mengembalikan sisa material/perangkat → GA menerima di gudang. Selama belum diterima, barang tetap atas nama teknisi (Stok Berjalan).',
  createRoles: ['FOC'],
  createFields: [
    { name: 'toWarehouseId', label: 'Dikembalikan ke gudang', type: 'warehouse', required: true },
    { name: 'items', label: 'Material habis pakai yang dikembalikan', type: 'materials' },
    { name: 'serials', label: 'SN perangkat yang dikembalikan', type: 'serials' },
    note(),
  ],
  initial: 'AWAITING_RECEIPT',
  async create(tx, input, actor) {
    const i = z.object({ toWarehouseId: z.string().min(1), items: materials, serials: sn.default([]), note: optNote }).parse(input);
    if (!i.items.length && !i.serials.length) throw fieldError('items', 'Isi minimal satu material atau SN yang dikembalikan');
    const wh = await tx.warehouse.findFirst({ where: { id: i.toWarehouseId, kind: { not: 'MOBILE' }, active: true } });
    if (!wh) throw new AppError(400, 'Gudang tujuan tidak valid');
    const mob = await mobileWarehouse(tx, actor.id);
    const need = new Map<string, number>();
    for (const l of i.items) need.set(l.itemId, (need.get(l.itemId) ?? 0) + l.qty);
    for (const [itemId, qty] of need) {
      const have = (await tx.stockLevel.findUnique({ where: { warehouseId_itemId: { warehouseId: mob.id, itemId } } }))?.qty ?? 0;
      if (qty > have) {
        const it = await tx.item.findUnique({ where: { id: itemId } });
        throw fieldError('items', `${it?.name ?? itemId}: di Stok Berjalan Anda hanya ada ${have}, diajukan ${qty}`, 409);
      }
    }
    for (const s of i.serials) {
      const a = await mustAsset(tx, s);
      if (a.warehouseId !== mob.id || !AVAILABLE.includes(a.status)) throw fieldError('serials', `SN ${a.serialNumber} tidak ada di Stok Berjalan Anda`, 409);
    }
    const items = [...need].map(([itemId, qty]) => ({ itemId, qty }));
    return { title: `Serah-terima sisa material → ${wh.name}`, data: { toWarehouseId: wh.id, techId: actor.id, items, serials: i.serials, note: i.note }, note: i.note };
  },
  statuses: {
    AWAITING_RECEIPT: {
      label: 'Menunggu Penerimaan GA',
      owner: 'GA',
      actions: [
        {
          key: 'receive_all',
          label: 'Terima semua sesuai daftar',
          roles: ['GA'],
          to: 'CLOSED',
          fields: [note()],
          run: async (ctx) => {
            const o = outstandingOf(ctx.wo.data);
            await receiveReturn(ctx, o.items, o.serials);
          },
        },
        {
          key: 'receive_partial',
          label: 'Terima sebagian (sisanya tetap atas nama teknisi)',
          roles: ['GA'],
          to: 'AWAITING_RECEIPT',
          fields: [
            { name: 'items', label: 'Material yang diterima', type: 'materials' },
            { name: 'serials', label: 'SN yang diterima', type: 'serials' },
            note(true),
          ],
          run: async (ctx, input) => {
            const i = z.object({ items: materials, serials: sn.default([]), note: z.string().min(2, 'Isi catatan (mengapa sebagian)') }).parse(input);
            if (!i.items.length && !i.serials.length) throw fieldError('items', 'Isi material atau SN yang diterima');
            const o = outstandingOf(ctx.wo.data);
            for (const l of i.items) {
              const left = o.items.find((x) => x.itemId === l.itemId)?.qty ?? 0;
              if (l.qty > left) throw fieldError('items', `Melebihi sisa yang belum diterima (${left})`, 400);
            }
            for (const s of i.serials) if (!o.serials.includes(s)) throw fieldError('serials', `SN ${s} tidak ada dalam daftar / sudah diterima`, 400);
            await receiveReturn(ctx, i.items, i.serials);
            const d2 = { ...(ctx.wo.data as any), received: ctx.data.received };
            const left = outstandingOf(d2);
            if (!left.items.length && !left.serials.length) return 'CLOSED';
          },
        },
        { key: 'reject', label: 'Tolak (tidak diterima)', roles: ['GA'], to: 'REJECTED', danger: true, fields: [note(true)] },
      ],
    },
    CLOSED: { label: 'Selesai – Diterima Gudang', owner: 'GA', final: true, actions: [] },
    REJECTED: { label: 'Ditolak – Tetap di Stok Berjalan Teknisi', owner: 'GA', final: true, actions: [] },
  },
};

/** Pindahkan barang yang benar-benar diterima dari Stok Berjalan teknisi ke gudang tujuan; catat akumulasi di data WO. */
async function receiveReturn(ctx: Ctx, items: { itemId: string; qty: number }[], serials: string[]) {
  const d = ctx.wo.data as any;
  const mob = await mobileWarehouse(ctx.tx, d.techId);
  for (const l of items) await moveStock(ctx.tx, { itemId: l.itemId, qty: l.qty, from: mob.id, to: d.toWarehouseId, reason: `Serah-terima ${ctx.wo.number}`, woId: ctx.wo.id, actorId: ctx.actor.id });
  for (const x of serials) {
    const a = await mustAsset(ctx.tx, x);
    if (a.warehouseId !== mob.id) throw new AppError(409, `SN ${a.serialNumber} sudah tidak di Stok Berjalan teknisi`);
    await moveAsset(ctx.tx, a, { status: 'IN_STOCK', toWarehouseId: d.toWarehouseId, reason: `Serah-terima ${ctx.wo.number}`, woId: ctx.wo.id, actorId: ctx.actor.id });
  }
  ctx.data.received = { items: [...(d.received?.items ?? []), ...items], serials: [...(d.received?.serials ?? []), ...serials], at: new Date() };
}

export const workflows: Record<WoType, Workflow> = {
  NEW_INSTALL: newInstall,
  TROUBLE: trouble,
  SUSPEND: suspend,
  UNSUSPEND: unsuspend,
  TERMINATE: terminate,
  STOCK_REQUEST: stockRequest,
  STOCK_RETURN: stockReturn,
  MAINTENANCE: maintenance,
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
