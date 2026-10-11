/** Tes beranda satu pintu: daftar aplikasi, validasi jalur, dan akses per divisi lewat matriks Hak Akses. Butuh DATABASE_URL (DB uji). */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

test('launcher API', { skip: process.env.DATABASE_URL ? false : 'DATABASE_URL tidak diisi' }, async (t) => {
  const express = (await import('express')).default;
  const { prisma } = await import('../src/db');
  const { signToken } = await import('../src/auth');
  const { launcherRoutes } = await import('../src/routes/launcher');
  const { adminRoutes } = await import('../src/routes/admin');
  const { putSetting } = await import('../src/settings');
  const app = express();
  app.use(express.json());
  const { authenticate } = await import('../src/auth');
  app.use('/api', launcherRoutes);
  app.use('/api', authenticate, adminRoutes);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.name === 'ZodError' ? 400 : err.status ?? 500).json({ error: err.message, fields: err.fields }));
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  const tag = `lt${Date.now()}`;
  const mk = (role: any, subRole: any) => prisma.user.create({ data: { email: `${tag}-${role}-${subRole}@t.local`, name: `U ${role}`, passwordHash: 'x', role, subRole, mustChangePassword: false } });
  const [admin, mkt, mktStaff, noc] = await Promise.all([mk('ADMIN', 'MANAGER'), mk('MKT', 'SUPERVISOR'), mk('MKT', 'STAFF'), mk('NOC', 'SUPERVISOR')]);
  const tok = (u: any) => ({ authorization: `Bearer ${signToken(u)}`, 'content-type': 'application/json' });
  const before = await prisma.setting.findMany({ where: { key: { in: ['launcher', 'access'] } } });

  t.after(async () => {
    server.close();
    await prisma.setting.deleteMany({ where: { key: { in: ['launcher', 'access'] } } });
    for (const s of before) await prisma.setting.create({ data: { key: s.key, value: s.value as any } });
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, mkt.id, mktStaff.id, noc.id] } } });
    await prisma.$disconnect();
  });
  await putSetting('launcher', { apps: [] });
  await putSetting('access', { overrides: {} });

  const get = async (u: any) => (await (await fetch(`${base}/launcher`, { headers: tok(u) })).json()) as any;
  const put = (body: unknown, u: any = admin) => fetch(`${base}/admin/launcher`, { method: 'PUT', headers: tok(u), body: JSON.stringify(body) });
  const crm = { id: 'crm', name: 'CRM Sales', description: 'Aktivitas lapangan', icon: 'users', path: '/crm', enabled: true };

  await t.test('tanpa aplikasi lain: hanya WO', async () => {
    assert.deepEqual((await get(mkt)).apps.map((a: any) => a.id), ['wo']);
  });

  await t.test('hanya Admin yang boleh mengubah daftar; validasi jalur & ID', async () => {
    assert.equal((await put({ apps: [crm] }, mkt)).status, 403);
    for (const bad of [{ ...crm, path: '/api' }, { ...crm, path: '/work-orders' }, { ...crm, path: 'crm' }, { ...crm, path: '/a/b' }, { ...crm, path: '/CRM' }, { ...crm, id: 'wo' }, { ...crm, id: 'X Y' }, { ...crm, icon: 'nope' }]) {
      assert.equal((await put({ apps: [bad] })).status, 400, JSON.stringify(bad));
    }
    assert.equal((await put({ apps: [crm, { ...crm, id: 'crm2' }] })).status, 400, 'jalur ganda');
    assert.equal((await put({ apps: [crm, { ...crm, path: '/crm2' }] })).status, 400, 'id ganda');
  });

  await t.test('aplikasi baru: bawaan tak ada yang melihat kecuali Admin; Hak Akses mengatur per divisi/sub-role', async () => {
    assert.equal((await put({ apps: [crm] })).status, 200);
    assert.deepEqual((await get(admin)).apps.map((a: any) => a.id), ['wo', 'crm']);
    assert.deepEqual((await get(mkt)).apps.map((a: any) => a.id), ['wo']);
    const m = await fetch(`${base}/admin/access`, { headers: tok(admin) }).then((r) => r.json() as Promise<any>);
    assert.ok(m.features.some((f: any) => f.key === 'app.crm' && f.group === 'Aplikasi'));
    assert.equal((await fetch(`${base}/admin/access`, { method: 'PUT', headers: tok(admin), body: JSON.stringify({ matrix: { 'app.crm': ['MKT:SUPERVISOR', 'MKT:MANAGER'] } }) })).status, 200);
    assert.deepEqual((await get(mkt)).apps.map((a: any) => a.id), ['wo', 'crm']);
    assert.deepEqual((await get(mktStaff)).apps.map((a: any) => a.id), ['wo']);
    assert.deepEqual((await get(noc)).apps.map((a: any) => a.id), ['wo']);
    const crmApp = (await get(mkt)).apps[1];
    assert.deepEqual(Object.keys(crmApp).sort(), ['description', 'icon', 'iconUrl', 'id', 'name', 'path']);
  });

  await t.test('aplikasi dinonaktifkan tidak tampil (bahkan untuk Admin)', async () => {
    assert.equal((await put({ apps: [{ ...crm, enabled: false }] })).status, 200);
    assert.deepEqual((await get(admin)).apps.map((a: any) => a.id), ['wo']);
    assert.deepEqual((await get(mkt)).apps.map((a: any) => a.id), ['wo']);
  });

  await t.test('teks beranda & ubin WO dapat diubah Admin dan sampai ke /launcher (bawaan bila belum diatur)', async () => {
    const def = await get(mkt);
    assert.equal(def.home.title, 'Selamat datang, {nama_depan}'); assert.equal(def.home.backLabel, 'Menu Utama'); assert.equal(def.home.alwaysShow, false);
    assert.equal(def.apps[0].name, 'Work Order & Inventori'); assert.equal(def.apps[0].path, '/');
    const body = { apps: [{ ...crm, enabled: true }], home: { title: 'Halo {nama}', subtitle: '', backLabel: 'Beranda', alwaysShow: true }, wo: { name: 'WO Utama', description: 'Tiket & stok', icon: 'wrench', iconUrl: null } };
    assert.equal((await put(body)).status, 200);
    const g = await get(mkt);
    assert.equal(g.home.title, 'Halo {nama}'); assert.equal(g.home.backLabel, 'Beranda'); assert.equal(g.home.alwaysShow, true);
    assert.deepEqual([g.apps[0].name, g.apps[0].icon, g.apps[0].description], ['WO Utama', 'wrench', 'Tiket & stok']);
    assert.equal((await put({ ...body, home: { ...body.home, title: '' } })).status, 400);
    assert.equal((await put({ ...body, wo: { ...body.wo, icon: 'tidak-ada' } })).status, 400);
    assert.equal((await put({ ...body, wo: { ...body.wo, iconUrl: 'https://evil.example/x.png' } })).status, 400, 'iconUrl harus berkas unggahan sendiri');
    assert.equal((await put({ ...body, wo: { ...body.wo, iconUrl: '/uploads/../../etc/passwd' } })).status, 400);
  });

  await t.test('ikon sendiri: PNG/WebP/JPEG dinormalkan 192px PNG; SVG & non-gambar ditolak; hanya Admin', async () => {
    const sharp = (await import('sharp')).default;
    const png = await sharp({ create: { width: 40, height: 20, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }).png().toBuffer();
    const send = (buf: Buffer, type: string, name: string, u: any = admin) => {
      const fd = new FormData(); fd.append('file', new Blob([new Uint8Array(buf)], { type }), name);
      return fetch(`${base}/admin/launcher/icon`, { method: 'POST', headers: { authorization: `Bearer ${signToken(u)}` }, body: fd });
    };
    assert.equal((await send(png, 'image/png', 'a.png', mkt)).status, 403);
    assert.equal((await send(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml', 'a.svg')).status, 400);
    assert.equal((await send(Buffer.from('bukan gambar'), 'image/png', 'rusak.png')).status, 400, 'PNG rusak');
    const ok = await send(png, 'image/png', 'ikon.png');
    assert.equal(ok.status, 201);
    const { url } = (await ok.json()) as { url: string };
    assert.match(url, /^\/uploads\/app-icon-[a-z0-9-]+\.png$/);
    const { config } = await import('../src/config');
    const file = (await import('node:path')).join(config.uploadDir, url.replace('/uploads/', ''));
    const meta = await sharp(file).metadata();
    assert.deepEqual([meta.width, meta.height, meta.format], [192, 192, 'png']);
    // dipakai di WO & aplikasi lain
    const body = { apps: [{ ...crm, iconUrl: url }], home: { title: 'T', subtitle: '', backLabel: 'Menu Utama', alwaysShow: false }, wo: { name: 'WO', description: '', icon: 'clipboard-check', iconUrl: url } };
    assert.equal((await put(body)).status, 200);
    const g = await get(admin);
    assert.equal(g.apps[0].iconUrl, url); assert.equal(g.apps[1].iconUrl, url);
    (await import('node:fs')).unlinkSync(file);
  });
});
