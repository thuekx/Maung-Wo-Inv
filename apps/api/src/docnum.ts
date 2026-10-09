import type { Tx } from './db';

/** "WO-NI-20261009-0007" / "TT-20261009-0003" → "20261009-0007" (hanya angka tanggal-urut). */
export const woDigits = (number: string) => /(\d{8}-\d{4,})$/.exec(number)?.[1] ?? number;

/** Singkatan area untuk nomor dokumen (alias di Master Area; bila kosong 3 huruf pertama nama; terakhir "XXX"). */
export const areaAlias = (a?: { alias?: string | null; name?: string | null } | null) =>
  (a?.alias?.trim() || a?.name?.replace(/[^A-Za-z0-9]/g, '').slice(0, 3) || 'XXX').toUpperCase();

export async function aliasForArea(tx: Pick<Tx, 'area'>, areaId?: string | null) {
  return areaAlias(areaId ? await tx.area.findUnique({ where: { id: areaId }, select: { alias: true, name: true } }) : null);
}

/** BA: BAA/ALIAS/20261009-0007 · Laporan instalasi: FOC/INS-ALIAS/… · Laporan troubleshooting/maintenance: FOC/TBS-ALIAS/… */
export const baNumber = (alias: string, woNumber: string) => `BAA/${alias}/${woDigits(woNumber)}`;
export const reportNumber = (kind: 'INS' | 'TBS', alias: string, woNumber: string) => `FOC/${kind}-${alias}/${woDigits(woNumber)}`;
