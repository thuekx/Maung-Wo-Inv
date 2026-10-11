/** Tes Caddyfile: penulis API (buildCaddyfile) dan migrasi entrypoint harus menyertakan import sites/*.caddy di level atas setelah blok global. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_URL ??= 'postgresql://x:x@localhost:5432/x'; // ssl.ts → db.ts; tidak ada koneksi dibuat di tes ini
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildCaddyfile, SITES_IMPORT } = require('../src/ssl') as typeof import('../src/ssl');

const ROOT = path.resolve(__dirname, '../../..');
const ENTRY = path.join(ROOT, 'proxy/caddy-entrypoint.sh');
const INIT = path.join(ROOT, 'proxy/Caddyfile.init');
const IMPORT = 'import /etc/caddy/sites/*.caddy';

/** Kembalikan { depthAtImport, importIdx, firstSiteIdx, globalEndIdx } berdasarkan kedalaman kurung kurawal. */
function layout(text: string) {
  const lines = text.split('\n');
  let depth = 0, importIdx = -1, firstSite = -1, globalEnd = -1, imports = 0, depthAtImport = -1;
  lines.forEach((l, i) => {
    const t = l.trim();
    if (/^import\s+\/etc\/caddy\/sites\//.test(t)) { imports++; importIdx = i; depthAtImport = depth; }
    const open = (t.match(/\{/g) ?? []).length, close = (t.match(/\}/g) ?? []).length;
    if (depth === 0 && open > 0 && firstSite < 0 && !/^\{\s*$/.test(t)) firstSite = i;
    if (depth === 0 && /^\{\s*$/.test(t) && globalEnd < 0) globalEnd = -2; // global dimulai
    depth += open - close;
    if (globalEnd === -2 && depth === 0) globalEnd = i;
  });
  return { imports, importIdx, depthAtImport, firstSite, globalEnd };
}

const cfgs = [
  ['SSL mati', { enabled: false, domain: '', email: '', forceRedirect: false }, false],
  ['SSL aktif, sertifikat belum sah', { enabled: true, domain: 'wo.contoh.co.id', email: 'a@b.id', forceRedirect: true }, false],
  ['SSL aktif, sertifikat sah, paksa HTTPS', { enabled: true, domain: 'wo.contoh.co.id', email: 'a@b.id', forceRedirect: true }, true],
  ['SSL aktif tanpa redirect', { enabled: true, domain: 'wo.contoh.co.id', email: '', forceRedirect: false }, true],
] as const;

for (const [name, cfg, certOk] of cfgs) {
  test(`buildCaddyfile — ${name}: tepat satu import di level atas, setelah blok global, sebelum situs`, () => {
    const out = buildCaddyfile(cfg as any, certOk);
    const l = layout(out);
    assert.equal(l.imports, 1);
    assert.equal(l.depthAtImport, 0);
    assert.ok(l.globalEnd >= 0 && l.importIdx > l.globalEnd, 'import harus sesudah blok global');
    assert.ok(l.firstSite < 0 || l.importIdx < l.firstSite, 'import harus sebelum blok situs pertama');
    assert.equal(SITES_IMPORT, IMPORT);
    assert.match(out, /:80 \{/); // jalur pemulihan tetap ada
    if (cfg.enabled) assert.ok(out.includes(`${cfg.domain} {`)); // domain WO tidak berubah
  });
}

/* ── entrypoint ── */
function runEntry(dir: string, env: Record<string, string> = {}) {
  return execFileSync('sh', [ENTRY], { env: { PATH: process.env.PATH!, CADDY_DIR: dir, INIT_FILE: INIT, CADDY_NO_RUN: '1', WEB_DOMAIN: 'wo.contoh.co.id', ...env }, encoding: 'utf8' });
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'caddy-'));
const strip = (s: string) => s.split('\n').filter((x) => !/^\s*import\s+\/etc\/caddy\/sites\//.test(x) && x.trim() !== '').join('\n');

test('entrypoint — instalasi baru: Caddyfile awal punya import di level atas setelah blok global', () => {
  const d = tmp();
  runEntry(d);
  const out = fs.readFileSync(path.join(d, 'Caddyfile'), 'utf8');
  const l = layout(out);
  assert.equal(l.imports, 1); assert.equal(l.depthAtImport, 0); assert.ok(l.importIdx > l.globalEnd);
  assert.match(out, /wo\.contoh\.co\.id \{/);
});

test('entrypoint — Caddyfile lama (dengan blok global) dimigrasi tanpa mengubah isi lain', () => {
  const d = tmp();
  const old = `{\n\temail admin@contoh.co.id\n\tauto_https disable_redirects\n}\n\nwo.contoh.co.id {\n\treverse_proxy web:3000 {\n\t\tlb_try_duration 20s\n\t}\n}\n\n:80 {\n\treverse_proxy web:3000\n}\n`;
  fs.writeFileSync(path.join(d, 'Caddyfile'), old); fs.writeFileSync(path.join(d, '.web-domain'), 'wo.contoh.co.id');
  const log = runEntry(d);
  const out = fs.readFileSync(path.join(d, 'Caddyfile'), 'utf8');
  assert.match(log, /dimigrasi/);
  const l = layout(out);
  assert.equal(l.imports, 1); assert.equal(l.depthAtImport, 0); assert.ok(l.importIdx > l.globalEnd && l.importIdx < l.firstSite);
  assert.equal(strip(out), strip(old)); // domain/sertifikat/blok lain identik
  assert.equal(fs.readFileSync(path.join(d, '.web-domain'), 'utf8'), 'wo.contoh.co.id');
});

test('entrypoint — Caddyfile lama tanpa blok global (mis. hanya :80) mendapat import di paling atas', () => {
  const d = tmp();
  const old = `# pemulihan\n:80 {\n\treverse_proxy web:3000\n}\n`;
  fs.writeFileSync(path.join(d, 'Caddyfile'), old); fs.writeFileSync(path.join(d, '.web-domain'), 'wo.contoh.co.id');
  runEntry(d);
  const out = fs.readFileSync(path.join(d, 'Caddyfile'), 'utf8');
  const l = layout(out);
  assert.equal(l.imports, 1); assert.equal(l.depthAtImport, 0); assert.ok(l.importIdx < l.firstSite);
  assert.equal(strip(out), strip(old));
});

test('entrypoint — idempoten: dijalankan ulang tidak menambah import & tidak mengubah berkas', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'Caddyfile'), `{\n\tauto_https off\n}\n\n:80 {\n\treverse_proxy web:3000\n}\n`); fs.writeFileSync(path.join(d, '.web-domain'), 'wo.contoh.co.id');
  runEntry(d);
  const a = fs.readFileSync(path.join(d, 'Caddyfile'), 'utf8');
  const log = runEntry(d);
  assert.equal(fs.readFileSync(path.join(d, 'Caddyfile'), 'utf8'), a);
  assert.doesNotMatch(log, /dimigrasi/);
  assert.equal(layout(a).imports, 1);
});

test('entrypoint — hasil tulis API (sudah ber-import) tidak diubah', () => {
  const d = tmp();
  const api = buildCaddyfile({ enabled: true, domain: 'wo.contoh.co.id', email: 'a@b.id', forceRedirect: false } as any, false);
  fs.writeFileSync(path.join(d, 'Caddyfile'), api); fs.writeFileSync(path.join(d, '.web-domain'), 'wo.contoh.co.id');
  runEntry(d);
  assert.equal(fs.readFileSync(path.join(d, 'Caddyfile'), 'utf8'), api);
});
