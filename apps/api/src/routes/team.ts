import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { AppError, prisma } from '../db';
import { authenticate } from '../auth';
import { whoOf, writeAudit, auditedUpdate, changes } from '../audit';
import { transact } from '../effects';

/**
 * "Tim Saya": Manager sebuah divisi menambah & mengatur supervisor/staf di divisinya sendiri.
 * Batas: hanya divisi yang sama, hanya sub-role SUPERVISOR/STAFF, tidak bisa menyentuh Manager lain / dirinya sendiri.
 */
export const teamRoutes = Router();

const guard = (req: any) => {
  const u = req.user!;
  if (u.role === 'ADMIN' || u.subRole !== 'MANAGER') throw new AppError(403, 'Khusus Manager divisi');
  return u as { id: string; role: any };
};
const SYSTEM = 'system@l1v.local';
const pick = { id: true, name: true, email: true, role: true, subRole: true, active: true, mustChangePassword: true, createdAt: true } as const;

teamRoutes.get('/team', authenticate, async (req, res) => {
  const me = guard(req);
  res.json(await prisma.user.findMany({ where: { role: me.role, email: { not: SYSTEM } }, select: pick, orderBy: [{ subRole: 'asc' }, { name: 'asc' }] }));
});

const sub = z.enum(['SUPERVISOR', 'STAFF']);
teamRoutes.post('/team', authenticate, async (req, res) => {
  const me = guard(req);
  const b = z.object({ name: z.string().trim().min(2), email: z.string().trim().email(), subRole: sub.default('STAFF'), password: z.string().min(8) }).parse(req.body);
  const email = b.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) throw new AppError(409, 'Email sudah terdaftar');
  const who = whoOf(req);
  const hash = await bcrypt.hash(b.password, 10);
  const row = await transact(async (fx) => {
    const u = await fx.tx.user.create({ data: { name: b.name, email, role: me.role, subRole: b.subRole, passwordHash: hash, mustChangePassword: true }, select: pick });
    await writeAudit(fx, who, { action: 'CREATE', entity: 'user', entityId: u.id, summary: `Manager ${who.name} menambah ${u.subRole} ${u.email} (${u.role})` });
    return u;
  });
  res.status(201).json(row);
});

teamRoutes.patch('/team/:id', authenticate, async (req, res) => {
  const me = guard(req);
  const id = String(req.params.id);
  const b = z.object({ name: z.string().trim().min(2).optional(), subRole: sub.optional(), active: z.boolean().optional(), password: z.string().min(8).optional() }).parse(req.body);
  const cur = await prisma.user.findUnique({ where: { id } });
  if (!cur || cur.role !== me.role || cur.email === SYSTEM) throw new AppError(404, 'Anggota tim tidak ditemukan');
  if (cur.id === me.id || cur.subRole === 'MANAGER') throw new AppError(403, 'Manager tidak dapat diubah dari sini');
  const { password, ...rest } = b;
  const ch = changes(cur, rest);
  const u = await auditedUpdate(whoOf(req), 'user', id, cur.email, ch, async (fx) =>
    fx.tx.user.update({ where: { id }, data: { ...rest, ...(password ? { passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true } : {}) }, select: pick }),
  );
  res.json(u);
});
