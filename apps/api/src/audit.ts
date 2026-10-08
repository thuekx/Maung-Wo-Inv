import { Role } from './orm';
import { Effects, transact } from './effects';
import type { Request } from 'express';

export interface Who { id: string; name: string; role: Role }
export const whoOf = (req: Request): Who => ({ id: req.user!.id, name: req.user!.name, role: req.user!.role });

type Json = Record<string, unknown> | null;

/** Catat jejak audit di dalam transaksi yang sama dengan perubahannya. */
export async function writeAudit(fx: Effects, who: Who, p: { action: 'CREATE' | 'UPDATE' | 'DELETE' | 'PASSWORD_RESET' | 'IMPORT'; entity: string; entityId?: string; summary: string; before?: Json; after?: Json }) {
  await fx.tx.auditLog.create({ data: { userId: who.id, userName: who.name, role: who.role, action: p.action, entity: p.entity, entityId: p.entityId, summary: p.summary, before: (p.before ?? undefined) as any, after: (p.after ?? undefined) as any } });
}

/** Ambil hanya kolom yang berubah (untuk ringkasan audit). */
export function changes<T extends Record<string, any>>(before: T, patch: Record<string, any>) {
  const b: Record<string, unknown> = {}, a: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const old = before[k];
    const same = old instanceof Date && v instanceof Date ? old.getTime() === v.getTime() : (old ?? null) === (v ?? null);
    if (!same) { b[k] = old ?? null; a[k] = v ?? null; }
  }
  return { before: b, after: a, changed: Object.keys(a) };
}

/** Edit: simpan data lalu catat audit. Lewati bila tidak ada perubahan. */
export async function auditedUpdate<T>(who: Who, entity: string, id: string, label: string, ch: { before: Json; after: Json; changed: string[] }, apply: (fx: Effects) => Promise<T>): Promise<T> {
  return transact(async (fx) => {
    const r = await apply(fx);
    if (ch.changed.length) await writeAudit(fx, who, { action: 'UPDATE', entity, entityId: id, summary: `${who.name} mengubah ${entity} ${label}: ${ch.changed.join(', ')}`, before: ch.before, after: ch.after });
    return r;
  });
}

/** Hapus data: audit + notifikasi ke Admin (email + Telegram) kecuali yang menghapus sendiri Admin. */
export async function auditedDelete(who: Who, entity: string, id: string, label: string, snapshot: Json, remove: (fx: Effects) => Promise<unknown>) {
  await transact(async (fx) => {
    await remove(fx);
    await writeAudit(fx, who, { action: 'DELETE', entity, entityId: id, summary: `${who.name} (${who.role}) menghapus ${entity}: ${label}`, before: snapshot });
    if (who.role !== 'ADMIN')
      await fx.notify({
        roles: ['ADMIN'],
        subject: `🗑 Penghapusan data: ${entity} ${label}`,
        body: `${who.name} (${who.role}) menghapus ${entity}: ${label}\nWaktu: ${new Date().toLocaleString('id-ID')}\nSalinan data tersimpan di Admin → Log audit.`,
      });
  });
}

