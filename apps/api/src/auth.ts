import { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { Role, SubRole, User } from './orm';
import { AppError, prisma } from './db';
import { config } from './config';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      /** Admin yang sedang "bertindak sebagai" peran lain (header X-Act-As): akun asli di sini, `user` berisi peran efektif */
      realUser?: User;
    }
  }
}

export const signToken = (u: User) => jwt.sign({ sub: u.id }, config.jwtSecret, { expiresIn: '12h' });

export const authenticate: RequestHandler = async (req, _res, next) => {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) throw new AppError(401, 'Belum login');
  let sub: string;
  try {
    sub = (jwt.verify(h.slice(7), config.jwtSecret) as { sub: string }).sub;
  } catch {
    throw new AppError(401, 'Sesi tidak valid / kedaluwarsa');
  }
  const user = await prisma.user.findUnique({ where: { id: sub } });
  if (!user || !user.active) throw new AppError(401, 'Akun tidak aktif');
  req.user = user;
  const act = String(req.headers['x-act-as'] ?? '').toUpperCase();
  if (act && user.role === 'ADMIN') {
    if (!ACT_ROLES.includes(act as Role)) throw new AppError(400, 'Peran "bertindak sebagai" tidak valid');
    const sub = String(req.headers['x-act-sub'] ?? 'SUPERVISOR').toUpperCase();
    req.realUser = user;
    req.user = { ...user, role: act as Role, subRole: (['MANAGER', 'SUPERVISOR', 'STAFF'].includes(sub) ? sub : 'SUPERVISOR') as SubRole };
  }
  next();
};

export const ACT_ROLES: Role[] = ['MKT', 'NOC', 'FOC', 'GA', 'FIN'];

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    const u = req.user!;
    if (u.role !== 'ADMIN' && !roles.includes(u.role)) throw new AppError(403, `Akses khusus: ${roles.join(', ')}`);
    next();
  };

import type { Request } from 'express';
import type { Actor } from './wf-types';
/** Pelaku untuk engine WO (peran efektif; `acting` = Admin yang sedang bertindak sebagai peran lain). */
export const actorOf = (req: Request): Actor => ({ id: req.user!.id, name: req.realUser ? `${req.user!.name} (Admin sbg ${req.user!.role})` : req.user!.name, role: req.user!.role, subRole: req.user!.subRole, acting: !!req.realUser });

export const publicUser = (u: User) => ({ id: u.id, name: u.name, email: u.email, role: u.role, subRole: u.subRole, telegramLinked: !!u.telegramChatId, mustChangePassword: u.mustChangePassword });
