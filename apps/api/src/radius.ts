import { prisma } from './db';
import { connection } from './queue';
import { decryptSecret, encryptSecret, getSetting, putSetting } from './settings';

/**
 * Integrasi MSRadius — BACA-SAJA. Sistem ini tidak pernah menulis ke MSRadius.
 * Sumber data pelanggan: GET databilling/data (semua pelanggan dalam 1 panggilan); paket: GET databilling/profile.
 * Batas MSRadius: 10 request/60 dtk per token → satu putaran sinkron hanya memakai 2 request dengan jeda ≥ 7 dtk.
 */

export interface RadiusCfg { baseUrl: string; token: string; enabled: boolean; intervalMin: number; lastAutoAt: number | null }
export const RADIUS_DEFAULT_URL = 'http://radius.liv.net.id/api/radius';

export async function getRadius(): Promise<RadiusCfg> {
  const s = (await getSetting<any>('radius')) ?? {};
  return {
    baseUrl: (typeof s.baseUrl === 'string' && s.baseUrl.trim() ? s.baseUrl.trim() : RADIUS_DEFAULT_URL).replace(/\/+$/, ''),
    token: decryptSecret(s.token),
    enabled: s.enabled !== false, // bawaan: otomatis aktif begitu token diisi
    intervalMin: Number.isInteger(Number(s.intervalMin)) && Number(s.intervalMin) >= 5 ? Number(s.intervalMin) : 60,
    lastAutoAt: typeof s.lastAutoAt === 'number' ? s.lastAutoAt : null,
  };
}

export async function saveRadius(p: { baseUrl: string; token?: string; enabled: boolean; intervalMin: number }, userId: string) {
  const cur = (await getSetting<any>('radius')) ?? {};
  await putSetting('radius', { ...cur, baseUrl: p.baseUrl, enabled: p.enabled, intervalMin: p.intervalMin, ...(p.token ? { token: encryptSecret(p.token) } : {}) }, userId);
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

export interface Mapped { code: string; name: string; phone: string; address: string; lat: number | null; lng: number | null; packageName: string; radiusName: string; radiusIp: string | null; expiredAt: Date | null; resellerName: string | null; salesName: string | null; suspended: boolean; registeredAt: Date | null }

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
  };
}

const rowsOf = (d: any): any[] => (Array.isArray(d) ? d : d && typeof d === 'object' ? Object.values(d) : []);

export interface SyncStats { created: number; updated: number; unchanged: number; skipped: number; missing: number; packages: number; areas: number }

/** Terapkan baris MSRadius ke tabel Customer (upsert by `kode`); kolom milik Maung (email, ODP, port, VLAN, IP internal, gudang) tidak disentuh. */
export async function applyCustomers(rows: any[], pretty: boolean, opts: { onlyCode?: string } = {}): Promise<SyncStats> {
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
  const existing = new Map((await prisma.customer.findMany({ where: opts.onlyCode ? { code: opts.onlyCode } : {}, select: { id: true, code: true, name: true, phone: true, address: true, lat: true, lng: true, packageName: true, radiusIp: true, expiredAt: true, resellerName: true, salesName: true, status: true, source: true, missingFromApi: true, activatedAt: true } })).map((c) => [c.code, c]));
  const now = new Date();
  const CH = 200;
  for (let i = 0; i < mapped.length; i += CH) {
    await prisma.$transaction(async (tx) => {
      for (const m of mapped.slice(i, i + CH)) {
        const cur = existing.get(m.code);
        if (!cur) {
          await tx.customer.create({ data: { code: m.code, name: m.name, phone: m.phone, address: m.address, lat: m.lat, lng: m.lng, packageName: m.packageName, status: m.suspended ? 'SUSPENDED' : 'ACTIVE', source: 'RADIUS', radiusName: m.radiusName, radiusIp: m.radiusIp, expiredAt: m.expiredAt, resellerName: m.resellerName, salesName: m.salesName, activatedAt: m.registeredAt, syncedAt: now } });
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
        if (!busy.has(cur.id) && (cur.status === 'ACTIVE' || cur.status === 'SUSPENDED')) {
          const want = m.suspended ? 'SUSPENDED' : 'ACTIVE';
          if (cur.status !== want) data.status = want;
        }
        if (Object.keys(data).length) { await tx.customer.update({ where: { id: cur.id }, data: { ...data, syncedAt: now } as any }); st.updated++; }
        else { st.unchanged++; }
      }
    }, { timeout: 120_000 });
  }
  if (!opts.onlyCode) {
    // tidak ada lagi di MSRadius → hanya ditandai (tidak dihapus).
    // Pengaman: respons kosong/terpotong (mis. gangguan di sisi MSRadius) tidak boleh menandai pelanggan massal.
    const totalRadius = await prisma.customer.count({ where: { source: 'RADIUS' } });
    if (seen.size === 0 || (totalRadius > 20 && seen.size < totalRadius * 0.5)) {
      console.warn(`[radius] daftar pelanggan MSRadius tampak tidak lengkap (${seen.size} dari ${totalRadius}) — penandaan "hilang" dilewati`);
      return st;
    }
    const codes = [...seen];
    const gone = await prisma.$executeRaw`UPDATE "Customer" SET "missingFromApi" = true WHERE "source" = 'RADIUS' AND "missingFromApi" = false AND NOT ("code" = ANY(${codes}::text[]))`;
    st.missing = Number(gone);
  }
  return st;
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
    const stats = await applyCustomers(rowsOf(cust.data), true);
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
