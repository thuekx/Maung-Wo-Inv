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
    assert.deepEqual(Object.keys(crmApp).sort(), ['description', 'icon', 'id', 'name', 'path']);
  });

  await t.test('aplikasi dinonaktifkan tidak tampil (bahkan untuk Admin)', async () => {
    assert.equal((await put({ apps: [{ ...crm, enabled: false }] })).status, 200);
    assert.deepEqual((await get(admin)).apps.map((a: any) => a.id), ['wo']);
    assert.deepEqual((await get(mkt)).apps.map((a: any) => a.id), ['wo']);
  });
});
