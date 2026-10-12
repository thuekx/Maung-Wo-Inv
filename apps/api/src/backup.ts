import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import readline from 'readline';
import { spawn } from 'child_process';
import { Client } from 'pg';
import { config } from './config';

/**
 * Backup / restore / purge data aplikasi (Admin → Pengaturan → Data & Backup).
 * Format backup: NDJSON ter-gzip (`*.json.gz`): baris 1 = header (versi, migrasi skema, kolom per tabel), baris berikutnya = {"t": tabel, "rows": [...]}.
 * Tabel ditulis berurutan menurut ketergantungan FK. Foto/berkas ada di folder uploads dan dicadangkan terpisah (tar.gz).
 */
export const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR ?? './backups');
const FORMAT = 'maung-backup';
const VERSION = 1;
const SKIP_TABLES = new Set(['_prisma_migrations']);
export const SYSTEM_EMAIL = 'system@l1v.local';

const connect = async () => { const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect(); return c; };
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

export interface Meta { name: string; size: number; createdAt: string; kind: string; note?: string; by?: string; migration?: string; tables?: Record<string, number>; valid: boolean; error?: string }

/** Tabel aplikasi urut menurut FK (induk dulu) + kolomnya. */
async function schema(c: Client) {
  const cols = (await c.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`)).rows as { table_name: string; column_name: string }[];
  const byTable = new Map<string, string[]>();
  for (const r of cols) if (!SKIP_TABLES.has(r.table_name)) byTable.set(r.table_name, [...(byTable.get(r.table_name) ?? []), r.column_name]);
  const fks = (await c.query(`SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent FROM pg_constraint WHERE contype='f'`)).rows as { child: string; parent: string }[];
  const clean = (s: string) => s.replace(/^"|"$/g, '').replace(/^public\./, '').replace(/"/g, '');
  const deps = new Map<string, Set<string>>();
  for (const t of byTable.keys()) deps.set(t, new Set());
  for (const f of fks) { const ch = clean(f.child), pa = clean(f.parent); if (ch !== pa && deps.has(ch) && deps.has(pa)) deps.get(ch)!.add(pa); }
  const order: string[] = [];
  const left = new Set(byTable.keys());
  while (left.size) {
    const ready = [...left].filter((t) => [...deps.get(t)!].every((p) => !left.has(p))).sort();
    if (!ready.length) { order.push(...[...left].sort()); break; } // siklus (tidak ada saat ini): pakai urutan nama
    for (const t of ready) { order.push(t); left.delete(t); }
  }
  return { order, byTable };
}

async function latestMigration(c: Client) {
  try { return ((await c.query(`SELECT migration_name FROM _prisma_migrations ORDER BY migration_name DESC LIMIT 1`)).rows[0]?.migration_name as string) ?? ''; } catch { return ''; }
}

export async function createBackup(o: { kind: 'manual' | 'auto' | 'pre-purge' | 'pre-restore'; note?: string; by?: string }): Promise<Meta> {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `maung-${o.kind}-${stamp()}.json.gz`;
  const file = path.join(BACKUP_DIR, name);
  const c = await connect();
  const out = fs.createWriteStream(file + '.tmp');
  const gz = zlib.createGzip({ level: 6 });
  gz.pipe(out);
  const write = (s: string) => new Promise<void>((res, rej) => gz.write(s, (e) => (e ? rej(e) : res())));
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { order, byTable } = await schema(c);
    const counts: Record<string, number> = {};
    for (const t of order) counts[t] = Number((await c.query(`SELECT count(*) AS n FROM ${q(t)}`)).rows[0].n);
    const cols: Record<string, string[]> = Object.fromEntries(order.map((t) => [t, byTable.get(t)!]));
    await write(JSON.stringify({ format: FORMAT, version: VERSION, createdAt: new Date().toISOString(), kind: o.kind, note: o.note ?? null, by: o.by ?? null, migration: await latestMigration(c), tables: counts, columns: cols }) + '\n');
    for (const t of order) {
      if (!counts[t]) continue;
      await c.query(`DECLARE cur NO SCROLL CURSOR FOR SELECT to_jsonb(t) AS j FROM ${q(t)} t`);
      for (;;) {
        const r = await c.query('FETCH 500 FROM cur');
        if (!r.rows.length) break;
        await write(JSON.stringify({ t, rows: r.rows.map((x: { j: unknown }) => x.j) }) + '\n');
      }
      await c.query('CLOSE cur');
    }
    await c.query('COMMIT');
    await new Promise<void>((res, rej) => { out.on('finish', () => res()); out.on('error', rej); gz.end(); });
    fs.renameSync(file + '.tmp', file);
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* sudah selesai */ }
    gz.destroy(); out.destroy(); fs.rmSync(file + '.tmp', { force: true });
    throw e;
  } finally { await c.end(); }
  return (await readMeta(name))!;
}

/** Baca header backup (baris pertama) tanpa memuat seluruh berkas. */
export async function readMeta(name: string): Promise<Meta | null> {
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) return null;
  const st = fs.statSync(file);
  const base: Meta = { name, size: st.size, createdAt: st.mtime.toISOString(), kind: 'unknown', valid: false };
  try {
    const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
    let line = '';
    for await (const l of rl) { line = l; break; }
    rl.close();
    const h = JSON.parse(line);
    if (h.format !== FORMAT) return { ...base, error: 'Bukan berkas backup Maung' };
    return { ...base, createdAt: h.createdAt ?? base.createdAt, kind: h.kind ?? 'manual', note: h.note ?? undefined, by: h.by ?? undefined, migration: h.migration, tables: h.tables, valid: true };
  } catch { return { ...base, error: 'Berkas rusak / bukan backup Maung' }; }
}

export async function listBackups(): Promise<Meta[]> {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  const names = fs.readdirSync(BACKUP_DIR).filter((n) => /\.json\.gz$/.test(n));
  const metas = await Promise.all(names.map((n) => readMeta(n)));
  return (metas.filter(Boolean) as Meta[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Simpan hanya `keep` backup otomatis terbaru. */
export function pruneAuto(keep = 7) {
  if (!fs.existsSync(BACKUP_DIR)) return;
  const autos = fs.readdirSync(BACKUP_DIR).filter((n) => /^maung-auto-.*\.json\.gz$/.test(n)).sort().reverse();
  for (const n of autos.slice(keep)) fs.rmSync(path.join(BACKUP_DIR, n), { force: true });
}

export const safeName = (n: string) => /^[A-Za-z0-9._-]+\.json\.gz$/.test(n) && !n.includes('..');

export interface RestoreResult { tables: number; rows: number; adminKept: boolean; preBackup: string }
export async function restoreBackup(name: string, o: { includeSettings: boolean; keepAdminEmail?: string; by?: string }): Promise<RestoreResult> {
  const file = path.join(BACKUP_DIR, name);
  const meta = await readMeta(name);
  if (!meta || !meta.valid) throw new Error(meta?.error ?? 'Backup tidak ditemukan');
  const pre = await createBackup({ kind: 'pre-restore', note: `sebelum restore ${name}`, by: o.by });
  const c = await connect();
  try {
    const cur = await schema(c);
    const curMig = await latestMigration(c);
    if (meta.migration && curMig && meta.migration > curMig) throw new Error(`Backup dibuat pada versi skema lebih baru (${meta.migration}) daripada aplikasi ini (${curMig}). Perbarui aplikasi dulu.`);

    const adminRow = o.keepAdminEmail ? (await c.query(`SELECT to_jsonb(u) AS j FROM "User" u WHERE email=$1`, [o.keepAdminEmail])).rows[0]?.j : null;
    const sysRow = (await c.query(`SELECT to_jsonb(u) AS j FROM "User" u WHERE email=$1`, [SYSTEM_EMAIL])).rows[0]?.j;

    await c.query('BEGIN');
    await c.query('SAVEPOINT rep');
    try { await c.query(`SET LOCAL session_replication_role = replica`); } catch { await c.query('ROLLBACK TO SAVEPOINT rep'); } // butuh superuser; tanpa itu urutan FK dipakai
    const wipe = cur.order.filter((t) => o.includeSettings || t !== 'Setting');
    await c.query(`TRUNCATE ${wipe.map(q).join(', ')} RESTART IDENTITY CASCADE`);

    const header = JSON.parse(await firstLine(file));
    let tables = 0, rows = 0;
    const seen = new Set<string>();
    const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
    let first = true;
    for await (const line of rl) {
      if (first) { first = false; continue; }
      if (!line.trim()) continue;
      const { t, rows: chunk } = JSON.parse(line) as { t: string; rows: Record<string, unknown>[] };
      if (!cur.byTable.has(t) || (t === 'Setting' && !o.includeSettings)) continue;
      const have = new Set(cur.byTable.get(t)!);
      const cols = (header.columns?.[t] as string[] | undefined ?? Object.keys(chunk[0] ?? {})).filter((x) => have.has(x)); // kolom baru memakai default; kolom yang sudah dihapus diabaikan
      if (!cols.length) continue;
      const list = cols.map(q).join(', ');
      await c.query(`INSERT INTO ${q(t)} (${list}) SELECT ${list} FROM jsonb_populate_recordset(null::${q(t)}, $1::jsonb)`, [JSON.stringify(chunk)]);
      rows += chunk.length; if (!seen.has(t)) { seen.add(t); tables++; }
    }
    // Jangan biarkan Admin yang sedang login (dan user sistem) hilang/terkunci:
    //  - akun Admin Anda: bila ada di backup, password & status AKTIF saat ini dipertahankan; bila tidak ada, ditambahkan kembali
    let adminKept = true;
    const userCols = cur.byTable.get('User')!;
    for (const [email, row] of [[o.keepAdminEmail, adminRow], [SYSTEM_EMAIL, sysRow]] as const) {
      if (!email || !row) continue;
      const ex = await c.query(`SELECT 1 FROM "User" WHERE email=$1`, [email]);
      if (ex.rowCount) {
        if (email === o.keepAdminEmail) await c.query(`UPDATE "User" SET "passwordHash"=$2, active=true, role='ADMIN', "mustChangePassword"=false WHERE email=$1`, [email, (row as { passwordHash: string }).passwordHash]);
      } else {
        const cols = Object.keys(row).filter((x) => userCols.includes(x)).map(q).join(', ');
        await c.query(`INSERT INTO "User" (${cols}) SELECT ${cols} FROM jsonb_populate_recordset(null::"User", $1::jsonb)`, [JSON.stringify([row])]);
        if (email === o.keepAdminEmail) adminKept = false;
      }
    }
    await c.query('COMMIT');
    return { tables, rows, adminKept, preBackup: pre.name };
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* abaikan */ }
    throw e;
  } finally { await c.end(); }
}

async function firstLine(file: string) {
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const l of rl) { rl.close(); return l; }
  return '{}';
}

/* ───────── Purge ───────── */
export type PurgeScope = 1 | 2 | 3;
const S1 = ['PrQuote', 'PrLine', 'PurchaseRequest', 'PoLine', 'PurchaseOrder', 'WoEvent', 'Attachment', 'WorkOrder', 'CrmQuotation', 'Subscription', 'StockMovement', 'Notification', 'Inbox', 'AuditLog', 'OutboundEvent', 'KancaEvent', 'Counter'];
const S2 = ['CustomerChange', 'Asset', 'StockLevel', 'Customer'];
const S3 = ['Vendor', 'Item', 'AssetModel', 'AssetBrand', 'Area', 'Package', 'Warehouse', 'SyncRun'];

export async function purgeData(o: { scope: PurgeScope; deleteUsers: boolean; deleteFiles: boolean; keepAdminEmail?: string }) {
  const c = await connect();
  const deleted: Record<string, number> = {};
  const files: string[] = [];
  try {
    await c.query('BEGIN');
    if (o.deleteFiles) for (const r of (await c.query(`SELECT url FROM "Attachment" WHERE kind <> 'LOGO'`)).rows) files.push(String(r.url));
    const del = async (t: string, where = '') => { const r = await c.query(`DELETE FROM ${q(t)} ${where}`); deleted[t] = (deleted[t] ?? 0) + (r.rowCount ?? 0); };
    for (const t of S1) await del(t, t === 'Attachment' ? `WHERE kind <> 'LOGO'` : ''); // logo/branding tidak ikut terhapus
    await c.query(`UPDATE "Asset" SET "woId" = NULL`);
    if (o.scope >= 2) for (const t of S2) await del(t);
    if (o.scope >= 3) for (const t of S3) await del(t);
    if (o.deleteUsers) {
      // gudang berjalan milik teknisi yang dihapus ikut dibersihkan
      await c.query(`DELETE FROM "StockLevel" WHERE "warehouseId" IN (SELECT id FROM "Warehouse" WHERE kind='MOBILE' AND "ownerId" IN (SELECT id FROM "User" WHERE role <> 'ADMIN' AND email <> $1))`, [SYSTEM_EMAIL]);
      await c.query(`DELETE FROM "Warehouse" WHERE kind='MOBILE' AND "ownerId" IN (SELECT id FROM "User" WHERE role <> 'ADMIN' AND email <> $1)`, [SYSTEM_EMAIL]);
      await del('User', `WHERE role <> 'ADMIN' AND email <> '${SYSTEM_EMAIL}'`);
    }
    // pengaman: akun Admin yang sedang dipakai harus tetap ada
    if (o.keepAdminEmail && !(await c.query(`SELECT 1 FROM "User" WHERE email=$1 AND active`, [o.keepAdminEmail])).rowCount) throw new Error('Pengaman: akun Admin Anda tidak ditemukan setelah pembersihan — dibatalkan');
    await c.query('COMMIT');
  } catch (e) { try { await c.query('ROLLBACK'); } catch { /* abaikan */ } throw e; } finally { await c.end(); }
  let removedFiles = 0;
  for (const u of files) { const f = path.join(config.uploadDir, path.basename(u)); try { fs.unlinkSync(f); removedFiles++; } catch { /* sudah tidak ada */ } }
  return { deleted, removedFiles };
}

/* ───────── Seed (data master awal / demo) ───────── */
/** Jalankan skrip seed sebagai proses terpisah. Akun yang sudah ada TIDAK diubah (upsert tanpa update) → Admin tidak terkunci. */
export function runSeed(kind: 'seed' | 'seed-demo', env: Record<string, string> = {}): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const dist = path.resolve(process.cwd(), `dist/prisma/${kind}.js`);
    const [cmd, args] = fs.existsSync(dist) ? [process.execPath, [dist]] : ['npx', ['tsx', `prisma/${kind}.ts`]];
    const p = spawn(cmd, args as string[], { cwd: process.cwd(), env: { ...process.env, ...env } });
    let out = '';
    const add = (b: Buffer) => { out += b.toString(); if (out.length > 20000) out = out.slice(-20000); };
    p.stdout.on('data', add); p.stderr.on('data', add);
    const timer = setTimeout(() => { p.kill(); }, 10 * 60_000);
    p.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, output: out.slice(-3000) }); });
    p.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, output: String(e) }); });
  });
}

/* ───────── Berkas unggahan (foto) ───────── */
export function tarUploads(): ReturnType<typeof spawn> {
  return spawn('tar', ['-czf', '-', '--exclude=./.cache', '-C', path.resolve(config.uploadDir), '.']);
}
export async function untarUploads(file: string): Promise<number> {
  const list: string = await new Promise((res, rej) => { const p = spawn('tar', ['-tzf', file]); let o = ''; p.stdout.on('data', (b) => (o += b)); p.on('close', (c) => (c === 0 ? res(o) : rej(new Error('Berkas tar.gz tidak valid')))); });
  const names = list.split('\n').filter(Boolean);
  if (names.some((n) => n.startsWith('/') || n.split('/').includes('..'))) throw new Error('Berkas ditolak: berisi path berbahaya');
  fs.mkdirSync(config.uploadDir, { recursive: true });
  await new Promise<void>((res, rej) => { const p = spawn('tar', ['-xzf', file, '-C', path.resolve(config.uploadDir), '--no-same-owner']); p.on('close', (c) => (c === 0 ? res() : rej(new Error('Gagal mengekstrak foto')))); });
  return names.filter((n) => !n.endsWith('/')).length;
}
