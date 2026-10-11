import { prisma } from './db';
import { connection } from './queue';
import { decryptSecret, encryptSecret, getSetting, getSubForm, putSetting, webUrl } from './settings';
import { transact } from './effects';
import { writeAudit } from './audit';
import { issueRegNo } from './subscriptions';

/**
 * Integrasi MSRadius — BACA-SAJA. Sistem ini tidak pernah menulis ke MSRadius.
 * Sumber data pelanggan: GET databilling/data (semua pelanggan dalam 1 panggilan); paket: GET databilling/profile.
 * Batas MSRadius: 10 request/60 dtk per token → satu putaran sinkron hanya memakai 2 request dengan jeda ≥ 7 dtk.
 */

export interface RadiusCfg { baseUrl: string; token: string; enabled: boolean; intervalMin: number; lastAutoAt: number | null; autoForm: boolean }
export const RADIUS_DEFAULT_URL = 'http://radius.liv.net.id/api/radius';

export async function getRadius(): Promise<RadiusCfg> {
  const s = (await getSetting<any>('radius')) ?? {};
  return {
    baseUrl: (typeof s.baseUrl === 'string' && s.baseUrl.trim() ? s.baseUrl.trim() : RADIUS_DEFAULT_URL).replace(/\/+$/, ''),
    token: decryptSecret(s.token),
    enabled: s.enabled !== false, // bawaan: otomatis aktif begitu token diisi
    intervalMin: Number.isInteger(Number(s.intervalMin)) && Number(s.intervalMin) >= 5 ? Number(s.intervalMin) : 60,
    lastAutoAt: typeof s.lastAutoAt === 'number' ? s.lastAutoAt : null,
    autoForm: s.autoForm !== false, // bawaan: pelanggan Waiting → Formulir Berlangganan dibuat otomatis
  };
}

export async function saveRadius(p: { baseUrl: string; token?: string; enabled: boolean; intervalMin: number; autoForm?: boolean }, userId: string) {
  const cur = (await getSetting<any>('radius')) ?? {};
  await putSetting('radius', { ...cur, baseUrl: p.baseUrl, enabled: p.enabled, intervalMin: p.intervalMin, ...(p.autoForm === undefined ? {} : { autoForm: p.autoForm }), ...(p.token ? { token: encryptSecret(p.token) } : {}) }, userId);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Satu panggilan GET ke MSRadius. Galat dicek dari `code` di body (bukan hanya status HTTP). */
export async function radiusGet<T = any>(cfg: RadiusCfg, path: string, params?: Record<string, string>): Promise<{ count?: number; data: T }> {
  if (!cfg.token) throw new Error('Token MSRadius belum diisi (Admin → Pengaturan → MSRadius)');
  const url = new URL(`${cfg.baseUrl}/${path}`);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'X-TOKEN': cfg.token, accept: 'application/json' }, signal: AbortSignal.timeout(90_000) });
  } catch (e) {
    throw new Error(`Tidak dapat menghubungi MSRadius (${cfg.baseUrl}): ${(e as Error).message}`);
  }
  const body: any = await res.json().catch(() => null);
  if (!body) throw new Error(`Respons MSRadius bukan JSON (HTTP ${res.status})`);
  if (Number(body.code) !== 200) throw new Error(`MSRadius: ${body.msg ?? body.title ?? 'galat'} (code ${body.code})`);
  return { count: body.count, data: body.data as T };
}

export async function testRadius() {
  const cfg = await getRadius();
  const r = await radiusGet<Record<string, string>>(cfg, 'masterdata/users/list');
  return { ok: true, users: Object.keys(r.data ?? {}).length };
}

/* ── pemetaan data ── */
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const coord = (v: unknown, lim: number) => { const n = parseFloat(str(v)); return Number.isFinite(n) && Math.abs(n) <= lim && n !== 0 ? n : null; };
/** Garis bawah dianggap spasi (nama akun MSRadius tidak boleh berspasi); bila hasilnya semua huruf besar/kecil → Title Case. */
export const tidyName = (n: string) => {
  const t = n.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  return t === t.toUpperCase() || t === t.toLowerCase() ? t.toLowerCase().replace(/(^|[\s.'-])\p{L}/gu, (c) => c.toUpperCase()) : t;
};
function dateOf(v: unknown): Date | null {
  const s = str(v);
  if (!s || /^(not set|-|0)$/i.test(s)) return null;
  if (/^\d{10}$/.test(s)) return new Date(Number(s) * 1000);
  if (/^\d{13}$/.test(s)) return new Date(Number(s));
  const d = new Date(s.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}
const registered = (notes: unknown) => { const m = /(\d{4}-\d{2}-\d{2})/.exec(str(notes)); return m ? new Date(`${m[1]}T00:00:00+07:00`) : null; };

/** Status layanan dari MSRadius (databilling/data → status). */
export type RadiusStatus = 'WAITING' | 'ONLINE' | 'OFFLINE' | 'ISOLIR' | 'DISABLE';
export const RADIUS_STATUS_INFO: Record<RadiusStatus, { label: string; desc: string }> = {
  WAITING: { label: 'Waiting', desc: 'Pelanggan baru — memicu Form Berlangganan' },
  ONLINE: { label: 'Online', desc: 'Layanan aktif & internet berjalan' },
  OFFLINE: { label: 'Offline', desc: 'Masalah internet di sisi pelanggan (mungkin dimatikan/terputus)' },
  ISOLIR: { label: 'Isolir', desc: 'Layanan ditangguhkan (suspend)' },
  DISABLE: { label: 'Disable', desc: 'Pelanggan di-terminate' },
};
/** Normalisasi nilai `status` MSRadius (toleran huruf besar/kecil & sinonim). Tidak dikenal → null. */
export function normStatus(v: unknown): RadiusStatus | null {
  const t = str(typeof v === 'object' && v !== null ? ((v as any).name ?? (v as any).status ?? (v as any).label ?? '') : v).toLowerCase();
  if (!t) return null;
  if (/wait|pending|baru|new/.test(t)) return 'WAITING';
  if (/^on/.test(t) || t === 'active' || t === 'aktif') return 'ONLINE';
  if (/^off/.test(t)) return 'OFFLINE';
  if (/isolir|isolat|suspend/.test(t)) return 'ISOLIR';
  if (/disable|nonaktif|non-aktif|terminate|inactive/.test(t)) return 'DISABLE';
  return null;
}
/** Area pelanggan dari MSRadius: bisa teks nama, id, atau objek {id,name}. */
export function areaRefOf(r: any): { code: string | null; name: string | null } | null {
  const v = r?.area ?? r?.area_name ?? r?.nama_area ?? r?.id_area ?? r?.area_id;
  if (v === null || v === undefined || v === '' || v === '-') return null;
  if (typeof v === 'object') { const code = str((v as any).id ?? (v as any).id_area ?? (v as any).code), name = str((v as any).name ?? (v as any).nama ?? (v as any).area); return code || name ? { code: code || null, name: name || null } : null; }
  const t = str(v);
  return /^\d+$/.test(t) ? { code: t, name: null } : { code: null, name: t };
}
/** Status Maung yang setara dengan status MSRadius (null = tidak mengubah). */
export const customerStatusFor = (st: RadiusStatus | null) => (st === 'WAITING' ? 'PROSPECT' : st === 'ONLINE' || st === 'OFFLINE' ? 'ACTIVE' : st === 'ISOLIR' ? 'SUSPENDED' : st === 'DISABLE' ? 'TERMINATED' : null) as 'PROSPECT' | 'ACTIVE' | 'SUSPENDED' | 'TERMINATED' | null;

export interface Mapped { code: string; name: string; phone: string; address: string; lat: number | null; lng: number | null; packageName: string; radiusName: string; radiusIp: string | null; expiredAt: Date | null; resellerName: string | null; salesName: string | null; suspended: boolean; registeredAt: Date | null; radiusStatus: RadiusStatus | null; areaRef: { code: string | null; name: string | null } | null }

export function mapRow(r: any, _pretty?: boolean): Mapped | null {
  const code = str(r?.kode);
  if (!code) return null;
  const raw = str(r.name);
  const phone = str(r.whatsapp).replace(/[^0-9+]/g, '');
  const addr = str(r.address);
  return {
    code,
    name: tidyName(raw) || code,
    phone: phone.length >= 6 ? phone : '-',
    address: addr && addr !== '-' ? addr : '-',
    lat: coord(r.lat, 90), lng: coord(r.lng, 180),
    packageName: str(r.profile_name) || 'Tidak diketahui',
    radiusName: raw,
    radiusIp: str(r.ip_address_set) || null,
    expiredAt: dateOf(r.expired_at),
    resellerName: str(r.name_mitra) || null,
    salesName: str(r.name_kurir) || null,
    suspended: ['1', 'true'].includes(str(r.disabled_username).toLowerCase()),
    registeredAt: registered(r.notess),
    radiusStatus: normStatus(r.status),
    areaRef: areaRefOf(r),
  };
}

const rowsOf = (d: any): any[] => (Array.isArray(d) ? d : d && typeof d === 'object' ? Object.values(d) : []);

export interface SyncStats { forms?: number; created: number; updated: number; unchanged: number; skipped: number; missing: number; packages: number; areas: number }

/** Terapkan baris MSRadius ke tabel Customer (upsert by `kode`); kolom milik Maung (email, ODP, port, VLAN, IP internal, gudang) tidak disentuh. */
export async function applyCustomers(rows: any[], pretty: boolean, opts: { onlyCode?: string; syncRunId?: string } = {}): Promise<SyncStats> {
  const st: SyncStats = { created: 0, updated: 0, unchanged: 0, skipped: 0, missing: 0, packages: 0, areas: 0 };
  const mapped: Mapped[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const m = mapRow(r, pretty);
    if (!m) { st.skipped++; continue; }
    if (opts.onlyCode && m.code !== opts.onlyCode) continue;
    if (seen.has(m.code)) { st.skipped++; continue; }
    seen.add(m.code);
    mapped.push(m);
  }
  const busy = new Set((await prisma.workOrder.findMany({ where: { closedAt: null, customerId: { not: null } }, select: { customerId: true } })).map((w) => w.customerId!));
  const existing = new Map((await prisma.customer.findMany({ where: opts.onlyCode ? { code: opts.onlyCode } : {}, select: { id: true, code: true, name: true, phone: true, address: true, lat: true, lng: true, packageName: true, radiusIp: true, expiredAt: true, resellerName: true, salesName: true, status: true, source: true, missingFromApi: true, activatedAt: true, radiusStatus: true, areaId: true, warehouseId: true } })).map((c) => [c.code, c]));
  // Area: nama/kode dari MSRadius → Master Area (area sudah disinkron lebih dulu dari masterdata/area/list)
  const areaRows = await prisma.area.findMany();
  const areaByCode = new Map(areaRows.filter((a) => a.code).map((a) => [a.code!, a]));
  const areaByName = new Map(areaRows.map((a) => [a.name.toLowerCase(), a]));
  const areaOf = (m: Mapped) => (m.areaRef ? (m.areaRef.code && areaByCode.get(m.areaRef.code)) || (m.areaRef.name && areaByName.get(m.areaRef.name.toLowerCase())) || null : null);
  const now = new Date();
  const CH = 200;
  for (let i = 0; i < mapped.length; i += CH) {
    await prisma.$transaction(async (tx) => {
      for (const m of mapped.slice(i, i + CH)) {
        const cur = existing.get(m.code);
        const area = areaOf(m);
        if (!cur) {
          const made = await tx.customer.create({ data: { code: m.code, name: m.name, phone: m.phone, address: m.address, lat: m.lat, lng: m.lng, packageName: m.packageName, status: customerStatusFor(m.radiusStatus) ?? (m.suspended ? 'SUSPENDED' : 'ACTIVE'), radiusStatus: m.radiusStatus, areaId: area?.id ?? null, warehouseId: area?.warehouseId ?? null, source: 'RADIUS', radiusName: m.radiusName, radiusIp: m.radiusIp, expiredAt: m.expiredAt, resellerName: m.resellerName, salesName: m.salesName, activatedAt: m.registeredAt, syncedAt: now } });
          await tx.customerChange.create({ data: { customerId: made.id, field: '*', oldValue: null, newValue: 'Dibuat dari MSRadius', source: 'RADIUS', syncRunId: opts.syncRunId ?? null } });
          st.created++;
          continue;
        }
        const data: Record<string, unknown> = {};
        const set = (k: string, v: unknown, same: boolean) => { if (!same) data[k] = v; };
        set('name', m.name, cur.name === m.name);
        if (m.phone !== '-') set('phone', m.phone, cur.phone === m.phone);
        if (m.address !== '-') set('address', m.address, cur.address === m.address);
        set('packageName', m.packageName, cur.packageName === m.packageName);
        if (cur.lat == null && m.lat != null) data.lat = m.lat;
        if (cur.lng == null && m.lng != null) data.lng = m.lng;
        set('radiusIp', m.radiusIp, cur.radiusIp === m.radiusIp);
        set('expiredAt', m.expiredAt, (cur.expiredAt?.getTime() ?? null) === (m.expiredAt?.getTime() ?? null));
        set('resellerName', m.resellerName, cur.resellerName === m.resellerName);
        set('salesName', m.salesName, cur.salesName === m.salesName);
        if (cur.source !== 'RADIUS') data.source = 'RADIUS';
        if (cur.missingFromApi) data.missingFromApi = false;
        if (!cur.activatedAt && m.registeredAt) data.activatedAt = m.registeredAt;
        // status layanan MSRadius (Waiting/Online/Offline/Isolir/Disable) — disimpan apa adanya + dipetakan ke status Maung
        if (m.radiusStatus && cur.radiusStatus !== m.radiusStatus) data.radiusStatus = m.radiusStatus;
        const isBusy = busy.has(cur.id); // ada WO berjalan → status pelanggan dikelola alur WO, tidak ditimpa
        const target = customerStatusFor(m.radiusStatus);
        if (target) {
          const allowed = isBusy || target === 'PROSPECT' ? false : target === 'ACTIVE' ? ['PROSPECT', 'ACTIVE', 'SUSPENDED'].includes(cur.status) : target === 'SUSPENDED' ? cur.status === 'ACTIVE' : ['ACTIVE', 'SUSPENDED'].includes(cur.status);
          if (allowed && cur.status !== target) data.status = target;
        } else if (!isBusy && (cur.status === 'ACTIVE' || cur.status === 'SUSPENDED')) {
          const want = m.suspended ? 'SUSPENDED' : 'ACTIVE'; // tanpa field status: pakai disabled_username
          if (cur.status !== want) data.status = want;
        }
        // area per pelanggan dari MSRadius (hanya bila terisi & dikenal di Master Area) → gudang penyuplai ikut diturunkan dari Area
        if (area && cur.areaId !== area.id) { data.areaId = area.id; if (!isBusy && area.warehouseId && cur.warehouseId !== area.warehouseId) data.warehouseId = area.warehouseId; }
        if (Object.keys(data).length) {
          await tx.customer.update({ where: { id: cur.id }, data: { ...data, syncedAt: now } as any });
          // riwayat: simpan nilai lama → baru untuk tiap kolom yang berubah (kecuali penanda teknis)
          const str2 = (v: unknown) => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));
          const rows2 = Object.keys(data).filter((k) => k !== 'source').map((k) => ({ customerId: cur.id, field: k, oldValue: str2((cur as any)[k]), newValue: str2(data[k]), source: 'RADIUS', syncRunId: opts.syncRunId ?? null }));
          if (rows2.length) await tx.customerChange.createMany({ data: rows2 });
          st.updated++;
        }
        else { st.unchanged++; }
      }
    }, { timeout: 120_000 });
  }
  st.forms = await createWaitingForms(); // pelanggan berstatus Waiting → Formulir Berlangganan otomatis

  if (!opts.onlyCode) {
    // tidak ada lagi di MSRadius → hanya ditandai (tidak dihapus).
    // Pengaman: respons kosong/terpotong (mis. gangguan di sisi MSRadius) tidak boleh menandai pelanggan massal.
    const totalRadius = await prisma.customer.count({ where: { source: 'RADIUS' } });
    if (seen.size === 0 || (totalRadius > 20 && seen.size < totalRadius * 0.5)) {
      console.warn(`[radius] daftar pelanggan MSRadius tampak tidak lengkap (${seen.size} dari ${totalRadius}) — penandaan "hilang" dilewati`);
      return st;
    }
    const codes = [...seen];
    const goneRows = await prisma.$queryRaw<{ id: string }[]>`UPDATE "Customer" SET "missingFromApi" = true WHERE "source" = 'RADIUS' AND "missingFromApi" = false AND NOT ("code" = ANY(${codes}::text[])) RETURNING "id"`;
    st.missing = goneRows.length;
    if (goneRows.length) await prisma.customerChange.createMany({ data: goneRows.map((g) => ({ customerId: g.id, field: 'missingFromApi', oldValue: 'false', newValue: 'true', source: 'RADIUS', syncRunId: opts.syncRunId ?? null })) });
  }
  return st;
}

/**
 * Pelanggan baru berstatus **Waiting** di MSRadius → Formulir Berlangganan dibuat otomatis (sumber RADIUS) agar Marketing dapat
 * melanjutkannya menjadi WO Pasang Baru. Idempoten: satu formulir per pelanggan; tidak dibuat bila pelanggan sudah punya
 * formulir atau pernah punya WO Pasang Baru. Dapat dimatikan di Admin → Pengaturan → MSRadius.
 */
export async function createWaitingForms(): Promise<number> {
  const cfg = await getRadius();
  if (!cfg.autoForm) return 0;
  const sys = await prisma.user.findUnique({ where: { email: 'system@l1v.local' } });
  if (!sys) return 0;
  const cands = await prisma.customer.findMany({ where: { source: 'RADIUS', radiusStatus: 'WAITING', archivedAt: null, status: 'PROSPECT' }, take: 300, orderBy: { createdAt: 'asc' } });
  if (!cands.length) return 0;
  const ids = cands.map((c) => c.id);
  const has = new Set([
    ...(await prisma.subscription.findMany({ where: { customerId: { in: ids } }, select: { customerId: true } })).map((x) => x.customerId!),
    ...(await prisma.workOrder.findMany({ where: { customerId: { in: ids }, type: 'NEW_INSTALL' }, select: { customerId: true } })).map((x) => x.customerId!),
  ]);
  const todo = cands.filter((c) => !has.has(c.id));
  if (!todo.length) return 0;
  const pkgs = new Map((await prisma.package.findMany({ where: { name: { in: [...new Set(todo.map((c) => c.packageName))] } } })).map((p) => [p.name, p]));
  const made: { regNo: string; name: string }[] = [];
  await transact(async (fx) => {
    for (const c of todo) {
      const date = new Date();
      const regNo = await issueRegNo(fx.tx, date);
      const pk = pkgs.get(c.packageName);
      const phone = /^[0-9+][0-9 +()-]*$/.test(c.phone) ? c.phone.slice(0, 20) : null;
      await fx.tx.subscription.create({ data: { regNo, formDate: date, name: c.name, address: c.address === '-' ? null : c.address, phone, packageName: c.packageName, monthlyFee: pk?.priceSell ?? null, marketingName: c.salesName ?? null, referral: 'MSRadius (status Waiting)', serviceNote: `Otomatis dari MSRadius — kode ${c.code}`, source: 'RADIUS', customerId: c.id, createdById: sys.id, managerName: (await getSubForm()).managerName, payment: (await getSubForm()).defaultPayment } });
      await writeAudit(fx, { id: sys.id, name: 'Sistem (MSRadius)', role: 'ADMIN' }, { action: 'CREATE', entity: 'formulir berlangganan', summary: `Formulir ${regNo} dibuat otomatis untuk pelanggan Waiting ${c.name} (${c.code})` });
      made.push({ regNo, name: c.name });
    }
    await fx.notify({ roles: ['MKT'], subject: `${made.length} pelanggan baru (Waiting) — Formulir Berlangganan dibuat otomatis`, body: `${made.slice(0, 15).map((m) => `• ${m.regNo} — ${m.name}`).join('\n')}${made.length > 15 ? `\n… dan ${made.length - 15} lainnya` : ''}\nLanjutkan menjadi WO Pasang Baru: ${webUrl()}/subscriptions` });
  });
  return made.length;
}

/** Master paket dari databilling/profile (tanpa harga modal/komisi); tidak pernah menonaktifkan paket. */
export async function applyPackages(rows: any[]): Promise<number> {
  let n = 0;
  for (const r of rows) {
    const name = str(r?.profile_name);
    if (!name) continue;
    const speed = str(r.speed) || null;
    const price = Number.isFinite(Number(r.price_sell)) && str(r.price_sell) !== '' ? Number(r.price_sell) : null;
    const cur = await prisma.package.findUnique({ where: { name } });
    if (!cur) { await prisma.package.create({ data: { name, source: 'RADIUS', speed, priceSell: price, sortOrder: 100 } }); n++; }
    else if (cur.source !== 'RADIUS' || cur.speed !== speed || (cur.priceSell != null ? Number(cur.priceSell) : null) !== price) { await prisma.package.update({ where: { name }, data: { source: 'RADIUS', speed, priceSell: price } }); n++; }
  }
  return n;
}

/** Master Area dari masterdata/area/list ({id_area: nama}). Area manual bernama sama diadopsi; tidak pernah menghapus/menonaktifkan; tautan gudang tetap diatur di Maung. */
export async function applyAreas(data: any): Promise<number> {
  const pairs: [string, string][] = Array.isArray(data) ? data.map((x: any) => [str(x?.id ?? x?.id_area), str(x?.name ?? x?.nama)] as [string, string]) : Object.entries(data ?? {}).map(([k, v]) => [str(k), str(v)] as [string, string]);
  let n = 0;
  for (const [code, name] of pairs) {
    if (!code || !name) continue;
    const byCode = await prisma.area.findUnique({ where: { code } });
    if (byCode) { if (byCode.name !== name && !(await prisma.area.findFirst({ where: { name, id: { not: byCode.id } } }))) { await prisma.area.update({ where: { id: byCode.id }, data: { name } }); n++; } continue; }
    const byName = await prisma.area.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, code: null } });
    if (byName) { await prisma.area.update({ where: { id: byName.id }, data: { code, source: 'RADIUS' } }); n++; continue; }
    if (await prisma.area.findUnique({ where: { name } })) continue;
    await prisma.area.create({ data: { code, name, source: 'RADIUS' } });
    n++;
  }
  return n;
}

/** Paket yang dipakai pelanggan tetapi belum ada di master dibuat otomatis (agar form pelanggan valid). */
async function ensureUsedPackages() {
  const used = await prisma.$queryRaw<{ n: string }[]>`SELECT DISTINCT "packageName" AS n FROM "Customer" WHERE "source" = 'RADIUS'`;
  const have = new Set((await prisma.package.findMany({ select: { name: true } })).map((p) => p.name));
  let c = 0;
  for (const { n } of used) if (n && !have.has(n)) { await prisma.package.create({ data: { name: n, source: 'RADIUS', sortOrder: 100 } }); c++; }
  return c;
}

const LOCK = 'radius:sync:lock';
export const syncRunning = async () => !!(await connection.exists(LOCK));

/** Satu putaran sinkron penuh (paket + pelanggan). Dikunci agar tidak berjalan ganda. */
export async function runSync(trigger: 'MANUAL' | 'AUTO', userId?: string) {
  if (!(await connection.set(LOCK, '1', 'EX', 900, 'NX'))) throw new Error('Sinkron sedang berjalan');
  const run = await prisma.syncRun.create({ data: { trigger, userId } });
  try {
    const cfg = await getRadius();
    const prof = await radiusGet(cfg, 'databilling/profile');
    const packages = await applyPackages(rowsOf(prof.data));
    await sleep(7_500); // jeda di bawah batas 10 request/60 dtk
    const areaRes = await radiusGet(cfg, 'masterdata/area/list');
    const areas = await applyAreas(areaRes.data);
    await sleep(7_500);
    const cust = await radiusGet(cfg, 'databilling/data');
    const stats = await applyCustomers(rowsOf(cust.data), true, { syncRunId: run.id });
    stats.areas = areas;
    stats.packages = packages + (await ensureUsedPackages());
    await prisma.syncRun.update({ where: { id: run.id }, data: { status: 'OK', finishedAt: new Date(), ...stats } });
    return { id: run.id, ...stats };
  } catch (e) {
    await prisma.syncRun.update({ where: { id: run.id }, data: { status: 'ERROR', finishedAt: new Date(), error: String((e as Error).message ?? e).slice(0, 500) } });
    throw e;
  } finally {
    await connection.del(LOCK);
  }
}

/** Tarik satu pelanggan berdasarkan kode (memanggil databilling/data lalu mengambil barisnya). */
export async function pullOne(code: string) {
  const cfg = await getRadius();
  const cust = await radiusGet(cfg, 'databilling/data');
  const rows = rowsOf(cust.data);
  const row = rows.find((r) => str(r?.kode) === code);
  if (!row) return null;
  const stats = await applyCustomers([row], true, { onlyCode: code });
  await ensureUsedPackages();
  return stats;
}
