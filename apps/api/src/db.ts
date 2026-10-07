import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from './orm';

// Prisma 7 memakai driver adapter (koneksi dikelola driver `pg`)
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
export const prisma = new PrismaClient({ adapter });
export type Tx = Prisma.TransactionClient;

export class AppError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
