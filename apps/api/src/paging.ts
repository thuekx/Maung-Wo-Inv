import { Request, Response } from 'express';
import { z } from 'zod';

/**
 * Paginasi sisi-server yang seragam.
 * - Tanpa parameter `page`  → respons lama (array, dibatasi `legacyLimit`) agar pemanggil lama tetap jalan.
 * - Dengan `page`           → { rows, total, page, pageSize, pageCount, sort, dir }.
 */
const q = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sort: z.string().max(40).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
});

export interface PageOpts<K extends string> {
  /** kolom yang boleh diurutkan: kunci query → fungsi pembuat orderBy Prisma */
  sorts: Record<K, (dir: 'asc' | 'desc') => any>;
  defaultSort: { key: NoInfer<K>; dir: 'asc' | 'desc' };
  legacyLimit: number;
}

export function pageParams<K extends string>(req: Request, o: PageOpts<K>) {
  const p = q.parse(req.query);
  const key = (p.sort && p.sort in o.sorts ? p.sort : o.defaultSort.key) as K;
  const dir = p.dir ?? (p.sort && p.sort in o.sorts ? 'asc' : o.defaultSort.dir);
  // urutan kedua = id agar halaman stabil saat nilai kolom sama
  const orderBy = [o.sorts[key](dir), { id: dir }];
  const paged = p.page !== undefined;
  return paged
    ? { paged: true as const, page: p.page!, pageSize: p.pageSize, skip: (p.page! - 1) * p.pageSize, take: p.pageSize, orderBy, sort: key, dir }
    : { paged: false as const, page: 1, pageSize: o.legacyLimit, skip: 0, take: o.legacyLimit, orderBy, sort: key, dir };
}

export function sendPage<T>(res: Response, pp: ReturnType<typeof pageParams>, rows: T[], total: number) {
  if (!pp.paged) return void res.json(rows);
  res.json({ rows, total, page: pp.page, pageSize: pp.pageSize, pageCount: Math.max(1, Math.ceil(total / pp.pageSize)), sort: pp.sort, dir: pp.dir });
}

/** Hitung total hanya bila perlu (mode paged); mode lama tidak membayar COUNT(*). */
export const countIf = <T>(pp: { paged: boolean }, fn: () => Promise<T>): Promise<T | 0> => (pp.paged ? fn() : Promise.resolve(0 as 0));
