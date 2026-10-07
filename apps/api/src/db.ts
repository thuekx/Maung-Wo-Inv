import { PrismaClient, Prisma } from '@prisma/client';

export const prisma = new PrismaClient();
export type Tx = Prisma.TransactionClient;

export class AppError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
