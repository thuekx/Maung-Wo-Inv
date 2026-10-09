import { Prisma, WoType } from './orm';
import { AppError, Tx } from './db';
import { Effects } from './effects';
import { config } from './config';
import { nextNumber } from './inventory';
import { workflows } from './workflows';
import { isLead, type Actor, type Ctx, type WoFull } from './wf-types';

const CANCELLED = 'CANCELLED';

/** Foto laporan: kaitkan ke WO; untuk teknisi (FOC) semua foto wajib bertanda GPS (bila kebijakan aktif). */
export async function bindPhotos(tx: Tx, woId: string, actor: Actor, urls: unknown, kind: 'REPORT' | 'PROGRESS', note?: string) {
  if (!Array.isArray(urls) || !urls.length) return;
  const list = [...new Set(urls.filter((u): u is string => typeof u === 'string'))];
  const rows = await tx.attachment.findMany({ where: { url: { in: list } } });
  const policy = ((await tx.setting.findUnique({ where: { key: 'app' } }))?.value as { requireGps?: boolean } | null)?.requireGps !== false;
  if (actor.role === 'FOC' && policy && list.some((u) => { const r = rows.find((x) => x.url === u); return !r || r.lat == null || r.lng == null; }))
    throw new AppError(400, 'Semua foto teknisi harus bertanda GPS — ambil foto langsung lewat aplikasi dengan izin lokasi aktif');
  await tx.attachment.updateMany({ where: { url: { in: list } }, data: { woId, kind, ...(note ? { note } : {}) } });
}

export async function systemActor(tx: Tx): Promise<Actor> {
  const u = await tx.user.findUnique({ where: { email: 'system@l1v.local' } });
  if (!u) throw new AppError(500, 'User sistem belum ada (jalankan seed)');
  return { id: u.id, name: 'Sistem', role: u.role };
}

const loadWo = (tx: Tx, id: string) => tx.workOrder.findUniqueOrThrow({ where: { id }, include: { customer: true } });

function makeCtx(fx: Effects, wo: WoFull, actor: Actor): Ctx {
  const ctx: Ctx = {
    tx: fx.tx,
    fx,
    wo,
    actor,
    data: {},
    patch: {},
    createChild: (type, input) => createWorkOrder(fx, { type, actor, input, parentId: wo.id, system: true }),
  };
  return ctx;
}

export function isOpen(status: string, type: WoType) {
  return status !== CANCELLED && !workflows[type].statuses[status]?.final;
}

/** Buat WO baru dan masuk ke status awal workflow-nya. */
export async function createWorkOrder(
  fx: Effects,
  p: { type: WoType; actor: Actor; input: Record<string, any>; parentId?: string; system?: boolean; source?: string },
) {
  const wf = workflows[p.type];
  const { tx } = fx;
  if (!p.system && p.actor.role !== 'ADMIN' && !wf.createRoles.includes(p.actor.role))
    throw new AppError(403, `Divisi ${p.actor.role} tidak boleh membuat WO ${wf.label}`);

  const made = await wf.create(tx, p.input, p.actor);
  if (wf.uniqueOpenPerCustomer && made.customerId) {
    const open = await tx.workOrder.findFirst({ where: { customerId: made.customerId, type: p.type, closedAt: null } });
    if (open) throw new AppError(409, `Sudah ada WO ${wf.label} yang berjalan (${open.number}) untuk pelanggan ini`);
  }
  const wo = await tx.workOrder.create({
    data: {
      number: await nextNumber(tx, wf.prefix),
      type: p.type,
      status: '__INIT__',
      title: made.title,
      customerId: made.customerId,
      createdById: p.actor.id,
      parentId: p.parentId,
      data: (made.data ?? {}) as Prisma.InputJsonValue,
      source: p.source ?? 'APP',
    },
  });
  await enterStatus(fx, wo.id, p.actor, wf.initial, { action: 'create', note: made.note ?? (p.input.note as string | undefined) });
  return { id: wo.id, number: wo.number };
}

interface EnterMeta {
  action: string;
  from?: string;
  note?: string;
  payload?: unknown;
  data?: Record<string, any>;
  patch?: Ctx['patch'];
}

async function enterStatus(fx: Effects, woId: string, actor: Actor, to: string, meta: EnterMeta) {
  const { tx } = fx;
  let current = to;
  let m = meta;
  for (let depth = 0; depth < 6; depth++) {
    const before = await loadWo(tx, woId);
    const wf = workflows[before.type];
    const st = current === CANCELLED ? undefined : wf.statuses[current];
    if (!st && current !== CANCELLED) throw new AppError(500, `Status ${current} tidak ada di workflow ${before.type}`);
    const final = current === CANCELLED || !!st?.final;

    await tx.workOrder.update({
      where: { id: woId },
      data: {
        status: current,
        data: JSON.parse(JSON.stringify({ ...(before.data as object), ...(m.data ?? {}) })) as Prisma.InputJsonValue,
        closedAt: final ? new Date() : null,
        ...m.patch,
      },
    });
    await tx.woEvent.create({
      data: {
        woId,
        action: m.action,
        fromStatus: m.from ?? (before.status === '__INIT__' ? null : before.status),
        toStatus: current,
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        actorSubRole: actor.subRole ?? null,
        note: m.note,
        payload: m.payload === undefined ? undefined : (JSON.parse(JSON.stringify(m.payload)) as Prisma.InputJsonValue),
      },
    });

    const wo = await loadWo(tx, woId);
    const label = current === CANCELLED ? 'Dibatalkan' : st!.label;
    const link = `${config.webUrl}/work-orders/${wo.id}`;
    const body = `${wo.title}\nPelanggan: ${wo.customer?.name ?? '-'}\nStatus: ${label}\nOleh: ${actor.name}${m.note ? `\nCatatan: ${m.note}` : ''}\n${link}`;

    if (final) {
      await fx.notify({ userIds: [wo.createdById], woId, subject: `[${wo.number}] ${label}`, body });
      if (wo.type === 'STOCK_REQUEST' && current === 'CLOSED' && wo.parentId) await resumeParent(fx, wo.parentId);
    } else {
      await fx.notify({
        roles: [st!.owner],
        userIds: st!.owner === 'FOC' ? [wo.assigneeId] : [],
        woId,
        subject: `[${wo.number}] Menunggu tindakan ${st!.owner}: ${label}`,
        body,
      });
    }

    if (!st?.onEnter) return;
    const ctx = makeCtx(fx, wo, actor);
    const next = await st.onEnter(ctx);
    if (!next) return;
    m = { action: 'auto', from: current, note: next.note, data: ctx.data };
    current = next.to;
  }
  throw new AppError(500, 'Loop transisi otomatis terlalu dalam');
}

/** Permintaan stok anak selesai → WO induk (Pasang Baru) cek stok ulang. */
async function resumeParent(fx: Effects, parentId: string) {
  const parent = await loadWo(fx.tx, parentId);
  if (parent.status === 'STOCK_PENDING') await applyAction(fx, parentId, 'recheck', await systemActor(fx.tx), {}, true);
}

export async function applyAction(fx: Effects, woId: string, key: string, actor: Actor, input: Record<string, any>, system = false) {
  const wo = await loadWo(fx.tx, woId);
  const wf = workflows[wo.type];
  if (!isOpen(wo.status, wo.type)) throw new AppError(409, 'WO sudah selesai / dibatalkan');
  const st = wf.statuses[wo.status];
  const ctx = makeCtx(fx, wo, actor);

  if (key === 'cancel') {
    if (st.noCancel) throw new AppError(409, 'WO tidak bisa dibatalkan pada tahap ini');
    if (!system && actor.role !== 'ADMIN' && actor.id !== wo.createdById) throw new AppError(403, 'Hanya pembuat WO / ADMIN yang bisa membatalkan');
    if (!input.note) throw new AppError(400, 'Alasan pembatalan wajib diisi');
    await wf.onCancel?.(ctx);
    await enterStatus(fx, woId, actor, CANCELLED, { action: 'cancel', note: input.note });
    return;
  }

  const action = st.actions.find((a) => a.key === key);
  if (!action) throw new AppError(400, `Aksi "${key}" tidak tersedia pada status ${st.label}`);
  if (!system) {
    if (action.system) throw new AppError(403, 'Aksi hanya dapat dipicu sistem');
    if (actor.role !== 'ADMIN' && !action.roles.includes(actor.role)) throw new AppError(403, `Aksi ini khusus divisi ${action.roles.join('/')}`);
    if (action.leadOnly && !isLead(actor)) throw new AppError(403, 'Aksi ini hanya untuk supervisor/manager');
    if (action.assigneeOnly && actor.role !== 'ADMIN' && !actor.acting && wo.assigneeId !== actor.id) throw new AppError(403, 'Hanya teknisi yang ditugaskan yang dapat melakukan ini');
  }

  await bindPhotos(fx.tx, woId, actor, input.photos, 'REPORT');
  const override = action.run ? await action.run(ctx, input) : undefined;
  await enterStatus(fx, woId, actor, override ?? action.to, {
    action: key,
    from: wo.status,
    note: typeof input.note === 'string' ? input.note : undefined,
    payload: input,
    data: ctx.data,
    patch: ctx.patch,
  });
}

/** Aksi yang boleh dilakukan `actor` pada WO ini (untuk UI). */
export function allowedActions(wo: { type: WoType; status: string; assigneeId: string | null; createdById: string }, actor: Actor) {
  if (!isOpen(wo.status, wo.type)) return [];
  const st = workflows[wo.type].statuses[wo.status];
  const keys = st.actions
    .filter((a) => !a.system && (actor.role === 'ADMIN' || a.roles.includes(actor.role)) && (!a.leadOnly || isLead(actor)) && (!a.assigneeOnly || actor.role === 'ADMIN' || actor.acting || wo.assigneeId === actor.id))
    .map((a) => a.key);
  if (!st.noCancel && (actor.role === 'ADMIN' || actor.id === wo.createdById)) keys.push('cancel');
  return keys;
}
