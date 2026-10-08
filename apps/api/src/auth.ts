import { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { Role, User } from './orm';
import { AppError, prisma } from './db';
import { config } from './config';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
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
  next();
};

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    const u = req.user!;
    if (u.role !== 'ADMIN' && !roles.includes(u.role)) throw new AppError(403, `Akses khusus: ${roles.join(', ')}`);
    next();
  };

export const publicUser = (u: User) => ({ id: u.id, name: u.name, email: u.email, role: u.role, telegramLinked: !!u.telegramChatId, mustChangePassword: u.mustChangePassword });
