import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from './orm';

// Prisma 7 memakai driver adapter (koneksi dikelola driver `pg`)
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
export const prisma = new PrismaClient({ adapter });
export type Tx = Prisma.TransactionClient;

export class AppError extends Error {
  /** `fields`: pesan per-isian agar form menampilkan galat inline di bawah kolomnya */
  constructor(public status: number, message: string, public fields?: Record<string, string>) {
    super(message);
  }
}

/** Galat untuk satu isian form (ditampilkan inline di bawah kolom). */
export const fieldError = (field: string, message: string, status = 400) => new AppError(status, message, { [field]: message });
