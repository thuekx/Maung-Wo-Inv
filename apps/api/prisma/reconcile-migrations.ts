/**
 * Menyelaraskan NAMA migrasi yang sudah tercatat di database dengan nama folder terbaru.
 * Tiga migrasi awal sempat bernama dengan tanggal mendahului waktu pembuatan sebenarnya; folder-nya diganti
 * ke stempel waktu asli. Tanpa langkah ini, database yang sudah menjalankan nama lama akan mencoba menjalankan
 * migrasi yang sama sekali lagi (CREATE yang sudah ada → gagal). Aman diulang dan tidak berefek pada database baru.
 * Dijalankan service `migrate` tepat sebelum `prisma migrate deploy`.
 */
import { prisma } from '../src/db';

export const RENAMED: [oldName: string, newName: string][] = [
  ['20261009000000_roles_masters_audit', '20261008054937_roles_masters_audit'],
  ['20261010000000_scale_indexes', '20261008163030_scale_indexes'],
  ['20261011000000_inbox', '20261008175007_inbox'],
];

async function main() {
  const t = await prisma.$queryRaw<{ ok: string | null }[]>`SELECT to_regclass('_prisma_migrations')::text AS ok`;
  if (!t[0]?.ok) { console.log('reconcile: database baru (belum ada riwayat migrasi) — dilewati'); return; }
  let n = 0;
  for (const [o, nw] of RENAMED) {
    n += await prisma.$executeRaw`UPDATE "_prisma_migrations" SET migration_name = ${nw} WHERE migration_name = ${o} AND NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = ${nw})`;
  }
  console.log(`reconcile: ${n} nama migrasi diselaraskan`);
}

main()
  .catch((e) => { console.error('reconcile gagal:', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); process.exit(process.exitCode ?? 0); });
